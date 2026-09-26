import type { ActiveTool } from '../ui/Toolbar'

export type TabletopPointerDownRoute =
  | { kind: 'camera-pan' }
  | { kind: 'model-pick-wait' }
  | { kind: 'tool'; tool: ActiveTool }

/** Camera navigation always wins over tool input for non-primary pointers. */
export function resolveTabletopPointerDown(
  activeTool: ActiveTool,
  button: number,
  modelPickerActive = false,
): TabletopPointerDownRoute {
  if (button !== 0) return { kind: 'camera-pan' }
  return modelPickerActive ? { kind: 'model-pick-wait' } : { kind: 'tool', tool: activeTool }
}

/** Model clicks select in Smart Move; empty-table clicks remain target locks. */
export function resolveModelPointerDown(
  activeTool: ActiveTool,
  button: number,
  modelPickerActive = false,
  placementActive = false,
  casualtyPickerActive = false,
) {
  if (button !== 0) return 'camera-pan' as const
  if (modelPickerActive) return 'pick-model' as const
  if (casualtyPickerActive) return 'pick-casualty' as const
  if (activeTool === 'measure') return 'measure' as const
  return placementActive ? 'placement' as const : 'select-model' as const
}

/** Selection and movement are intentionally separate primary interactions. */
export function primaryToolAllowsMovement(activeTool: ActiveTool): boolean {
  return activeTool === 'move'
}
