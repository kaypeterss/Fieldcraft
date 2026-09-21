import type { Point } from '../engine/geometry/point'

export interface Battlefield {
  width: number
  height: number
}

export interface CircularBase {
  shape: 'circle'
  diameterMm: number
}

export interface TabletopModel {
  id: string
  unitId: string
  ownerId: string
  position: Point
  rotation: number
  base: CircularBase
  canPassOverModels: boolean
  label?: string
}

export interface UnitDefinition {
  id: string
  name: string
  movementAllowance: number
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

export interface ModelMovementState {
  modelId: string
  startPosition: Point
  movementUsed: number
  path: Point[]
}

export interface MovementSession {
  id: string
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
    startingPositions: Record<string, Point>
    finalPositions: Record<string, Point>
    movementUsed: Record<string, number>
  }
}

export type GameAction = MoveAction

export interface GameState {
  schemaVersion: 3
  battlefield: Battlefield
  players: Player[]
  models: TabletopModel[]
  units: Unit[]
  unitDefinitions: UnitDefinition[]
  gameContext: GameContext
  turnConfiguration: TurnConfiguration
  actionHistory: GameAction[]
  nextActionSequence: number
  movementSession: MovementSession | null
  lastConfirmedMovementUndo?: MovementUndoSnapshot | null
}
