import type { Point } from '../engine/geometry/point'

export interface MoveModelsAction {
  type: 'models/moved'
  positions: Record<string, Point>
}

export interface StartMovementSessionAction {
  type: 'movement/sessionStarted'
  sessionId: string
  modelIds: string[]
}

export interface RequestMovementAction {
  type: 'movement/requested'
  positions: Record<string, Point>
}

export interface ConfirmMovementAction { type: 'movement/confirmed' }
export interface CancelMovementAction { type: 'movement/cancelled' }
export interface UndoConfirmedMovementAction { type: 'movement/undoLastConfirmed' }

export type GameAction =
  | MoveModelsAction
  | StartMovementSessionAction
  | RequestMovementAction
  | ConfirmMovementAction
  | CancelMovementAction
  | UndoConfirmedMovementAction
