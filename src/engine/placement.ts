import type { GameState, Pose, TabletopModel } from '../domain/types'
import {
  validateCandidateFormation,
  type CandidateFormationResult,
  type CandidateFormationViolation,
} from './candidateFormation'
import { activeBattlefieldModels } from '../game/modelPresence'
import { getUnitCoherencyPolicy } from '../game/selectors'
import { evaluateUnitCoherency, isCoherencyResultValid } from './coherency'
import type { Point } from './geometry/point'
import { closestPointsBetweenFootprints, createPolygonFootprint, footprintContainsFootprint } from './geometry/footprints'
import { inchesToMillimeters } from './units'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export type PlacementAreaConstraint =
  | { type: 'wholly-within-area-union'; id: string; areas: ReadonlyArray<ReadonlyArray<Point>> }
  | { type: 'minimum-distance-from-area-union'; id: string; distance: number; areas: ReadonlyArray<ReadonlyArray<Point>> }

export interface PlacementConstraints {
  requireBattlefieldContainment?: boolean
  requireCollisionLegality?: boolean
  requireTerrainFinish?: boolean
  requireCoherency?: boolean
}

export interface PlacementValidationRequest {
  state: GameState
  modelId: string
  pose: Pose
  requireCoherency?: boolean
  constraints?: PlacementConstraints
}

export interface MultiModelPlacementValidationRequest {
  state: GameState
  placements: Readonly<Record<string, Pose>>
  constraints?: PlacementConstraints
  /** Context-specific spatial rules supplied by an adapter; geometry remains generic. */
  areaConstraints?: ReadonlyArray<PlacementAreaConstraint>
}

const DEFAULT_CONSTRAINTS: Required<PlacementConstraints> = {
  requireBattlefieldContainment: true,
  requireCollisionLegality: true,
  requireTerrainFinish: true,
  requireCoherency: false,
}

/** Shared single-model compatibility wrapper over atomic placement validation. */
export function validateModelPlacement(request: PlacementValidationRequest): CandidateFormationResult {
  return validateModelPlacements({
    state: request.state,
    placements: { [request.modelId]: request.pose },
    constraints: {
      ...request.constraints,
      requireCoherency: request.requireCoherency ?? request.constraints?.requireCoherency,
    },
  })
}

/**
 * Validates a complete atomic placement proposal. The context selects generic
 * constraints; lifecycle, deployment, reserves, and future adapters remain callers.
 */
export function validateModelPlacements(request: MultiModelPlacementValidationRequest): CandidateFormationResult {
  const constraints = { ...DEFAULT_CONSTRAINTS, ...request.constraints }
  const modelIds = Object.keys(request.placements).sort((left, right) => left.localeCompare(right))
  if (modelIds.length === 0) return invalid([{ type: 'MODEL_NOT_FOUND', modelIds: [''] }])

  const byId = new Map(request.state.models.map((model) => [model.id, model]))
  const missing = modelIds.find((modelId) => !byId.has(modelId))
  if (missing) return invalid([{ type: 'MODEL_NOT_FOUND', modelIds: [missing] }])

  const candidates = modelIds.map((modelId) => byId.get(modelId)!)
  const candidateIds = new Set(modelIds)
  const active = activeBattlefieldModels(request.state).filter((model) => !candidateIds.has(model.id))
  const allModels = [...active, ...candidates]
  const positions = Object.fromEntries(modelIds.map((modelId) => [modelId, request.placements[modelId].position]))
  const rotations = Object.fromEntries(modelIds.map((modelId) => [modelId, request.placements[modelId].rotation]))
  const geometry = validateCandidateFormation({
    allModels,
    battlefield: request.state.battlefield,
    terrainFeatures: request.state.battlefieldFeatures,
    terrainPolicy: request.state.terrainPolicy,
    positions,
    rotations,
  })
  const violations = geometry.violations.filter((violation) => keepViolation(violation, constraints))

  for (const candidate of candidates) {
    const pose = request.placements[candidate.id]
    for (const constraint of request.areaConstraints ?? []) {
      const areaFootprints = constraint.areas.map(areaFootprint)
      if (constraint.type === 'wholly-within-area-union') {
        if (!areaFootprints.some((area) => footprintContainsFootprint(
          area,
          { position: { x: 0, y: 0 }, rotation: 0 },
          candidate.base,
          pose,
        ))) violations.push({ type: 'OUTSIDE_REQUIRED_AREA', modelIds: [candidate.id], constraintId: constraint.id })
      } else {
        const actualDistance = Math.min(...areaFootprints.map((area) => closestPointsBetweenFootprints(
          candidate.base,
          pose,
          area,
          { position: { x: 0, y: 0 }, rotation: 0 },
        ).distance))
        if (actualDistance <= constraint.distance + GEOMETRY_EPSILON) {
          violations.push({
            type: 'TOO_CLOSE_TO_AREA', modelIds: [candidate.id], constraintId: constraint.id,
            minimumDistance: constraint.distance, actualDistance,
          })
        }
      }
    }
  }

  if (constraints.requireCoherency) {
    const projectedModels: TabletopModel[] = allModels.map((model) => {
      const pose = request.placements[model.id]
      return pose ? { ...model, position: { ...pose.position }, rotation: pose.rotation } : model
    })
    const affectedUnitIds = [...new Set(candidates.map((model) => model.unitId))].sort()
    for (const unitId of affectedUnitIds) {
      const unit = request.state.units.find((candidate) => candidate.id === unitId)
      const policy = unit ? getUnitCoherencyPolicy(request.state, unit) : undefined
      if (!unit || !policy) continue
      const result = evaluateUnitCoherency(unit, projectedModels, policy)
      if (!isCoherencyResultValid(result, policy)) {
        const invalidIds = result.models.filter((model) => !model.valid).map((model) => model.modelId)
        violations.push({
          type: 'COHERENCY_FAILED',
          modelIds: invalidIds.length > 0
            ? invalidIds
            : unit.modelIds.filter((id) => projectedModels.some((model) => model.id === id)),
        })
      }
    }
  }

  return {
    valid: violations.length === 0,
    destinationValid: violations.length === 0,
    reachabilityValid: null,
    violations,
  }
}

