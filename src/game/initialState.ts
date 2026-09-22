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

const gridUnit = (
  prefix: string,
  unitId: string,
  ownerId: string,
  origin: { x: number; y: number },
  count: number,
  columns: number,
  spacing: number,
  diameterMm: number,
  canPassOverModels = false,
) => Array.from({ length: count }, (_, index) => model(
  `mdl-${prefix}-${String(index + 1).padStart(3, '0')}`,
  unitId,
  ownerId,
  origin.x + (index % columns) * spacing,
  origin.y + Math.floor(index / columns) * spacing,
  diameterMm,
  `${prefix.toUpperCase()}${index + 1}`,
  canPassOverModels,
))

const mixedUnit = (unitId: string, ownerId: string, origin: { x: number; y: number }) => Array.from({ length: 8 }, (_, index) => {
  const diameterMm = index < 6 ? 32 : index === 6 ? 40 : 50
  return model(
    `mdl-mixed-${String(index + 1).padStart(3, '0')}`,
    unitId,
    ownerId,
    origin.x + (index % 4) * 2.4,
    origin.y + Math.floor(index / 4) * 2.4,
    diameterMm,
    `MIXED${index + 1}`,
  )
})

const giantUnit = (unitId: string, ownerId: string) => [
  model('mdl-giants-001', unitId, ownerId, 42, 5, 80, 'GIANTS1'),
  model('mdl-giants-002', unitId, ownerId, 47, 5, 80, 'GIANTS2'),
  model('mdl-giants-003', unitId, ownerId, 44.5, 9.2, 80, 'GIANTS3'),
]

const models: TabletopModel[] = [
  ...gridUnit('skirmish', 'unit-skirmish', 'player-1', { x: 4, y: 4 }, 5, 3, 1.6, 25),
  ...gridUnit('a', 'unit-a', 'player-1', { x: 7, y: 7 }, 10, 5, 1.6, 25),
  ...gridUnit('horde', 'unit-horde', 'player-1', { x: 4, y: 13 }, 20, 5, 1.6, 25),
  ...gridUnit('fast', 'unit-fast', 'player-1', { x: 20, y: 4 }, 6, 3, 2.4, 40),
  ...mixedUnit('unit-mixed', 'player-1', { x: 20, y: 13 }),
  ...gridUnit('b', 'unit-b', 'player-2', { x: 30, y: 13 }, 10, 5, 2, 32),
  ...gridUnit('cohort', 'unit-cohort', 'player-2', { x: 4, y: 23 }, 20, 5, 2, 32),
  ...gridUnit('c', 'unit-c', 'player-2', { x: 30, y: 23 }, 10, 5, 3, 50, true),
  ...giantUnit('unit-giants', 'player-2'),
]

const units: Unit[] = [
  { id: 'unit-a', ownerId: 'player-1', definitionId: 'def-line', modelIds: models.filter((candidate) => candidate.unitId === 'unit-a').map((candidate) => candidate.id) },
  { id: 'unit-b', ownerId: 'player-2', definitionId: 'def-medium', modelIds: models.filter((candidate) => candidate.unitId === 'unit-b').map((candidate) => candidate.id) },
  { id: 'unit-c', ownerId: 'player-2', definitionId: 'def-heavy', modelIds: models.filter((candidate) => candidate.unitId === 'unit-c').map((candidate) => candidate.id) },
  { id: 'unit-skirmish', ownerId: 'player-1', definitionId: 'def-skirmish', modelIds: models.filter((candidate) => candidate.unitId === 'unit-skirmish').map((candidate) => candidate.id) },
  { id: 'unit-horde', ownerId: 'player-1', definitionId: 'def-horde', modelIds: models.filter((candidate) => candidate.unitId === 'unit-horde').map((candidate) => candidate.id) },
  { id: 'unit-cohort', ownerId: 'player-2', definitionId: 'def-cohort', modelIds: models.filter((candidate) => candidate.unitId === 'unit-cohort').map((candidate) => candidate.id) },
  { id: 'unit-fast', ownerId: 'player-1', definitionId: 'def-fast', modelIds: models.filter((candidate) => candidate.unitId === 'unit-fast').map((candidate) => candidate.id) },
  { id: 'unit-giants', ownerId: 'player-2', definitionId: 'def-giants', modelIds: models.filter((candidate) => candidate.unitId === 'unit-giants').map((candidate) => candidate.id) },
  { id: 'unit-mixed', ownerId: 'player-1', definitionId: 'def-mixed', modelIds: models.filter((candidate) => candidate.unitId === 'unit-mixed').map((candidate) => candidate.id) },
]

export const initialGameState: GameState = {
  schemaVersion: 3,
  battlefield: { width: 60, height: 44 },
  players: [
    { id: 'player-1', displayName: 'Player 1' },
    { id: 'player-2', displayName: 'Player 2' },
  ],
  models,
  units,
  unitDefinitions: [
    { id: 'def-skirmish', name: 'Skirmish 5', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-line', name: 'Line 10', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-horde', name: 'Horde 20', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-cohort', name: 'Cohort 20', movementAllowance: 5, coherencyPolicy: { distance: 1, requiredNeighbors: 2, requireConnected: true } },
    { id: 'def-medium', name: 'Medium 10', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 2, requireConnected: true } },
    { id: 'def-heavy', name: 'Heavy 10', movementAllowance: 6, coherencyPolicy: { distance: 2, requiredNeighbors: 2, requireConnected: true } },
    { id: 'def-fast', name: 'Fast 6', movementAllowance: 10, coherencyPolicy: { distance: 1.5, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-giants', name: 'Giants 3', movementAllowance: 8, coherencyPolicy: { distance: 2, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-mixed', name: 'Mixed 8', movementAllowance: 6, coherencyPolicy: { distance: 1.5, requiredNeighbors: 1, requireConnected: true } },
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
