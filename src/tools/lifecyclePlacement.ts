import type { GameState, Pose, TabletopModel, Unit } from '../domain/types'
import { activeBattlefieldModels } from '../game/modelPresence'
import { getUnitCoherencyPolicy } from '../game/selectors'
import { evaluateUnitCoherency, type CoherencyResult } from '../engine/coherency'

export function formationPlacements(
  models: readonly TabletopModel[],
  targetCenter: { x: number; y: number },
): Record<string, Pose> {
  if (models.length === 0) return {}
  const center = models.reduce((sum, model) => ({
    x: sum.x + model.position.x,
    y: sum.y + model.position.y,
  }), { x: 0, y: 0 })
  center.x /= models.length
  center.y /= models.length
  const offset = { x: targetCenter.x - center.x, y: targetCenter.y - center.y }
  return Object.fromEntries(models.map((model) => [model.id, {
    position: { x: model.position.x + offset.x, y: model.position.y + offset.y },
    rotation: model.rotation,
  }]))
}

export function nextUnplacedModelId(
  modelIds: readonly string[],
  staged: Readonly<Record<string, Pose>>,
): string | null {
  return modelIds.find((modelId) => !staged[modelId]) ?? null
}

/**
 * Projects active models plus any staged/inactive placement candidates into a
 * derived view. Authoritative state is never mutated; placement overlays and
 * future deployment-like callers can evaluate this same projected view.
 */
export function projectModelsForPlacement(
  state: GameState,
  placements: Readonly<Record<string, Pose>>,
): TabletopModel[] {
  const placedIds = new Set(Object.keys(placements))
  return [...activeBattlefieldModels(state), ...state.models.filter((model) => placedIds.has(model.id))]
    .map((model) => {
      const pose = placements[model.id]
      return pose ? { ...model, position: { ...pose.position }, rotation: pose.rotation, presence: 'ON_BATTLEFIELD' as const } : model
    })
}

export function unitModelsFromPlacement(
  state: GameState,
  unit: Unit,
  placements: Readonly<Record<string, Pose>>,
): TabletopModel[] {
  const projected = projectModelsForPlacement(state, placements)
  return unit.modelIds.flatMap((modelId) => {
    const model = projected.find((candidate) => candidate.id === modelId)
    return model ? [model] : []
  })
}

export interface PlacementCoherencyPreview {
  models: TabletopModel[]
  result: CoherencyResult
}

export function derivePlacementCoherency(
  state: GameState,
  modelIds: readonly string[],
  placements: Readonly<Record<string, Pose>>,
  required: boolean,
): PlacementCoherencyPreview[] {
  if (!required) return []
  const unitIds = [...new Set(modelIds.flatMap((modelId) => {
    const model = state.models.find((candidate) => candidate.id === modelId)
    return model ? [model.unitId] : []
  }))]
  return unitIds.flatMap((unitId) => {
    const unit = state.units.find((candidate) => candidate.id === unitId)
    const policy = unit ? getUnitCoherencyPolicy(state, unit) : undefined
    if (!unit || !policy) return []
    const models = unitModelsFromPlacement(state, unit, placements)
    return [{ models, result: evaluateUnitCoherency(unit, models, policy) }]
  })
}
