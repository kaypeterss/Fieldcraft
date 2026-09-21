import type { Point } from '../engine/geometry/point'
import type { MovementSession, TabletopModel } from '../domain/types'

export const DRAG_THRESHOLD_PIXELS = 4

export function hasDragIntent(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PIXELS
}

export function individualSameUnitHandoffTarget(
  session: MovementSession | null,
  models: readonly TabletopModel[],
  targetModelId: string,
): string | null {
  if (!session || session.modelIds.length !== 1 || session.modelIds[0] === targetModelId) return null
  const source = models.find((model) => model.id === session.modelIds[0])
  const target = models.find((model) => model.id === targetModelId)
  return source && target && source.unitId === target.unitId ? target.id : null
}

export function selectionForModelPointerDown(
  selectedIds: ReadonlySet<string>,
  modelId: string,
  unitModelIds: ReadonlyArray<string>,
  modifiers: { shiftKey: boolean; unitKey: boolean },
): Set<string> {
  // Ctrl/Cmd has explicit precedence. Ctrl/Cmd+Shift intentionally does not
  // introduce another selection mode.
  if (modifiers.unitKey) return new Set(unitModelIds)

  if (modifiers.shiftKey) {
    const next = new Set(selectedIds)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    return next
  }

  return new Set([modelId])
}
