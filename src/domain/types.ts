import type { Point } from '../engine/geometry/point'

/** Passive, JSON-safe rule vocabulary interpreted only by a loaded game system. */
export type Keyword = string

/** Values stored by a loaded game system must remain portable save data. */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface VersionedContentReference {
  id: string
  version: string
}

/** One immutable, game-agnostic package pinned by a saved match. */
export interface ContentManifestEntry extends VersionedContentReference {
  kind: string
  /** Optional integrity identity for packaged content with the same human version. */
  hash?: string
}

/** Persisted identity of the rules and content used to create this match. */
export interface MatchIdentity {
  gameSystem: VersionedContentReference
  /** Stable identity and presentation metadata for multi-match persistence. */
  matchId?: string
  matchName?: string
  /** Required for schema v5; omitted only by legacy Development saves. */
  contentManifest?: ContentManifestEntry[]
  format?: VersionedContentReference
  mission?: VersionedContentReference
}

export type MatchLifecycleStatus = 'SETUP' | 'DEPLOYMENT' | 'IN_PROGRESS' | 'COMPLETED'

export interface DeploymentZoneDefinition {
  id: string
  name: string
  areaReference?: string
  /** Optional authored tabletop polygons used for setup/deployment visualization. */
  areas?: Array<{ vertices: Point[] }>
  ownerRole?: 'attacker' | 'defender'
}

/** Minimal resolved match data; interpretation remains with the loaded GameSystem. */
export interface ResolvedMatchConfiguration {
  id: string
  version: string
  roundLimit?: number
  objectiveFeatureIds: string[]
  deploymentZones: DeploymentZoneDefinition[]
  policyReferences: Record<string, string>
}

/** Versioned and validated by the loaded GameSystem, never interpreted by generic engines. */
export interface GameSystemOwnedState {
  schemaId: string
  schemaVersion: number
  data: JsonValue
}

export interface Battlefield {
  width: number
  height: number
}

export interface CircleFootprint {
  shape: 'circle'
  diameterMm: number
}

export interface EllipseFootprint {
  shape: 'ellipse'
  widthMm: number
  heightMm: number
}

export interface RectangleFootprint {
  shape: 'rectangle'
  widthMm: number
  heightMm: number
}

export interface PolygonFootprint {
  shape: 'polygon'
  /** Model-local millimeter coordinates relative to the model origin. */
  verticesMm: Point[]
}

export type Footprint =
  | CircleFootprint
  | EllipseFootprint
  | RectangleFootprint
  | PolygonFootprint

/** Compatibility name retained while serialized models still use `base`. */
export type CircularBase = CircleFootprint

/**
 * A tabletop pose. Rotation is radians normalized to [0, 2π), with zero on
 * +X and positive rotation appearing clockwise in the +Y-down tabletop space.
 */
export interface Pose {
  position: Point
  rotation: number
}

/** Local geometry and pose are relative to the parent BattlefieldFeature. */
export interface BattlefieldFeatureObject {
  id: string
  name: string
  keywords?: Keyword[]
  footprint: Footprint
  localPose: Pose
}

export type ObjectiveArea =
  | { type: 'feature-base' }
  | { type: 'local-footprint'; footprint: Footprint; localPose: Pose }
  | { type: 'point-range'; localPoint: Point; rangeInches: number }

/** Roles describe what a feature is; game-system policy later defines their effects. */
export interface BattlefieldFeatureCapabilities {
  terrain?: { type: 'terrain' }
  objective?: { type: 'objective'; area: ObjectiveArea }
  movable?: { type: 'movable' }
}

export interface BattlefieldFeature {
  id: string
  name: string
  pose: Pose
  baseArea: Footprint
  capabilities: BattlefieldFeatureCapabilities
  objects: BattlefieldFeatureObject[]
}

/** Prototype policy data, independent of feature geometry and named game systems. */
export interface TerrainPermissions {
  canEnter: boolean
  canCross: boolean
  canFinish: boolean
}

export interface TerrainPolicyRule {
  featureId: string
  /** Omitted for the feature base; supplied for one child object. */
  objectId?: string
  /** Omitted for all models; supplied for a model-specific override. */
  modelId?: string
  permissions: TerrainPermissions
}

export interface TerrainPolicyConfig {
  defaultBase: TerrainPermissions
  defaultObject: TerrainPermissions
  rules: TerrainPolicyRule[]
}

