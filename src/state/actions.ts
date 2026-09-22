import type { Point } from '../engine/geometry/point'
import type { MovementPolicyConfig, PoseTrajectory } from '../domain/types'

export interface StartMovementSessionAction {
  type: 'movement/sessionStarted'
  sessionId: string
  modelIds: string[]
  /** Captured for the whole session so a debug setting cannot change policy mid-move. */
  movementPolicy?: MovementPolicyConfig
}

export interface RequestRigidMovementAction {
  type: 'movement/requested'
  /** Complete session participant endpoints representing one shared translation. */
  positions: Record<string, Point>
}

export interface RequestModelRotationAction {
  type: 'movement/rotationRequested'
  modelId: string
  /** Absolute desired angle in radians; the reducer resolves the shortest delta. */
  rotation: number
}

export interface ConfirmMovementAction { type: 'movement/confirmed' }
export interface CancelMovementAction { type: 'movement/cancelled' }
export interface UndoConfirmedMovementAction { type: 'movement/undoLastConfirmed' }
export interface ApplyValidatedCandidateMovementAction {
  type: 'movement/validatedCandidateApplied'
  startingPositions: Record<string, Point>
  finalPositions: Record<string, Point>
  startingRotations?: Record<string, number>
  finalRotations?: Record<string, number>
  trajectories?: Record<string, PoseTrajectory>
  movementUsed: Record<string, number>
  /** Optional accepted center paths; omission means a direct fixed-orientation path. */
  paths?: Record<string, Point[]>
}
export interface EndTurnAction { type: 'game/turnEnded' }

export type GameStateAction =
  | StartMovementSessionAction
  | RequestRigidMovementAction
  | RequestModelRotationAction
  | ConfirmMovementAction
  | CancelMovementAction
  | UndoConfirmedMovementAction
  | ApplyValidatedCandidateMovementAction
  | EndTurnAction
