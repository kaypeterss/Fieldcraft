import type { GameState, TabletopModel, Unit } from '../domain/types'

const model = (
  id: string,
  unitId: string,
  ownerId: string,
  x: number,
  y: number,
  diameterMm: number,
  label: string,
  canPassOverModels = false,
): TabletopModel => ({
  id,
  unitId,
  ownerId,
  position: { x, y },
  rotation: 0,
  base: { shape: 'circle', diameterMm },
  canPassOverModels,
  label,
})

const models: TabletopModel[] = [
  ...Array.from({ length: 10 }, (_, index) => model(
    `mdl-a-${String(index + 1).padStart(3, '0')}`,
    'unit-a', 'player-1',
    9 + (index % 5) * 2,
    9 + Math.floor(index / 5) * 2,
    25,
    `A${index + 1}`,
  )),
  ...Array.from({ length: 5 }, (_, index) => model(
    `mdl-b-${String(index + 1).padStart(3, '0')}`,
    'unit-b', 'player-2',
    41 + (index % 3) * 2.4,
    10 + Math.floor(index / 3) * 2.4,
    32,
    `B${index + 1}`,
  )),
  model('mdl-c-001', 'unit-c', 'player-2', 39, 31, 50, 'C1', true),
  model('mdl-c-002', 'unit-c', 'player-2', 43, 33, 50, 'C2', true),
  model('mdl-c-003', 'unit-c', 'player-2', 47, 31, 50, 'C3', true),
]

const unit = (id: string, ownerId: string, definitionId: string): Unit => ({
  id,
  ownerId,
  definitionId,
  modelIds: models.filter((candidate) => candidate.unitId === id).map((candidate) => candidate.id),
})

export const initialGameState: GameState = {
  schemaVersion: 3,
  battlefield: { width: 60, height: 44 },
  players: [
    { id: 'player-1', displayName: 'Player 1' },
    { id: 'player-2', displayName: 'Player 2' },
  ],
  models,
  units: [
    unit('unit-a', 'player-1', 'def-line-infantry'),
    unit('unit-b', 'player-2', 'def-skirmishers'),
    unit('unit-c', 'player-2', 'def-heavy-guard'),
  ],
  unitDefinitions: [
    { id: 'def-line-infantry', name: 'Line Infantry', movementAllowance: 6 },
    { id: 'def-skirmishers', name: 'Skirmishers', movementAllowance: 8 },
    { id: 'def-heavy-guard', name: 'Heavy Guard', movementAllowance: 5 },
  ],
  gameContext: {
    round: 1,
    turn: 1,
    turnSequence: 1,
    turnId: 'turn-1',
    activePlayerId: 'player-1',
  },
  turnConfiguration: { playerOrder: ['player-1', 'player-2'] },
  actionHistory: [],
  nextActionSequence: 1,
  movementSession: null,
  lastConfirmedMovementUndo: null,
}
