import type { Point } from '../engine/geometry/point'
import type { DicePoolResult, DiceSequenceResolution, ModelPresence, MovementPolicyConfig, Pose, PoseTrajectory } from '../domain/types'

export interface StartMovementSessionAction {
  type: 'movement/sessionStarted'
  sessionId: string
  modelIds: string[]
  /** Captured for the whole session so a debug setting cannot change policy mid-move. */
  movementPolicy?: MovementPolicyConfig
  /** Supplied only by the authoritative runtime command boundary. */
  movementAllowanceByModel?: Record<string, number>
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
export interface RecordScoreEventAction {
  type: 'score/eventRecorded'
  playerId: string
  pointsDelta: number
  reason: string
  source?: { type: string; referenceId?: string }
}
export interface UndoLastScoreEventAction { type: 'score/lastEventUndone' }
export interface UndoLastCommittedOperationAction { type: 'history/undoLastCommitted' }
export interface SetModelPresenceAction {
  type: 'lifecycle/modelPresenceSet'
  modelId: string
  presence: Exclude<ModelPresence, 'ON_BATTLEFIELD'>
}
export interface SetModelsPresenceAction {
  type: 'lifecycle/modelsPresenceSet'
  modelIds: string[]
  presence: Exclude<ModelPresence, 'ON_BATTLEFIELD'>
}
export interface PlaceExistingModelAction {
  type: 'lifecycle/modelPlaced'
  modelId: string
  pose: Pose
  requireCoherency?: boolean
}
export interface PlaceExistingModelsAction {
  type: 'lifecycle/modelsPlaced'
  placements: Record<string, Pose>
  requireCoherency?: boolean
}
export interface RecordDiceRollAction {
  type: 'dice/rollRecorded'
  playerId: string
  result: DicePoolResult
}
export interface UpdateDiceRollAction {
  type: 'dice/rollUpdated'
  rollId: string
  result: DicePoolResult
}
export interface RecordDiceSequenceAction {
  type: 'dice/sequenceRecorded'
  playerId: string
  resolution: DiceSequenceResolution
}

export type GameStateAction =
  | StartMovementSessionAction
  | RequestRigidMovementAction
  | RequestModelRotationAction
  | ConfirmMovementAction
  | CancelMovementAction
  | UndoConfirmedMovementAction
  | ApplyValidatedCandidateMovementAction
  | RecordScoreEventAction
  | UndoLastScoreEventAction
  | UndoLastCommittedOperationAction
  | SetModelPresenceAction
  | SetModelsPresenceAction
  | PlaceExistingModelAction
  | PlaceExistingModelsAction
  | RecordDiceRollAction
  | UpdateDiceRollAction
  | RecordDiceSequenceAction
  | EndTurnAction
