import type {
  CoherencyPolicy,
  MovementPolicyConfig,
  TerrainPolicyConfig,
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
  }
  coherency: CoherencyConfiguration
  terrain: TerrainPolicyConfig
  visibility: VisibilityConfiguration
  objectives: ObjectiveConfiguration
  turns: TurnStructureConfiguration
}
