import type { BattlefieldFeature, GameState, TabletopModel } from '../domain/types'
import { createPolygonFootprint } from '../engine/geometry/footprints'
import { footprintDemoGameState } from './initialState'

/** Opt-in M7 development fixture. Rules below are generic QA policies only. */
export const battlefieldFeatureDemoFeatures: BattlefieldFeature[] = [
  {
    id: 'demo-ruin',
    name: 'Ruined Corner',
    pose: { position: { x: 12, y: 12 }, rotation: Math.PI / 12 },
    baseArea: createPolygonFootprint([
      { x: -115, y: -70 }, { x: 70, y: -75 }, { x: 120, y: -20 },
      { x: 85, y: 80 }, { x: -90, y: 75 }, { x: -125, y: 20 },
    ]),
    capabilities: { terrain: { type: 'terrain' } },
    objects: [
      { id: 'ruin-wall-a', name: 'Wall A', footprint: { shape: 'rectangle', widthMm: 125, heightMm: 16 },
        localPose: { position: { x: -0.7, y: -1.6 }, rotation: 0 } },
      { id: 'ruin-wall-b', name: 'Wall B', footprint: { shape: 'rectangle', widthMm: 95, heightMm: 16 },
        localPose: { position: { x: -2.15, y: 0.15 }, rotation: Math.PI / 2 } },
    ],
  },
  {
    id: 'demo-objective',
    name: 'Open Objective',
    pose: { position: { x: 5, y: 35 }, rotation: 0 },
    baseArea: { shape: 'circle', diameterMm: 150 },
    capabilities: { objective: { type: 'objective', area: { type: 'feature-base' } } },
    objects: [],
  },
  {
    id: 'demo-impassable',
    name: 'Impassable Ground',
    pose: { position: { x: 31, y: 25 }, rotation: Math.PI / 18 },
    baseArea: { shape: 'rectangle', widthMm: 190, heightMm: 130 },
    capabilities: { terrain: { type: 'terrain' } },
    objects: [],
  },
  {
    id: 'demo-combined',
    name: 'Signal Ruin',
    pose: { position: { x: 20, y: 24 }, rotation: Math.PI / 9 },
    baseArea: createPolygonFootprint([
      { x: -110, y: -80 }, { x: 75, y: -70 }, { x: 120, y: -10 },
      { x: 95, y: 75 }, { x: -80, y: 90 }, { x: -125, y: 15 },
    ]),
    capabilities: {
      terrain: { type: 'terrain' },
      objective: { type: 'objective', area: { type: 'feature-base' } },
    },
    objects: [
      { id: 'signal-wall', name: 'Signal Wall', footprint: { shape: 'rectangle', widthMm: 145, heightMm: 18 },
        localPose: { position: { x: 0, y: -1.1 }, rotation: Math.PI / 16 } },
    ],
  },
  {
    id: 'demo-custom-objective',
    name: 'Oval Relay',
    pose: { position: { x: 9, y: 25 }, rotation: Math.PI / 10 },
    baseArea: { shape: 'rectangle', widthMm: 35, heightMm: 35 },
    capabilities: { objective: { type: 'objective', area: {
      type: 'local-footprint', footprint: { shape: 'ellipse', widthMm: 150, heightMm: 95 },
      localPose: { position: { x: 0, y: 0 }, rotation: Math.PI / 8 },
    } } },
    objects: [],
  },
  {
    id: 'demo-point-objective',
    name: 'Signal Beacon',
    pose: { position: { x: 27, y: 38 }, rotation: 0 },
    baseArea: { shape: 'circle', diameterMm: 20 },
    capabilities: { objective: { type: 'objective', area: {
      type: 'point-range', localPoint: { x: 0, y: 0 }, rangeInches: 2.5,
    } } },
    objects: [],
  },
  {
    id: 'demo-visibility-ruin',
    name: 'Visibility Ruin',
    pose: { position: { x: 46, y: 12 }, rotation: 0 },
    baseArea: createPolygonFootprint([
      { x: -100, y: -72 }, { x: 82, y: -76 }, { x: 108, y: -28 },
      { x: 94, y: 70 }, { x: -88, y: 78 }, { x: -112, y: 18 },
    ]),
    capabilities: { terrain: { type: 'terrain' } },
    objects: [
      { id: 'visibility-wall', name: 'Visibility Wall',
        footprint: { shape: 'rectangle', widthMm: 125, heightMm: 16 },
        localPose: { position: { x: 0, y: 0 }, rotation: 0 } },
    ],
  },
]