/**
 * One ordered rigid-motion segment. The center travels linearly from the
 * previous pose to `endPose` while rotation advances by `angularDelta`.
 * Keeping the signed delta avoids losing direction at angle wraparound.
 */
export interface PoseTrajectorySegment {
  endPose: Pose
  angularDelta: number
}

/** Plain JSON-safe pose history; adjacent entries may represent coupled motion. */
export interface PoseTrajectory {
  startPose: Pose
  segments: PoseTrajectorySegment[]
}

export interface CoherencyPolicy {
  distance: number
  requiredNeighbors: number
  /** Connectedness is distinct from the local neighbor requirement. */
  requireConnected?: boolean
}

export interface TabletopModel {
  id: string
  unitId: string
  ownerId: string
  position: Pose['position']
  rotation: Pose['rotation']
  /** Serialized compatibility field; its value is the model footprint. */
  base: Footprint
  canPassOverModels: boolean
  /** Optional raw game-data value; the loaded GameSystem decides how to interpret it. */
  objectiveControl?: number
  keywords?: Keyword[]
  label?: string
  /** Missing is treated as ON_BATTLEFIELD only when reading legacy schema-v3 data. */
  presence?: ModelPresence
}

export type ModelPresence = 'ON_BATTLEFIELD' | 'OFF_BOARD' | 'DESTROYED'

export interface UnitDefinition {
  id: string
  name: string
  keywords?: Keyword[]
  /** Optional raw game-data value inherited by models without an override. */
  objectiveControl?: number
  movementAllowance: number
  coherencyPolicy?: CoherencyPolicy
}

export interface Unit {
  id: string
  ownerId: string
  definitionId: string
  modelIds: string[]
}

export interface Player {
  id: string
  displayName: string
}

export interface GameContext {
  round: number
  /** Human-readable index within the current configured round. */
  turn: number
  /** Monotonic internal turn order; never resets between rounds. */
  turnSequence: number
  turnId: string
  activePlayerId: string
  phase?: string
}

export interface TurnConfiguration {
  playerOrder: string[]
  phases?: string[]
}

/**
 * Serializable prototype movement-policy configuration. Movement Envelope is
 * geometric reach; the other policies consume scalar trajectory cost.
 */
export type MovementPolicyConfig =
  | { type: 'movement-envelope' }
  | { type: 'fixed-rotation-charge'; rotationCharge: number }
  | { type: 'free-rotation' }

export interface ModelMovementState {
  modelId: string
  startPose: Pose
  /** Ordered authoritative movement facts; scalar fields below are derived compatibility views. */
  trajectory: PoseTrajectory
  translationDistance: number
  angularRotation: number
  movementUsed: number
  path: Point[]
}

export interface MovementSession {
  id: string
  movementPolicy: MovementPolicyConfig
  /** Authoritative remaining allowance resolved once by the loaded runtime at session start. */
  movementAllowanceByModel?: Record<string, number>
  modelIds: string[]
  models: Record<string, ModelMovementState>
  referenceStart: Point
  referencePath: Point[]
}

export interface MoveAction {
  id: string
  sequence: number
  type: 'MOVE'
  playerId: string
  round: number
  turn: number
  turnSequence: number
  turnId: string
  phase?: string
  payload: {
    modelIds: string[]
    unitIds: string[]
    ownerIds: string[]
    /** Complete pose snapshots are authoritative for movement history. */
    startingPoses: Record<string, Pose>
    finalPoses: Record<string, Pose>
    /** Ordered accepted motion retained for future path-sensitive game policies. */
    trajectories: Record<string, PoseTrajectory>
    /** Compatibility projections retained for existing history consumers. */
    startingPositions: Record<string, Point>
    finalPositions: Record<string, Point>
    translationDistance: Record<string, number>
    angularRotation: Record<string, number>
    movementUsed: Record<string, number>
  }
}

export interface ScoreEventSource {
  type: string
  referenceId?: string
}

/** A confirmed score adjustment; objective control never creates this implicitly. */
export interface ScoreEvent {
  id: string
  sequence: number
  type: 'SCORE'
  playerId: string
  round: number
  turn: number
  turnSequence: number
  turnId: string
  phase?: string
  payload: {
    pointsDelta: number
    reason: string
    source?: ScoreEventSource
  }
}

/** One value-based reroll pass over a dice pool. Indices refer to the stable pool order. */
export interface DiceReroll {
  values: number[]
  indices: number[]
  previousResults: number[]
  replacementResults: number[]
}

