import type { ActiveTool } from '../ui/Toolbar'

export type TabletopPointerDownRoute =
  | { kind: 'camera-pan' }
  | { kind: 'tool'; tool: ActiveTool }

/** Camera navigation always wins over tool input for non-primary pointers. */
export function resolveTabletopPointerDown(
  activeTool: ActiveTool,
  button: number,
): TabletopPointerDownRoute {
  return button === 0 ? { kind: 'tool', tool: activeTool } : { kind: 'camera-pan' }
}

/** Model clicks select in Smart Move; empty-table clicks remain target locks. */
export function resolveModelPointerDown(activeTool: ActiveTool, button: number) {
  if (button !== 0) return 'camera-pan' as const
  return activeTool === 'measure' ? 'measure' as const : 'select-model' as const
}