function areaFootprint(vertices: ReadonlyArray<Point>) {
  return createPolygonFootprint(vertices.map((point) => ({
    x: inchesToMillimeters(point.x),
    y: inchesToMillimeters(point.y),
  })))
}

/**
 * Returns a presentation boundary for the exact minimum-distance region
 * around authored area polygons.  The same area/units contract is used by
 * placement validation; rounded joins are important because a distance from
 * a corner is radial, not a square/axis offset.
 */
export function minimumDistanceBoundary(
  areas: ReadonlyArray<ReadonlyArray<Point>>,
  distance: number,
): Point[][] {
  if (!Number.isFinite(distance) || distance <= 0) return areas.map((area) => area.map((point) => ({ ...point })))
  return areas.filter((area) => area.length >= 3).map((vertices) => {
    const signedArea = vertices.reduce((sum, point, index) => {
      const next = vertices[(index + 1) % vertices.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0) / 2
    const orientation = signedArea >= 0 ? 1 : -1
    const joins: Point[][] = []
    for (let index = 0; index < vertices.length; index += 1) {
      const previous = vertices[(index + vertices.length - 1) % vertices.length]
      const current = vertices[index]
      const next = vertices[(index + 1) % vertices.length]
      const incoming = unitVector({ x: current.x - previous.x, y: current.y - previous.y })
      const outgoing = unitVector({ x: next.x - current.x, y: next.y - current.y })
      const previousNormal = outwardNormal(incoming, orientation)
      const nextNormal = outwardNormal(outgoing, orientation)
      const incomingPoint = { x: current.x + previousNormal.x * distance, y: current.y + previousNormal.y * distance }
      const outgoingPoint = { x: current.x + nextNormal.x * distance, y: current.y + nextNormal.y * distance }
      const turn = incoming.x * outgoing.y - incoming.y * outgoing.x
      const convex = turn * orientation > 0
      if (!convex) {
        joins.push([intersectOffsetLines(previous, current, current, next, distance, orientation) ?? incomingPoint])
        continue
      }
      const start = Math.atan2(incomingPoint.y - current.y, incomingPoint.x - current.x)
      const end = Math.atan2(outgoingPoint.y - current.y, outgoingPoint.x - current.x)
      let delta = end - start
      if (orientation > 0) while (delta < 0) delta += Math.PI * 2
      else while (delta > 0) delta -= Math.PI * 2
      const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 12)))
      joins.push(Array.from({ length: steps + 1 }, (_, step) => {
        const angle = start + delta * (step / steps)
        return { x: current.x + Math.cos(angle) * distance, y: current.y + Math.sin(angle) * distance }
      }))
    }
    return joins.flat()
  })
}

function unitVector(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y) || 1
  return { x: vector.x / length, y: vector.y / length }
}

function outwardNormal(direction: Point, orientation: number): Point {
  return orientation > 0 ? { x: direction.y, y: -direction.x } : { x: -direction.y, y: direction.x }
}

function intersectOffsetLines(a: Point, b: Point, c: Point, d: Point, distance: number, orientation: number): Point | null {
  const firstDirection = unitVector({ x: b.x - a.x, y: b.y - a.y })
  const secondDirection = unitVector({ x: d.x - c.x, y: d.y - c.y })
  const firstNormal = outwardNormal(firstDirection, orientation)
  const secondNormal = outwardNormal(secondDirection, orientation)
  const first = { a: { x: a.x + firstNormal.x * distance, y: a.y + firstNormal.y * distance }, b: { x: b.x + firstNormal.x * distance, y: b.y + firstNormal.y * distance } }
  const second = { a: { x: c.x + secondNormal.x * distance, y: c.y + secondNormal.y * distance }, b: { x: d.x + secondNormal.x * distance, y: d.y + secondNormal.y * distance } }
  const abx = first.b.x - first.a.x
  const aby = first.b.y - first.a.y
  const cdx = second.b.x - second.a.x
  const cdy = second.b.y - second.a.y
  const denominator = abx * cdy - aby * cdx
  if (Math.abs(denominator) < 1e-9) return null
  const t = ((second.a.x - first.a.x) * cdy - (second.a.y - first.a.y) * cdx) / denominator
  return { x: first.a.x + t * abx, y: first.a.y + t * aby }
}

function keepViolation(
  violation: CandidateFormationViolation,
  constraints: Required<PlacementConstraints>,
): boolean {
  if (violation.type === 'OUT_OF_BOUNDS') return constraints.requireBattlefieldContainment
  if (violation.type === 'TERRAIN_FINISH_FORBIDDEN') return constraints.requireTerrainFinish
  if (violation.type === 'COLLIDES_WITH_STATIONARY_MODEL' || violation.type === 'CANDIDATE_INTERNAL_OVERLAP') {
    return constraints.requireCollisionLegality
  }
  return true
}

function invalid(violations: CandidateFormationViolation[]): CandidateFormationResult {
  return { valid: false, destinationValid: false, reachabilityValid: null, violations }
}
