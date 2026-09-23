import type { TabletopModel } from '../domain/types'
import type { SmartMoveResult } from '../engine/smartMove'

/**
 * The canvas and every projected analysis must consume this same retained
 * preview. A valid result remains displayable while a newer solve is pending;
 * invalid/error/cancel states clear the controller result and return null.
 */
export function displayedSmartMovePreview(
  result: SmartMoveResult | null,
): SmartMoveResult | null {
  return result?.valid ? result : null
}

/**
 * Transient Spatial projection. It never mutates or enters authoritative state;
 * unaffected models retain their current poses.
 */
export function projectModelsForSmartMove(
  models: readonly TabletopModel[],
  result: SmartMoveResult | null,
): TabletopModel[] {
  if (!result?.valid) return models.slice()
  const assignments = new Map(result.assignments.map((assignment) => [assignment.modelId, assignment]))
  return models.map((model) => {
    const assignment = assignments.get(model.id)
    return assignment ? {
      ...model,
      position: { ...assignment.destination },
      rotation: assignment.finalRotation ?? model.rotation,
    } : model
  })
}
