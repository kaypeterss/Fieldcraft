import type {
  CoherencyPolicy,
  GameState,
  GameSystemOwnedState,
  JsonValue,
  MovementPolicyConfig,
  TerrainPolicyConfig,
  CommittedOperation,
  ResolvedMovementActionContext,
} from '../domain/types'
import type { VisibilityMode, VisibilityPolicy } from '../engine/visibility'

export type MovementScope = 'turn' | 'phase'

export type MovementActionLimit =
  | { type: 'unlimited' }
  | { type: 'limited'; maximumActions: number; scope: MovementScope }

export type MovementAllowanceBehavior =
  | { type: 'reset-per-action' }
  | { type: 'shared'; scope: MovementScope }

/**
 * Action permission and allowance accounting are separate from geometric
 * movement cost. Grants are supplied as facts by a future rules adapter.
 */
export interface MovementPermissionPolicy {
  actionLimit: MovementActionLimit
  allowance: MovementAllowanceBehavior
}

export interface MovementPermissionFacts {
  baseAllowance: number
  actionsUsed: number
  movementUsed: number
  /** Special rules may grant extra actions without changing the base policy. */
  additionalActions?: number
  /** Extra allowance in the current action/shared scope, as interpreted by the adapter. */
  additionalAllowance?: number
}

export interface MovementPermissionResult {
  canStartAction: boolean
  remainingAllowance: number
  actionsRemaining: number | null
}

export interface MovementGrantResult {
  additionalActions?: number
  additionalAllowance?: number
}

export interface MovementGrantRequest {
  state: GameState
  gameSystemState: GameSystemOwnedState
  unitId: string
  modelIds: readonly string[]
}

export type MovementActionContextRequest = MovementGrantRequest

export type MovementActionContextResolution =
  | { allowed: true; context: ResolvedMovementActionContext }
  | { allowed: false; reason: string }

export interface MovementActionCommitRequest {
  before: GameState
  after: GameState
  context: ResolvedMovementActionContext
}

export type CoherencyConfiguration =
  | { type: 'unit-definition' }
  | { type: 'game-system-default'; policy: CoherencyPolicy }

export type ObjectiveQualification = 'intersects' | 'center-within' | 'wholly-within'

export type ObjectiveControlPolicy = {
  type: 'model-or-unit-value'
  /** Used only when neither model nor unit-definition data supplies a value. */
  defaultValue: number
}

export interface ObjectiveConfiguration {
  qualification: ObjectiveQualification
  /** Omission means the loaded system does not expose objective control. */
  control?: ObjectiveControlPolicy
}

export interface VisibilityConfiguration {
  mode: VisibilityMode
  terrainPolicy: VisibilityPolicy
}

export interface GamePhaseDefinition {
  id: string
  name: string
  allowsMovement: boolean
}

export interface TurnStructureConfiguration {
  /** Existing player order remains match data; the game system supplies phases. */
  phases: GamePhaseDefinition[]
}

export type AuthoritativeCommandKind = 'MOVE' | 'SCORE' | 'MODEL_PRESENCE' | 'MODEL_PLACEMENT'

export interface GameSystemCommandPermissionRequest {
  kind: AuthoritativeCommandKind
  actorPlayerId: string
  entityIds: readonly string[]
  state: GameState
  gameSystemState: GameSystemOwnedState
}

/** Opaque adapter-owned command. Generic Fieldcraft only transports it. */
export interface GameSystemCommand {
  type: string
  actorPlayerId: string
  payload?: JsonValue
}

export interface GameSystemUndoPermissionRequest {
  state: GameState
  gameSystemState: GameSystemOwnedState
  operation: CommittedOperation
}

/** Runtime-only schema boundary for the JSON stored in authoritative GameState. */
export interface GameSystemStateAdapter {
  schemaId: string
  schemaVersion: number
  createInitialData: () => JsonValue
  validate: (data: JsonValue) => boolean
}

/**
 * Runtime rules/configuration boundary. The definition is plain data and is
 * not embedded in authoritative GameState; saves can later retain an ID/version.
 */
export interface GameSystem {
  id: string
  name: string
  version: string
  movement: {
    permissions: MovementPermissionPolicy
    cost: MovementPolicyConfig
    /** Optional game-specific grants; both manual and assisted movement consume this same result. */
    resolveGrants?: (request: MovementGrantRequest) => MovementGrantResult
    /** Optional named-rule adapter; manual and assisted movement share this result. */
    resolveActionContext?: (request: MovementActionContextRequest) => MovementActionContextResolution
    /** Records named-rule consequences after the generic move commits atomically. */
    commitAction?: (request: MovementActionCommitRequest) => GameState
  }
  coherency: CoherencyConfiguration
  terrain: TerrainPolicyConfig
  visibility: VisibilityConfiguration
  objectives: ObjectiveConfiguration
  turns: TurnStructureConfiguration
  matchState: GameSystemStateAdapter
  /** Optional ruleset veto. Generic geometry and movement validation still run afterwards. */
  authorizeCommand?: (request: GameSystemCommandPermissionRequest) => boolean
  /** Adapter-owned information-boundary gate for the one-level generic Undo slot. */
  authorizeUndo?: (request: GameSystemUndoPermissionRequest) => boolean
}
