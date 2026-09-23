import type { GameState, Pose, TabletopModel } from '../domain/types'
import {
  validateCandidateFormation,
  type CandidateFormationResult,
  type CandidateFormationViolation,
} from './candidateFormation'
import { activeBattlefieldModels } from '../game/modelPresence'
import { getUnitCoherencyPolicy } from '../game/selectors'
import { evaluateUnitCoherency, isCoherencyResultValid } from './coherency'

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
