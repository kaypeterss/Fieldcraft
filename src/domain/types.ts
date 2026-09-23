import type { Point } from '../engine/geometry/point'

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
  label?: string
}

export interface UnitDefinition {
  id: string
  name: string
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
  modelIds: string[]
  models: Record<string, ModelMovementState>
  referenceStart: Point
  referencePath: Point[]
}

export interface MovementUndoSnapshot {
  models: TabletopModel[]
  actionId: string
  turnId: string
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

export type GameAction = MoveAction

export interface GameState {
  schemaVersion: 3
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
  nextActionSequence: number
  movementSession: MovementSession | null
  lastConfirmedMovementUndo?: MovementUndoSnapshot | null
}