const terrainTestModels: TabletopModel[] = [
  { id: 'qa-ground', unitId: 'qa-ground-unit', ownerId: 'player-1', position: { x: 4, y: 11 },
    rotation: 0, base: { shape: 'circle', diameterMm: 32 }, canPassOverModels: false, label: 'ROUTE' },
  { id: 'qa-phaser', unitId: 'qa-phaser-unit', ownerId: 'player-1', position: { x: 4, y: 13.1 },
    rotation: 0, base: { shape: 'circle', diameterMm: 32 }, canPassOverModels: false, label: 'CROSS' },
  { id: 'qa-oval', unitId: 'qa-oval-unit', ownerId: 'player-1', position: { x: 4, y: 18 },
    rotation: Math.PI / 8, base: { shape: 'ellipse', widthMm: 75, heightMm: 42 },
    canPassOverModels: false, label: 'OVAL' },
  { id: 'qa-impassable-mover', unitId: 'qa-impassable-unit', ownerId: 'player-2', position: { x: 25.5, y: 22.5 },
    rotation: 0, base: { shape: 'circle', diameterMm: 32 }, canPassOverModels: false, label: 'BASE' },
  { id: 'qa-objective-oval', unitId: 'qa-objective-oval-unit', ownerId: 'player-1', position: { x: 14.2, y: 22.6 },
    rotation: Math.PI / 6, base: { shape: 'ellipse', widthMm: 75, heightMm: 42 },
    canPassOverModels: false, label: 'OVAL EDGE' },
  { id: 'qa-los-viewer', unitId: 'qa-los-viewer-unit', ownerId: 'player-1', position: { x: 39, y: 12 },
    rotation: Math.PI / 8, base: { shape: 'ellipse', widthMm: 75, heightMm: 42 },
    canPassOverModels: false, label: 'LOS VIEWER' },
  { id: 'qa-los-target', unitId: 'qa-los-target-unit', ownerId: 'player-2', position: { x: 53, y: 12 },
    rotation: Math.PI / 4, base: createPolygonFootprint([
      { x: -38, y: -24 }, { x: 34, y: -26 }, { x: 48, y: 0 },
      { x: 34, y: 26 }, { x: -38, y: 24 },
    ]), canPassOverModels: false, label: 'LOS TARGET' },
  { id: 'qa-los-clear', unitId: 'qa-los-clear-unit', ownerId: 'player-2', position: { x: 53, y: 5 },
    rotation: Math.PI / 2, base: { shape: 'rectangle', widthMm: 60, heightMm: 40 },
    canPassOverModels: false, label: 'LOS CLEAR' },
]

const objectiveInfantry: TabletopModel[] = Array.from({ length: 10 }, (_, index) => ({
  id: `qa-objective-${index + 1}`, unitId: 'qa-objective-unit', ownerId: 'player-2',
  position: { x: 15 + (index % 5) * 2.1, y: 24.9 + Math.floor(index / 5) * 2.1 },
  rotation: 0, base: { shape: 'circle' as const, diameterMm: 32 },
  canPassOverModels: false, label: String(index + 1),
}))

const allow = { canEnter: true, canCross: true, canFinish: true }
const block = { canEnter: false, canCross: false, canFinish: false }

export const battlefieldFeatureDemoGameState: GameState = {
  ...footprintDemoGameState,
  models: footprintDemoGameState.models.map((model) => ({
    ...model,
    position: { x: model.position.x, y: model.position.y + 20 },
  })).concat(terrainTestModels, objectiveInfantry),
  units: [...footprintDemoGameState.units, ...terrainTestModels.map((model) => ({
    id: model.unitId, ownerId: model.ownerId, definitionId: 'qa-terrain-mover', modelIds: [model.id],
  })), { id: 'qa-objective-unit', ownerId: 'player-2', definitionId: 'qa-objective-infantry',
    modelIds: objectiveInfantry.map((model) => model.id) }],
  unitDefinitions: [...footprintDemoGameState.unitDefinitions, {
    id: 'qa-terrain-mover', name: 'Terrain QA Mover', movementAllowance: 18,
    coherencyPolicy: { distance: 0, requiredNeighbors: 0, requireConnected: true },
  }, {
    id: 'qa-objective-infantry', name: 'Objective Infantry 10', movementAllowance: 6,
    coherencyPolicy: { distance: 1, requiredNeighbors: 1, requireConnected: true },
  }],
  battlefieldFeatures: battlefieldFeatureDemoFeatures,
  terrainPolicy: {
    defaultBase: allow,
    defaultObject: block,
    rules: [
      { featureId: 'demo-impassable', permissions: block },
      { featureId: 'demo-ruin', objectId: 'ruin-wall-b', modelId: 'qa-phaser',
        permissions: { canEnter: true, canCross: true, canFinish: false } },
    ],
  },
}