/** Pure, JSON-safe result returned by both manual and GameSystem-driven dice rolls. */
export interface DicePoolResult {
  count: number
  sides: number
  originalResults: number[]
  rerolls: DiceReroll[]
  finalResults: number[]
  total: number
  distribution: Record<number, number>
  successThreshold?: number
  successes?: number
}

/** Confirmed dice history keeps its player and match context without becoming a game rule. */
export interface DiceRollRecord extends DicePoolResult {
  id: string
  sequence: number
  type: 'DICE_ROLL'
  playerId: string
  round: number
  turn: number
  turnSequence: number
  turnId: string
  phase?: string
}

export type DiceContinuation = 'successes' | 'failures'

export interface DiceStageDefinition {
  id: string
  label: string
  sides: number
  threshold: number
  continuation: DiceContinuation
  reroll?: { values: number[] }
  /** Passive adapter keys; the generic engine attaches no named-rule meaning. */
  modifierIds?: string[]
}

export interface DiceSequenceDefinition {
  id: string
  label: string
  startingDiceCount: number
  stages: DiceStageDefinition[]
}

export interface DiceStageResult {
  stage: DiceStageDefinition
  inputDiceCount: number
  effectiveThreshold: number
  roll: DicePoolResult
  successCount: number
  failureCount: number
  continuationCount: number
}

/** Serializable state supports both one-stage-at-a-time and complete resolution. */
export interface DiceSequenceResolution {
  definition: DiceSequenceDefinition
  stageResults: DiceStageResult[]
  complete: boolean
  finalResult?: number
}

export interface DiceSequenceRecord extends DiceSequenceResolution {
  id: string
  sequence: number
  type: 'DICE_SEQUENCE'
  playerId: string
  round: number
  turn: number
  turnSequence: number
  turnId: string
  phase?: string
}

export type DiceHistoryEntry = DiceRollRecord | DiceSequenceRecord

export type CommittedOperationType = 'MOVE' | 'SCORE' | 'MODEL_PRESENCE' | 'MODEL_PLACED' | 'GAME_SYSTEM'

/** Ordered facts about committed mutations; current state remains authoritative. */
export interface CommittedOperation {
  id: string
  sequence: number
  type: CommittedOperationType
  actorPlayerId: string
  round: number
  turn: number
  turnSequence: number
  turnId: string
  phase?: string
  entityIds: string[]
}

/** Existing movement-action contract retained for compatibility. */
export type GameAction = MoveAction

export interface GameState {
  schemaVersion: 3 | 4 | 5
  /** Required in schema v4+; optional only while deterministically migrating v3 saves. */
  matchIdentity?: MatchIdentity
  /** Generic lifecycle; absent only on legacy snapshots and treated as SETUP. */
  matchLifecycle?: MatchLifecycleStatus
  resolvedMatchConfiguration?: ResolvedMatchConfiguration
  gameSystemState?: GameSystemOwnedState
  battlefield: Battlefield
  players: Player[]
  models: TabletopModel[]
  /** Optional for compatibility with existing schema-version-3 saves. */
  battlefieldFeatures?: BattlefieldFeature[]
  /** Optional so pre-M7 snapshots continue to have no terrain movement effects. */
  terrainPolicy?: TerrainPolicyConfig
  units: Unit[]
  unitDefinitions: UnitDefinition[]
  gameContext: GameContext
  turnConfiguration: TurnConfiguration
  actionHistory: GameAction[]
  /** Optional for compatibility with pre-M8.1 schema-version-3 snapshots. */
  scoreHistory?: ScoreEvent[]
  /** Optional for compatibility with pre-M8.2 schema-version-3 snapshots. */
  diceHistory?: DiceHistoryEntry[]
  /** Unified ordered facts for reversible authoritative operations. */
  committedOperations?: CommittedOperation[]
  nextActionSequence: number
  movementSession: MovementSession | null
  /** Legacy schema-v3 movement-only snapshot. Never written by M9 code. */
  lastConfirmedMovementUndo?: { models: TabletopModel[]; actionId: string; turnId: string } | null
  lastCommittedOperationUndo?: CommittedOperationUndo | null
}

/**
 * One-level atomic Undo snapshot for every M9-authoritative mutable domain.
 * Dice history and the monotonic sequence are intentionally not reversible.
 */
export interface CommittedOperationUndo {
  operationId: string
  turnId: string
  models: TabletopModel[]
  actionHistory: GameAction[]
  scoreHistory?: ScoreEvent[]
  gameSystemState: GameSystemOwnedState
  committedOperations: CommittedOperation[]
}
