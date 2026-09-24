import type { BattlefieldFeature, GameState, TabletopModel, Unit } from '../domain/types'
import { battlefieldFeatureDemoFeatures } from './battlefieldFeatureDemo'
import { initialGameState } from './initialState'
import { developmentContentManifest } from '../gameSystem/developmentGameSystem'

function modelsForUnit(unitId: string): TabletopModel[] {
  return initialGameState.models
    .filter((model) => model.unitId === unitId)
    .map((model) => structuredClone(model))
}

function arrangeGrid(
  models: TabletopModel[],
  origin: { x: number; y: number },
  columns: number,
  xSpacing: number,
  ySpacing = xSpacing,
): TabletopModel[] {
  return models.map((model, index) => ({
    ...model,
    position: {
      x: origin.x + (index % columns) * xSpacing,
      y: origin.y + Math.floor(index / columns) * ySpacing,
    },
    presence: 'ON_BATTLEFIELD',
  }))
}

const infantry = arrangeGrid(modelsForUnit('unit-a'), { x: 6, y: 7 }, 5, 1.9)
const cavalry = arrangeGrid(modelsForUnit('unit-cavalry'), { x: 6, y: 20 }, 3, 3.4, 2.2)
const enemy = arrangeGrid(modelsForUnit('unit-b'), { x: 45, y: 8 }, 3, 2.7, 2.7)

const reserve: TabletopModel = {
  ...structuredClone(initialGameState.models.find((model) => model.id === 'mdl-b-001')!),
  id: 'lifecycle-reserve', unitId: 'lifecycle-support', label: 'Enemy Reserve',
  position: { x: 47, y: 20 }, presence: 'OFF_BOARD',
}
const destroyed: TabletopModel = {
  ...structuredClone(initialGameState.models.find((model) => model.id === 'mdl-b-002')!),
  id: 'lifecycle-destroyed', unitId: 'lifecycle-support', label: 'Destroyed Enemy',
  position: { x: 51, y: 20 }, presence: 'DESTROYED',
}

const sourceUnits = new Map(initialGameState.units.map((unit) => [unit.id, unit]))
const units: Unit[] = ['unit-a', 'unit-cavalry', 'unit-b'].map((unitId) => structuredClone(sourceUnits.get(unitId)!))
units.push({
  id: 'lifecycle-support', ownerId: 'player-2', definitionId: 'def-elite-large',
  modelIds: [reserve.id, destroyed.id],
})

const features: BattlefieldFeature[] = [
  {
    ...structuredClone(battlefieldFeatureDemoFeatures.find((feature) => feature.id === 'demo-ruin')!),
    id: 'lifecycle-ruin', name: 'Lifecycle Ruin', pose: { position: { x: 30, y: 15 }, rotation: Math.PI / 12 },
  },
  {
    ...structuredClone(battlefieldFeatureDemoFeatures.find((feature) => feature.id === 'demo-objective')!),
    id: 'lifecycle-objective', name: 'Lifecycle Objective', pose: { position: { x: 30, y: 34 }, rotation: 0 },
  },
]

/** Opt-in M9.0 lifecycle and placement QA board (`?lifecycle=1`). */
export const lifecycleDemoGameState: GameState = {
  ...initialGameState,
  matchIdentity: {
    ...initialGameState.matchIdentity!,
    contentManifest: developmentContentManifest.map((entry) => ({ ...entry })),
    mission: { id: 'development-lifecycle-qa', version: '1' },
  },
  resolvedMatchConfiguration: {
    ...initialGameState.resolvedMatchConfiguration!,
    id: 'development-lifecycle-qa-match',
    objectiveFeatureIds: ['lifecycle-objective'],
  },
  models: [...infantry, ...cavalry, ...enemy, reserve, destroyed],
  units,
  unitDefinitions: initialGameState.unitDefinitions
    .filter((definition) => ['def-standard-infantry', 'def-oval-cavalry', 'def-elite-large'].includes(definition.id))
    .map((definition) => structuredClone(definition)),
  battlefieldFeatures: features,
  terrainPolicy: {
    defaultBase: { canEnter: true, canCross: true, canFinish: true },
    defaultObject: { canEnter: false, canCross: false, canFinish: false },
    rules: [],
  },
  actionHistory: [],
  committedOperations: [],
  nextActionSequence: 1,
  movementSession: null,
  lastCommittedOperationUndo: null,
  lastConfirmedMovementUndo: null,
}
