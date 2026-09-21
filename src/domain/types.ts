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
}

export interface GameState {
  schemaVersion: 2
  battlefield: Battlefield
  models: TabletopModel[]
  units: Unit[]
  unitDefinitions: UnitDefinition[]
  movementSession: MovementSession | null
  lastConfirmedMovementUndo?: MovementUndoSnapshot | null
}
