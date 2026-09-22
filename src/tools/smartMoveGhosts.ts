import type { Footprint, Pose, TabletopModel } from '../domain/types'
import type { SmartMoveResult } from '../engine/smartMove'

export interface SmartMoveGhost {
  modelId: string
  footprint: Footprint
  pose: Pose
}

/** Pure render projection; ghosts retain each authoritative footprint and rotation. */
export function deriveSmartMoveGhosts(
  result: SmartMoveResult,
  models: ReadonlyArray<TabletopModel>,
): SmartMoveGhost[] {
  const byId = new Map(models.map((model) => [model.id, model]))
  return result.assignments.flatMap((assignment) => {
    const model = byId.get(assignment.modelId)
    return model ? [{
      modelId: model.id,
      footprint: model.base,
      pose: {
        position: { ...assignment.destination },
        rotation: assignment.finalRotation ?? model.rotation,
      },
    }] : []
  })
}
