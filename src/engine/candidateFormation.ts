import type { Battlefield, TabletopModel, Unit } from '../domain/types'
import type { CoherencyPolicy } from './coherency'
import { evaluateUnitCoherency, isCoherencyResultValid } from './coherency'
import { isModelPositionInsideBattlefield } from './geometry/battlefield'
import { circlesOverlap } from './geometry/circles'
import type { Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { baseRadiusInches } from './spatial'

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
  positions: CandidateFormation
  reachability?: CandidateReachabilityConstraint
  coherency?: CandidateCoherencyConstraint
}

export type CandidateFormationViolation =
  | { type: 'MODEL_NOT_FOUND'; modelIds: [string] }
  | { type: 'OUT_OF_BOUNDS'; modelIds: [string] }
  | { type: 'COLLIDES_WITH_STATIONARY_MODEL'; modelIds: [string, string] }
  | { type: 'CANDIDATE_INTERNAL_OVERLAP'; modelIds: [string, string] }
  | { type: 'MOVEMENT_ALLOWANCE_EXCEEDED'; modelIds: [string]; movementCost: number; movementAllowance: number }
  | { type: 'COHERENCY_FAILED'; modelIds: string[] }

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
): TabletopModel[] {
  return allModels.map((model) => {
    const position = positions[model.id]
    return position ? { ...model, position: { ...position } } : model
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
    candidateModels.push(model)
    const position = request.positions[modelId]
    if (!isModelPositionInsideBattlefield(position, model, request.battlefield)) {
      violations.push({ type: 'OUT_OF_BOUNDS', modelIds: [modelId] })
    }
  }

  const stationaryModels = request.allModels.filter((model) => !candidateIdSet.has(model.id))
  for (const candidate of candidateModels) {
    const position = request.positions[candidate.id]
    const radius = baseRadiusInches(candidate.base)
    for (const stationary of stationaryModels) {
      if (circlesOverlap(position, radius, stationary.position, baseRadiusInches(stationary.base))) {
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
      if (circlesOverlap(
        request.positions[source.id],
        baseRadiusInches(source.base),
        request.positions[target.id],
        baseRadiusInches(target.base),
      )) {
        violations.push({ type: 'CANDIDATE_INTERNAL_OVERLAP', modelIds: [source.id, target.id] })
      }
    }
  }

  if (request.coherency) {
    const projectedModels = projectCandidateModels(request.allModels, request.positions)
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
