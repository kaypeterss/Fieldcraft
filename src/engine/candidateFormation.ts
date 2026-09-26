import type { Battlefield, BattlefieldFeature, MovementDestinationConstraint, MovementSeparationConstraint, TabletopModel, TerrainPolicyConfig, Unit } from '../domain/types'
import type { CoherencyPolicy } from './coherency'
import { evaluateUnitCoherency, isCoherencyResultValid } from './coherency'
import { closestPointsBetweenFootprints, footprintInsideBattlefield, footprintsOverlap, poseForModel } from './geometry/footprints'
import type { Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { terrainDestinationLegal } from './terrainPolicy'

export type CandidateFormation = Readonly<Record<string, Point>>

export interface CandidateReachabilityConstraint {
  movementCosts: Readonly<Record<string, number>>
  movementAllowances: Readonly<Record<string, number>>
}

export interface CandidateCoherencyConstraint {
  unit: Unit
  policy: CoherencyPolicy
  requireConnected?: boolean
}

export interface CandidateFormationRequest {
  allModels: ReadonlyArray<TabletopModel>
  battlefield: Battlefield
  terrainFeatures?: ReadonlyArray<BattlefieldFeature>
  terrainPolicy?: TerrainPolicyConfig
  positions: CandidateFormation
  /** Optional final orientations; omitted models retain their current rotation. */
  rotations?: Readonly<Record<string, number>>
  reachability?: CandidateReachabilityConstraint
  coherency?: CandidateCoherencyConstraint
  separationConstraints?: ReadonlyArray<MovementSeparationConstraint>
  destinationConstraints?: ReadonlyArray<MovementDestinationConstraint>
}

export type CandidateFormationViolation =
  | { type: 'MODEL_NOT_FOUND'; modelIds: [string] }
  | { type: 'OUT_OF_BOUNDS'; modelIds: [string] }
  | { type: 'COLLIDES_WITH_STATIONARY_MODEL'; modelIds: [string, string] }
  | { type: 'TERRAIN_FINISH_FORBIDDEN'; modelIds: [string] }
  | { type: 'CANDIDATE_INTERNAL_OVERLAP'; modelIds: [string, string] }
  | { type: 'MOVEMENT_ALLOWANCE_EXCEEDED'; modelIds: [string]; movementCost: number; movementAllowance: number }
  | { type: 'COHERENCY_FAILED'; modelIds: string[] }
  | { type: 'OUTSIDE_REQUIRED_AREA'; modelIds: [string]; constraintId: string }
  | { type: 'TOO_CLOSE_TO_AREA'; modelIds: [string]; constraintId: string; minimumDistance: number; actualDistance: number }
  | { type: 'MODEL_SEPARATION_FAILED'; modelIds: [string, string]; minimumDistance: number; actualDistance: number }
  | { type: 'DESTINATION_RELATIONSHIP_FAILED'; modelIds: string[]; constraintId: string }

export interface CandidateFormationResult {
  valid: boolean
  destinationValid: boolean
  /** Null means path/reachability was deliberately not evaluated. */
  reachabilityValid: boolean | null
  violations: CandidateFormationViolation[]
}

/** Returns a hypothetical model view without mutating the supplied models. */
export function projectCandidateModels(
  allModels: ReadonlyArray<TabletopModel>,
  positions: CandidateFormation,
  rotations: Readonly<Record<string, number>> = {},
): TabletopModel[] {
  return allModels.map((model) => {
    const position = positions[model.id]
    const rotation = rotations[model.id]
    return position || rotation !== undefined
      ? { ...model, ...(position ? { position: { ...position } } : {}), ...(rotation !== undefined ? { rotation } : {}) }
      : model
  })
}

/**
 * Validates independently positioned model destinations. This does not validate
 * paths; optional caller-supplied movement costs are compared with allowances.
 */
export function validateCandidateFormation(request: CandidateFormationRequest): CandidateFormationResult {
  const violations: CandidateFormationViolation[] = []
  const byId = new Map(request.allModels.map((model) => [model.id, model]))
  const candidateIds = Object.keys(request.positions)
  const candidateIdSet = new Set(candidateIds)
  const candidateModels: TabletopModel[] = []

  for (const modelId of candidateIds) {
    const model = byId.get(modelId)
    if (!model) {
      violations.push({ type: 'MODEL_NOT_FOUND', modelIds: [modelId] })
      continue
    }
    const candidate = { ...model, rotation: request.rotations?.[modelId] ?? model.rotation }
    candidateModels.push(candidate)
    const position = request.positions[modelId]
    if (!footprintInsideBattlefield(candidate.base, poseForModel(candidate, position), request.battlefield)) {
      violations.push({ type: 'OUT_OF_BOUNDS', modelIds: [modelId] })
    }
    if (!terrainDestinationLegal(candidate, poseForModel(candidate, position), request.terrainFeatures, request.terrainPolicy)) {
      violations.push({ type: 'TERRAIN_FINISH_FORBIDDEN', modelIds: [modelId] })
    }
  }

  const stationaryModels = request.allModels.filter((model) => !candidateIdSet.has(model.id))
  for (const candidate of candidateModels) {
    const position = request.positions[candidate.id]
    for (const stationary of stationaryModels) {
      if (footprintsOverlap(
        candidate.base,
        poseForModel(candidate, position),
        stationary.base,
        poseForModel(stationary),
      )) {
        violations.push({
          type: 'COLLIDES_WITH_STATIONARY_MODEL',
          modelIds: [candidate.id, stationary.id],
        })
      }
    }
  }

  for (let sourceIndex = 0; sourceIndex < candidateModels.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < candidateModels.length; targetIndex += 1) {
      const source = candidateModels[sourceIndex]
      const target = candidateModels[targetIndex]
      if (footprintsOverlap(
        source.base,
        poseForModel(source, request.positions[source.id]),
        target.base,
        poseForModel(target, request.positions[target.id]),
      )) {
        violations.push({ type: 'CANDIDATE_INTERNAL_OVERLAP', modelIds: [source.id, target.id] })
      }
    }
  }

  for (const constraint of request.separationConstraints ?? []) {
    if (!constraint.atDestination || !candidateIdSet.has(constraint.movingModelId)) continue
    const moving = byId.get(constraint.movingModelId)
    const obstacle = byId.get(constraint.obstacleModelId)
    if (!moving || !obstacle) continue
    const distance = closestPointsBetweenFootprints(
      moving.base,
      poseForModel(moving, request.positions[moving.id]),
      obstacle.base,
      poseForModel(obstacle, request.positions[obstacle.id] ?? obstacle.position),
    ).distance
    if (distance + GEOMETRY_EPSILON < constraint.minimumDistance) {
      violations.push({
        type: 'MODEL_SEPARATION_FAILED',
        modelIds: [moving.id, obstacle.id],
        minimumDistance: constraint.minimumDistance,
        actualDistance: distance,
      })
    }
  }

  const projectedModels = projectCandidateModels(request.allModels, request.positions, request.rotations)
  const projectedById = new Map(projectedModels.map((model) => [model.id, model]))
  const minimumDistance = (sourceId: string, targetIds: readonly string[]) => {
    const source = projectedById.get(sourceId)
    if (!source) return Number.POSITIVE_INFINITY
    return Math.min(...targetIds.map((targetId) => {
      const target = projectedById.get(targetId)
      return target ? closestPointsBetweenFootprints(source.base, poseForModel(source), target.base, poseForModel(target)).distance
        : Number.POSITIVE_INFINITY
    }))
  }
  for (const constraint of request.destinationConstraints ?? []) {
    const valid = constraint.type === 'ANY_SOURCE_WITHIN_TARGETS'
      ? constraint.sourceModelIds.some((sourceId) => minimumDistance(sourceId, constraint.targetModelIds) <= constraint.maximumDistance + GEOMETRY_EPSILON)
      : constraint.type === 'EACH_SOURCE_NO_FARTHER_FROM_TARGETS'
        ? constraint.sourceModelIds.every((sourceId) => minimumDistance(sourceId, constraint.targetModelIds) <= (constraint.maximumDistanceBySourceModelId[sourceId] ?? Number.NEGATIVE_INFINITY) + GEOMETRY_EPSILON)
        : constraint.targetGroups.every((group) => constraint.sourceModelIds.some((sourceId) => minimumDistance(sourceId, group.modelIds) <= constraint.maximumDistance + GEOMETRY_EPSILON))
    if (!valid) violations.push({ type: 'DESTINATION_RELATIONSHIP_FAILED', modelIds: [...constraint.sourceModelIds], constraintId: constraint.id })
  }

  if (request.coherency) {
    const result = evaluateUnitCoherency(request.coherency.unit, projectedModels, request.coherency.policy)
    const coherent = isCoherencyResultValid(result, {
      ...request.coherency.policy,
      requireConnected: request.coherency.requireConnected ?? request.coherency.policy.requireConnected,
    })
    if (!coherent) {
      const violatingIds = result.models.filter((model) => !model.valid).map((model) => model.modelId)
      violations.push({
        type: 'COHERENCY_FAILED',
        modelIds: violatingIds.length > 0 ? violatingIds : [...request.coherency.unit.modelIds],
      })
    }
  }

  if (request.reachability) {
    for (const modelId of candidateIds) {
      const movementCost = request.reachability.movementCosts[modelId]
      const movementAllowance = request.reachability.movementAllowances[modelId]
      if (movementCost !== undefined
        && movementAllowance !== undefined
        && movementCost > movementAllowance + GEOMETRY_EPSILON) {
        violations.push({
          type: 'MOVEMENT_ALLOWANCE_EXCEEDED',
          modelIds: [modelId],
          movementCost,
          movementAllowance,
        })
      }
    }
  }

  const destinationValid = violations.every((violation) => violation.type === 'MOVEMENT_ALLOWANCE_EXCEEDED')
  const reachabilityValid = request.reachability
    ? violations.every((violation) => violation.type !== 'MOVEMENT_ALLOWANCE_EXCEEDED')
    : null
  return {
    valid: destinationValid && reachabilityValid !== false,
    destinationValid,
    reachabilityValid,
    violations,
  }
}
