import type { Point } from '../engine/geometry/point'

export const DRAG_THRESHOLD_PIXELS = 4

export function hasDragIntent(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PIXELS
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
