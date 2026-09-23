import { describe, expect, it } from 'vitest'
import type { GameContext, Player, TabletopModel, Unit, UnitDefinition } from '../domain/types'
import type { SmartMoveResult } from './smartMove'
import { projectModelsForSmartMove } from '../tools/projectedSpatialState'
import { evaluateObjectiveControl } from './objectiveControl'
import { battlefieldFeatureDemoGameState } from '../game/battlefieldFeatureDemo'
import { objectiveArea } from './areaRelationships'
import { developmentGameSystem } from '../gameSystem/developmentGameSystem'

const players: Player[] = [
  { id: 'p1', displayName: 'Player 1' },
  { id: 'p2', displayName: 'Player 2' },
]
const gameContext: GameContext = {
  round: 1, turn: 1, turnSequence: 1, turnId: 'turn-1', activePlayerId: 'p1', phase: 'move',
}
const area = {
  footprint: { shape: 'circle' as const, diameterMm: 152.4 },
  pose: { position: { x: 5, y: 5 }, rotation: 0 },
}
const objective = {
  qualification: 'center-within' as const,
  control: { type: 'model-or-unit-value' as const, defaultValue: 0 },
}

function model(id: string, unitId: string, ownerId: string, x: number, y: number, oc?: number): TabletopModel {
  return {
    id, unitId, ownerId, position: { x, y }, rotation: 0,
    base: { shape: 'circle', diameterMm: 25 }, canPassOverModels: false,
    ...(oc === undefined ? {} : { objectiveControl: oc }),
  }
}

describe('objective control', () => {
  it('qualifies with M8 policy and aggregates differing model/unit OC values', () => {
    const models = [
      ...Array.from({ length: 5 }, (_, index) => model(`p1-${index}`, 'u1', 'p1', 3 + index, 5)),
      model('p2-big', 'u2', 'p2', 5, 6, 10),
      model('outside', 'u2', 'p2', 20, 20, 100),
    ]
    const units: Unit[] = [
      { id: 'u1', ownerId: 'p1', definitionId: 'infantry', modelIds: models.slice(0, 5).map((entry) => entry.id) },
      { id: 'u2', ownerId: 'p2', definitionId: 'large', modelIds: ['p2-big', 'outside'] },
    ]
    const definitions: UnitDefinition[] = [
      { id: 'infantry', name: 'Infantry', movementAllowance: 6, objectiveControl: 1 },
      { id: 'large', name: 'Large', movementAllowance: 6, objectiveControl: 2 },
    ]
    const result = evaluateObjectiveControl({
      area, players, models, units, unitDefinitions: definitions, gameContext, objective,
    })!
    expect(result.players.map((entry) => [entry.qualifyingModelCount, entry.totalControl]))
      .toEqual([[5, 5], [1, 10]])
    expect(result).toMatchObject({ state: 'controlled', controllingPlayerId: 'p2' })
  })

  it('represents ties as contested and zero contribution as uncontrolled', () => {
    const units: Unit[] = [
      { id: 'u1', ownerId: 'p1', definitionId: 'zero', modelIds: ['a'] },
      { id: 'u2', ownerId: 'p2', definitionId: 'zero', modelIds: ['b'] },
    ]
    const definitions: UnitDefinition[] = [{ id: 'zero', name: 'Zero', movementAllowance: 6 }]
    const tied = evaluateObjectiveControl({
      area, players,
      models: [model('a', 'u1', 'p1', 5, 5, 2), model('b', 'u2', 'p2', 5, 5, 2)],
      units, unitDefinitions: definitions, gameContext, objective,
    })!
    expect(tied).toMatchObject({ state: 'contested', controllingPlayerId: null })
    const nobody = evaluateObjectiveControl({
      area, players,
      models: [model('a', 'u1', 'p1', 5, 5), model('b', 'u2', 'p2', 5, 5)],
      units, unitDefinitions: definitions, gameContext, objective,
    })!
    expect(nobody).toMatchObject({ state: 'uncontrolled', controllingPlayerId: null })
  })

  it('uses projected Smart Move poses without mutating authoritative control', () => {
    const models = [model('a', 'u1', 'p1', 12, 5, 3)]
    const units: Unit[] = [{ id: 'u1', ownerId: 'p1', definitionId: 'd', modelIds: ['a'] }]
    const definitions: UnitDefinition[] = [{ id: 'd', name: 'Test', movementAllowance: 6 }]
    const preview: SmartMoveResult = {
      valid: true, target: { x: 5, y: 5 }, unitId: 'u1', selectedModelIds: ['a'],
      positions: { a: { x: 5, y: 5 } },
      assignments: [{ modelId: 'a', slotIndex: 0, start: { x: 12, y: 5 }, destination: { x: 5, y: 5 },
        path: [{ x: 12, y: 5 }, { x: 5, y: 5 }], movementCost: 7, movementRemaining: 0 }],
      totalMovementCost: 7,
      validation: { movement: true, collision: true, battlefield: true, coherency: true },
      formationValidation: null, coherency: null, failureReasons: [], candidatesTested: 1, diagnostics: null,
    }
    const before = evaluateObjectiveControl({ area, players, models, units,
      unitDefinitions: definitions, gameContext, objective })!
    const projected = evaluateObjectiveControl({ area, players,
      models: projectModelsForSmartMove(models, preview), units,
      unitDefinitions: definitions, gameContext, objective })!
    expect(before.state).toBe('uncontrolled')
    expect(projected).toMatchObject({ state: 'controlled', controllingPlayerId: 'p1' })
    expect(models[0].position).toEqual({ x: 12, y: 5 })
  })

  it('provides the QA board 5 × OC1 versus 1 × OC10 fixture', () => {
    const feature = battlefieldFeatureDemoGameState.battlefieldFeatures
      ?.find((candidate) => candidate.id === 'demo-objective')
    const fixtureArea = feature ? objectiveArea(feature) : null
    expect(fixtureArea).not.toBeNull()
    const result = evaluateObjectiveControl({
      area: fixtureArea!, players: battlefieldFeatureDemoGameState.players,
      models: battlefieldFeatureDemoGameState.models,
      units: battlefieldFeatureDemoGameState.units,
      unitDefinitions: battlefieldFeatureDemoGameState.unitDefinitions,
      gameContext: battlefieldFeatureDemoGameState.gameContext,
      objective: developmentGameSystem.objectives,
    })!
    const player1 = result.players.find((entry) => entry.playerId === 'player-1')!
    const player2 = result.players.find((entry) => entry.playerId === 'player-2')!
    expect(player1).toMatchObject({ qualifyingModelCount: 5, totalControl: 5 })
    expect(player2.totalControl).toBe(10)
    expect(result).toMatchObject({ state: 'controlled', controllingPlayerId: 'player-2' })
  })
})
