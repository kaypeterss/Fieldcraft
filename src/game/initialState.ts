import type { Footprint, GameState, TabletopModel, Unit } from '../domain/types'

const model = (
  id: string,
  unitId: string,
  ownerId: string,
  x: number,
  y: number,
  base: Footprint,
  label: string,
  rotation = 0,
): TabletopModel => ({
  id,
  unitId,
  ownerId,
  position: { x, y },
  rotation,
  base,
  canPassOverModels: false,
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
  base: Footprint,
  rotation = 0,
  rowSpacing = spacing,
) => Array.from({ length: count }, (_, index) => model(
  `mdl-${prefix}-${String(index + 1).padStart(3, '0')}`,
  unitId,
  ownerId,
  origin.x + (index % columns) * spacing,
  origin.y + Math.floor(index / columns) * rowSpacing,
  base,
  `${prefix.toUpperCase()}${index + 1}`,
  rotation,
))

const circle = (diameterMm: number): Footprint => ({ shape: 'circle', diameterMm })
const oval = (widthMm: number, heightMm: number): Footprint => ({ shape: 'ellipse', widthMm, heightMm })

const vehicleHull: Footprint = {
  shape: 'polygon',
  verticesMm: [
    { x: -45, y: -22 }, { x: 25, y: -22 }, { x: 50, y: 0 },
    { x: 25, y: 22 }, { x: -45, y: 22 }, { x: -55, y: 0 },
  ],
}

const unit = (id: string, ownerId: string, definitionId: string, roster: readonly TabletopModel[]): Unit => ({
  id,
  ownerId,
  definitionId,
  modelIds: roster.filter((candidate) => candidate.unitId === id).map((candidate) => candidate.id),
})

const models: TabletopModel[] = [
  // Player 1: practical infantry, cavalry, and stronger-coherency benchmarks.
  ...gridUnit('a', 'unit-a', 'player-1', { x: 5, y: 5 }, 10, 5, 1.9, circle(32)),
  ...gridUnit('cav', 'unit-cavalry', 'player-1', { x: 18, y: 5 }, 6, 3, 3.35, oval(75, 42), 0, 2.1),
  ...gridUnit('s', 'unit-strong', 'player-1', { x: 5, y: 30 }, 10, 5, 2.1, circle(40)),

  // Player 2: a performance horde plus large-base and vehicle blockers.
  ...gridUnit('h', 'unit-horde', 'player-2', { x: 43, y: 28 }, 20, 5, 1.55, circle(25)),
  ...gridUnit('b', 'unit-b', 'player-2', { x: 43, y: 5 }, 5, 3, 2.55, circle(50)),
  ...gridUnit('c', 'unit-c', 'player-2', { x: 32, y: 16 }, 3, 3, 4.15, oval(90, 52), Math.PI / 12),
  ...gridUnit('v', 'unit-vehicles', 'player-2', { x: 46, y: 17 }, 3, 3, 4.65, vehicleHull),
]

const units: Unit[] = [
  unit('unit-a', 'player-1', 'def-standard-infantry', models),
  unit('unit-horde', 'player-2', 'def-horde', models),
  unit('unit-cavalry', 'player-1', 'def-oval-cavalry', models),
  unit('unit-b', 'player-2', 'def-elite-large', models),
  unit('unit-c', 'player-2', 'def-heavy-oval', models),
  unit('unit-vehicles', 'player-2', 'def-vehicles', models),
  unit('unit-strong', 'player-1', 'def-strong-coherency', models),
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
    { id: 'def-standard-infantry', name: 'Standard Infantry', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-horde', name: 'Horde', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-oval-cavalry', name: 'Oval Cavalry', movementAllowance: 10, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-elite-large', name: 'Elite Large-Base Unit', movementAllowance: 6, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-heavy-oval', name: 'Heavy Oval Unit', movementAllowance: 8, coherencyPolicy: { distance: 2, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-vehicles', name: 'Vehicle / Hull Unit', movementAllowance: 10, coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'def-strong-coherency', name: 'Strong Coherency Unit', movementAllowance: 5, coherencyPolicy: { distance: 1, requiredNeighbors: 2, requireConnected: true } },
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

/**
 * Opt-in M6.4 manual pose board (`?footprints=1`). Keeping it separate
 * preserves the compact four-shape geometry fixture independently from the
 * realistic normal gameplay roster.
 */
export const footprintDemoGameState: GameState = {
  ...initialGameState,
  models: [
    {
      id: 'demo-circle', unitId: 'demo-unit-shapes', ownerId: 'player-1',
      position: { x: 10, y: 14 }, rotation: 0,
      base: { shape: 'circle', diameterMm: 50 }, canPassOverModels: false, label: 'CIRCLE 0°',
    },
    {
      id: 'demo-ellipse', unitId: 'demo-unit-shapes', ownerId: 'player-1',
      position: { x: 22, y: 14 }, rotation: Math.PI / 6,
      base: { shape: 'ellipse', widthMm: 80, heightMm: 40 }, canPassOverModels: false, label: 'OVAL 30°',
    },
    {
      id: 'demo-rectangle', unitId: 'demo-unit-shapes', ownerId: 'player-1',
      position: { x: 34, y: 14 }, rotation: Math.PI / 4,
      base: { shape: 'rectangle', widthMm: 80, heightMm: 45 }, canPassOverModels: false, label: 'RECT 45°',
    },
    {
      id: 'demo-polygon', unitId: 'demo-unit-shapes', ownerId: 'player-1',
      position: { x: 46, y: 14 }, rotation: Math.PI / 2,
      base: {
        shape: 'polygon',
        verticesMm: [
          { x: -35, y: -12 }, { x: 0, y: -28 }, { x: 35, y: -12 },
          { x: 28, y: 22 }, { x: -28, y: 22 },
        ],
      },
      canPassOverModels: false,
      label: 'HULL 90°',
    },
  ],
  units: [
    {
      id: 'demo-unit-shapes', ownerId: 'player-1', definitionId: 'demo-static',
      modelIds: ['demo-circle', 'demo-ellipse', 'demo-rectangle', 'demo-polygon'],
    },
  ],
  unitDefinitions: [{
    id: 'demo-static', name: 'M6.4 Footprint Movement', movementAllowance: 12,
    coherencyPolicy: { distance: 10, requiredNeighbors: 1, requireConnected: true },
  }],
  actionHistory: [],
  nextActionSequence: 1,
  movementSession: null,
  lastConfirmedMovementUndo: null,
}

/** Reproducible M6.7 orientation-aware Smart Move playground (`?orientationGap=1`). */
export const orientationGapGameState: GameState = {
  ...initialGameState,
  battlefield: { width: 80, height: 60 },
  models: [
    // Keep the original, very narrow orientation gate at the same x/y location.
    model('gap-oval', 'gap-unit', 'player-1', 3, 6,
      { shape: 'ellipse', widthMm: 76.2, heightMm: 25.4 }, 'O', Math.PI / 2),
    model('gap-top', 'gap-top-unit', 'player-2', 10, 2.675,
      { shape: 'rectangle', widthMm: 25.4, heightMm: 135.89 }, ''),
    model('gap-bottom', 'gap-bottom-unit', 'player-2', 10, 33.325,
      { shape: 'rectangle', widthMm: 25.4, heightMm: 1355.09 }, ''),

    // Six-model cavalry starts just beyond the original gate and can test both
    // a tighter turn and the wider, 4-inch gate at x=30.
    ...gridUnit('cav', 'qa-cavalry', 'player-1', { x: 13.5, y: 6 }, 6, 3, 3.45,
      oval(75, 42), 0, 2.25),
    model('wide-top', 'wide-wall-unit', 'player-2', 30, 6.95,
      { shape: 'rectangle', widthMm: 25.4, heightMm: 353.06 }, ''),
    model('wide-bottom', 'wide-wall-unit', 'player-2', 30, 38.95,
      { shape: 'rectangle', widthMm: 25.4, heightMm: 1069.34 }, ''),

    // Distinct formation staging area.
    ...gridUnit('lo', 'qa-large-ovals', 'player-1', { x: 37.5, y: 5 }, 3, 3, 4.15,
      oval(90, 52), Math.PI / 12),
    ...gridUnit('rect', 'qa-rectangles', 'player-2', { x: 52, y: 5 }, 5, 3, 3.25,
      { shape: 'rectangle', widthMm: 70, heightMm: 45 }, Math.PI / 10, 2.3),
    ...gridUnit('hull', 'qa-hulls', 'player-1', { x: 68, y: 5 }, 4, 2, 4.65,
      vehicleHull, Math.PI / 12, 2.7),
    ...gridUnit('circ', 'qa-circles', 'player-2', { x: 38, y: 17 }, 10, 5, 1.8,
      circle(32)),

    // Obstacle practice area: corridor, single blocker, and offset pair.
    ...gridUnit('cor', 'qa-corridor', 'player-2', { x: 43, y: 29 }, 8, 4, 4.1,
      { shape: 'rectangle', widthMm: 90, heightMm: 20 }, 0, 10),
    model('single-blocker', 'qa-single-blocker', 'player-2', 62, 31,
      { shape: 'rectangle', widthMm: 55, heightMm: 55 }, '', Math.PI / 8),
    model('offset-blocker-a', 'qa-offset-blockers', 'player-2', 70, 30,
      { shape: 'rectangle', widthMm: 60, heightMm: 30 }, '', Math.PI / 10),
    model('offset-blocker-b', 'qa-offset-blockers', 'player-2', 75.5, 35,
      { shape: 'rectangle', widthMm: 60, heightMm: 30 }, '', -Math.PI / 10),
  ],
  units: [
    { id: 'gap-unit', ownerId: 'player-1', definitionId: 'gap-mover', modelIds: ['gap-oval'] },
    { id: 'gap-top-unit', ownerId: 'player-2', definitionId: 'gap-wall', modelIds: ['gap-top'] },
    { id: 'gap-bottom-unit', ownerId: 'player-2', definitionId: 'gap-wall', modelIds: ['gap-bottom'] },
    { id: 'qa-cavalry', ownerId: 'player-1', definitionId: 'qa-cavalry-def', modelIds: Array.from({ length: 6 }, (_, index) => `mdl-cav-${String(index + 1).padStart(3, '0')}`) },
    { id: 'wide-wall-unit', ownerId: 'player-2', definitionId: 'qa-blocker-def', modelIds: ['wide-top', 'wide-bottom'] },
    { id: 'qa-large-ovals', ownerId: 'player-1', definitionId: 'qa-large-oval-def', modelIds: ['mdl-lo-001', 'mdl-lo-002', 'mdl-lo-003'] },
    { id: 'qa-rectangles', ownerId: 'player-2', definitionId: 'qa-rectangle-def', modelIds: ['mdl-rect-001', 'mdl-rect-002', 'mdl-rect-003', 'mdl-rect-004', 'mdl-rect-005'] },
    { id: 'qa-hulls', ownerId: 'player-1', definitionId: 'qa-hull-def', modelIds: ['mdl-hull-001', 'mdl-hull-002', 'mdl-hull-003', 'mdl-hull-004'] },
    { id: 'qa-circles', ownerId: 'player-2', definitionId: 'qa-circle-def', modelIds: Array.from({ length: 10 }, (_, index) => `mdl-circ-${String(index + 1).padStart(3, '0')}`) },
    { id: 'qa-corridor', ownerId: 'player-2', definitionId: 'qa-blocker-def', modelIds: Array.from({ length: 8 }, (_, index) => `mdl-cor-${String(index + 1).padStart(3, '0')}`) },
    { id: 'qa-single-blocker', ownerId: 'player-2', definitionId: 'qa-blocker-def', modelIds: ['single-blocker'] },
    { id: 'qa-offset-blockers', ownerId: 'player-2', definitionId: 'qa-blocker-def', modelIds: ['offset-blocker-a', 'offset-blocker-b'] },
  ],
  unitDefinitions: [
    { id: 'gap-mover', name: 'Orientation Gap Oval', movementAllowance: 12,
      coherencyPolicy: { distance: 1, requiredNeighbors: 0, requireConnected: true } },
    { id: 'gap-wall', name: 'Gap Wall', movementAllowance: 0,
      coherencyPolicy: { distance: 0, requiredNeighbors: 0, requireConnected: true } },
    { id: 'qa-cavalry-def', name: 'QA Oval Cavalry', movementAllowance: 10,
      coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'qa-large-oval-def', name: 'QA Large Ovals', movementAllowance: 8,
      coherencyPolicy: { distance: 2, requiredNeighbors: 1, requireConnected: true } },
    { id: 'qa-rectangle-def', name: 'QA Rectangles', movementAllowance: 6,
      coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'qa-hull-def', name: 'QA Hulls', movementAllowance: 10,
      coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'qa-circle-def', name: 'QA Normal Circles', movementAllowance: 6,
      coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true } },
    { id: 'qa-blocker-def', name: 'QA Blockers', movementAllowance: 0,
      coherencyPolicy: { distance: 0, requiredNeighbors: 0, requireConnected: false } },
  ],
}
