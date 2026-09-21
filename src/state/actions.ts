import type { Point } from '../engine/geometry/point'

export interface StartMovementSessionAction {
  type: 'movement/sessionStarted'
  sessionId: string
  modelIds: string[]
}

export interface RequestRigidMovementAction {
  type: 'movement/requested'
  /** Complete session participant endpoints representing one shared translation. */
  positions: Record<string, Point>
}

export interface ConfirmMovementAction { type: 'movement/confirmed' }
export interface CancelMovementAction { type: 'movement/cancelled' }
export interface UndoConfirmedMovementAction { type: 'movement/undoLastConfirmed' }
export interface EndTurnAction { type: 'game/turnEnded' }

export type GameStateAction =
  | StartMovementSessionAction
  | RequestRigidMovementAction
  | ConfirmMovementAction
  | CancelMovementAction
  | UndoConfirmedMovementAction
  | EndTurnAction
