import type { Point } from '../engine/geometry/point'

export type SmartMoveTargetMode = 'live' | 'locked'

export interface SmartMoveTargetState {
  mode: SmartMoveTargetMode
  target: Point | null
}

export type SmartMoveEnterAction =
  | { type: 'lock'; target: Point }
  | { type: 'apply' }
  | { type: 'none' }

export function initialSmartMoveTargetState(): SmartMoveTargetState {
  return { mode: 'live', target: null }
}

export function previewSmartMoveTarget(state: SmartMoveTargetState, target: Point): SmartMoveTargetState {
  if (state.mode === 'locked') return state
  return { mode: 'live', target: { ...target } }
}

export function lockSmartMoveTarget(target: Point): SmartMoveTargetState {
  return { mode: 'locked', target: { ...target } }
}

export function resolveSmartMoveEnterAction(
  state: SmartMoveTargetState,
  rawTarget: Point | null,
  canApplyCurrentResult: boolean,
): SmartMoveEnterAction {
  if (state.mode === 'live') {
    const target = rawTarget ?? state.target
    return target ? { type: 'lock', target: { ...target } } : { type: 'none' }
  }
  return canApplyCurrentResult ? { type: 'apply' } : { type: 'none' }
}
