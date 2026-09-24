import type { GameState, Pose, TabletopModel, Unit } from '../domain/types'
import { activeBattlefieldModels } from '../game/modelPresence'
import { getUnitCoherencyPolicy } from '../game/selectors'
import { evaluateUnitCoherency, type CoherencyResult } from '../engine/coherency'
import { footprintBounds, poseForModel } from '../engine/geometry/footprints'

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

/**
 * Builds a compact rank-and-file preview for models that have no meaningful
 * stored battlefield formation yet (deployment/reserves). The 0.25" edge gap
 * is within current AoS coherency while leaving models visually separable.
 */
export function compactFormationPlacements(
  models: readonly TabletopModel[],
  targetCenter: { x: number; y: number },
  edgeGap = 0.25,
): Record<string, Pose> {
  if (models.length === 0) return {}
  const extents = models.map((model) => {
    const bounds = footprintBounds(model.base, poseForModel(model, { x: 0, y: 0 }))
    return { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }
  })
  const cellWidth = Math.max(...extents.map((extent) => extent.width)) + edgeGap
  const cellHeight = Math.max(...extents.map((extent) => extent.height)) + edgeGap
  const columns = Math.ceil(Math.sqrt(models.length))
  const rows = Math.ceil(models.length / columns)
  return Object.fromEntries(models.map((model, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    return [model.id, {
      position: {
        // Partial final rows stay aligned with the row above so their nearest
        // vertical neighbour remains inside the requested edge gap.
        x: targetCenter.x + (column - (columns - 1) / 2) * cellWidth,
        y: targetCenter.y + (row - (rows - 1) / 2) * cellHeight,
      },
      rotation: model.rotation,
    }]
  }))
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
