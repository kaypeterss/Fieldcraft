import { describe, expect, it } from 'vitest'
import type { GameState, JsonValue, Pose } from '../../domain/types'
import { modelPresence } from '../../game/modelPresence'
import { reduceGameCommand } from '../../state/commandBoundary'
import { compactFormationPlacements } from '../../tools/lifecyclePlacement'
import { gameSystemRegistry } from '../registeredGameSystems'
import { loadRegisteredMatchRuntime } from '../runtime'
import { createAgeOfSigmarAlphaMatch } from './ageOfSigmarMatch'
import { aosDeploymentPlacementRules, aosDeploymentState, validateAosDeploymentPlacements } from './deployment'
import { prepareAgeOfSigmarMatch } from './prepareAgeOfSigmarMatch'

function command(state: GameState, type: string, actorPlayerId: string, payload?: JsonValue): GameState {
  return reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
    type: 'gameSystem/command', command: { type, actorPlayerId, payload },
  })
}

function readyToDeploy(): GameState {
  let state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch({ matchId: 'deployment-test' }))
  state = command(state, 'aos/deployment/roll-off', 'player-1', { player1: 6, player2: 2 })
  state = command(state, 'aos/deployment/choose-attacker', 'player-1', { attackerPlayerId: 'player-1' })
  return command(state, 'aos/deployment/choose-territory', 'player-1', { zoneId: 'attacker-territory' })
}

function unitPlacements(state: GameState, unitId: string, center: { x: number; y: number }): Record<string, Pose> {
  const unit = state.units.find((candidate) => candidate.id === unitId)!
  return compactFormationPlacements(unit.modelIds.map((id) => state.models.find((model) => model.id === id)!), center)
}

function deploy(state: GameState, unitId: string, center: { x: number; y: number }): GameState {
  const unit = state.units.find((candidate) => candidate.id === unitId)!
  return command(state, 'aos/deployment/deploy-unit', unit.ownerId, {
    unitId,
    placements: unitPlacements(state, unitId, center),
  } as unknown as JsonValue)
}

describe('Age of Sigmar deployment adapter', () => {
  it('upgrades an M9.2 prepared save lazily without rebuilding its battlefield content', () => {
    const state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch())
    const data = state.gameSystemState!.data as Record<string, JsonValue>
    const legacy: GameState = {
      ...state,
      gameSystemState: { ...state.gameSystemState!, data: { status: data.status, setup: data.setup } },
    }
    expect(() => loadRegisteredMatchRuntime(legacy, gameSystemRegistry)).not.toThrow()
    expect(aosDeploymentState(legacy)?.phase).toBe('ROLL_OFF')
    const advanced = command(legacy, 'aos/deployment/roll-off', 'player-1', { player1: 6, player2: 1 })
    expect(aosDeploymentState(advanced)?.phase).toBe('CHOOSE_ROLES')
    expect(advanced.battlefieldFeatures).toEqual(legacy.battlefieldFeatures)
  })

  it('records ties and lets the roll-off winner choose roles before the attacker chooses territory', () => {
    let state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch())
    state = command(state, 'aos/deployment/roll-off', 'player-1', { player1: 3, player2: 3 })
    expect(aosDeploymentState(state)).toMatchObject({ phase: 'ROLL_OFF', rolls: [{ player1: 3, player2: 3 }] })
    state = command(state, 'aos/deployment/roll-off', 'player-1', { player1: 2, player2: 5 })
    expect(aosDeploymentState(state)).toMatchObject({ phase: 'CHOOSE_ROLES', rollWinnerPlayerId: 'player-2' })
    const rejected = command(state, 'aos/deployment/choose-attacker', 'player-1', { attackerPlayerId: 'player-1' })
    expect(rejected).toBe(state)
    state = command(state, 'aos/deployment/choose-attacker', 'player-2', { attackerPlayerId: 'player-1' })
    expect(aosDeploymentState(state)).toMatchObject({
      phase: 'CHOOSE_TERRITORY', attackerPlayerId: 'player-1', defenderPlayerId: 'player-2',
    })
    state = command(state, 'aos/deployment/choose-territory', 'player-1', { zoneId: 'defender-territory' })
    expect(aosDeploymentState(state)).toMatchObject({
      phase: 'DEPLOYING', currentPlayerId: 'player-1',
      territoryByPlayerId: { 'player-1': 'defender-territory', 'player-2': 'attacker-territory' },
    })
    expect(state.resolvedMatchConfiguration?.deploymentZones.find((zone) => zone.id === 'defender-territory')?.ownerRole)
      .toBe('attacker')
    expect(state.lastCommittedOperationUndo).toBeNull()
  })

  it('uses actual footprints for wholly-within and enemy-territory distance constraints', () => {
    const state = readyToDeploy()
    const rules = aosDeploymentPlacementRules(state, 'sce-knight-questor')
    expect(rules).toMatchObject({ enemyTerritoryExclusionDistance: 9 })
    expect(rules?.areaConstraints[1]).toMatchObject({ type: 'minimum-distance-from-area-union', distance: 9 })
    const legal = unitPlacements(state, 'sce-knight-questor', { x: 5, y: 3 })
    expect(validateAosDeploymentPlacements(state, 'sce-knight-questor', legal)?.valid).toBe(true)
    const modelId = Object.keys(legal)[0]
    const outside = { [modelId]: { ...legal[modelId], position: { x: 0.1, y: 3 } } }
    expect(validateAosDeploymentPlacements(state, 'sce-knight-questor', outside)?.violations)
      .toContainEqual(expect.objectContaining({ type: 'OUTSIDE_REQUIRED_AREA' }))
    const tooClose = { [modelId]: { ...legal[modelId], position: { x: 5, y: 7 } } }
    expect(validateAosDeploymentPlacements(state, 'sce-knight-questor', tooClose)?.violations)
      .toContainEqual(expect.objectContaining({ type: 'TOO_CLOSE_TO_AREA' }))
  })

  it('rejects wrong-player commands, commits a complete unit atomically, advances, and allows gated Undo', () => {
    let state = readyToDeploy()
    const placements = unitPlacements(state, 'sce-knight-questor', { x: 5, y: 3 })
    const wrongPlayer = command(state, 'aos/deployment/deploy-unit', 'player-2', {
      unitId: 'sce-knight-questor', placements,
    } as unknown as JsonValue)
    expect(wrongPlayer).toBe(state)

    state = command(state, 'aos/deployment/deploy-unit', 'player-1', {
      unitId: 'sce-knight-questor', placements,
    } as unknown as JsonValue)
    expect(modelPresence(state.models.find((model) => model.id === 'sce-knight-questor-1')!)).toBe('ON_BATTLEFIELD')
    expect(aosDeploymentState(state)).toMatchObject({
      currentPlayerId: 'player-2', deployedUnitIds: ['sce-knight-questor'],
      facts: [expect.objectContaining({ ability: 'DEPLOY_UNIT', unitId: 'sce-knight-questor' })],
    })
    expect(state.committedOperations?.at(-1)?.type).toBe('GAME_SYSTEM')

    const undone = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'history/undoLastCommitted',
    })
    expect(modelPresence(undone.models.find((model) => model.id === 'sce-knight-questor-1')!)).toBe('OFF_BOARD')
    expect(aosDeploymentState(undone)?.currentPlayerId).toBe('player-1')
  })

  it('enforces the current seven-or-more two-neighbour coherency policy for Clanrats', () => {
    let state = readyToDeploy()
    state = deploy(state, 'sce-knight-questor', { x: 5, y: 3 })
    const coherent = unitPlacements(state, 'skv-clanrats', { x: 6, y: 27 })
    expect(validateAosDeploymentPlacements(state, 'skv-clanrats', coherent)?.valid).toBe(true)
    const isolatedId = Object.keys(coherent)[0]
    const incoherent = { ...coherent, [isolatedId]: { ...coherent[isolatedId], position: { x: 18, y: 27 } } }
    expect(validateAosDeploymentPlacements(state, 'skv-clanrats', incoherent)?.violations)
      .toContainEqual(expect.objectContaining({ type: 'COHERENCY_FAILED' }))
    expect(state.unitDefinitions.find((definition) => definition.id === 'aos-clanrats')?.coherencyPolicy)
      .toMatchObject({ distance: 0.5, requiredNeighbors: 2, requireConnected: true })
  })

  it('round-trips mid-deployment and completed deployment state without recomputation', () => {
    let state = readyToDeploy()
    state = deploy(state, 'sce-knight-questor', { x: 5, y: 3 })
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    expect(() => loadRegisteredMatchRuntime(restored, gameSystemRegistry)).not.toThrow()
    expect(aosDeploymentState(restored)).toEqual(aosDeploymentState(state))
    expect(restored.models).toEqual(state.models)

    const oneEach: GameState = {
      ...readyToDeploy(),
      units: readyToDeploy().units.filter((unit) => ['sce-knight-questor', 'skv-clawlord'].includes(unit.id)),
    }
    oneEach.models = oneEach.models.filter((model) => oneEach.units.some((unit) => unit.modelIds.includes(model.id)))
    oneEach.unitDefinitions = oneEach.unitDefinitions.filter((definition) => oneEach.units.some((unit) => unit.definitionId === definition.id))
    let complete = deploy(oneEach, 'sce-knight-questor', { x: 5, y: 3 })
    complete = deploy(complete, 'skv-clawlord', { x: 5, y: 27 })
    expect(aosDeploymentState(complete)?.phase).toBe('READY_FOR_BATTLE')
    const completedRestore = JSON.parse(JSON.stringify(complete)) as GameState
    expect(() => loadRegisteredMatchRuntime(completedRestore, gameSystemRegistry)).not.toThrow()
    expect(aosDeploymentState(completedRestore)?.phase).toBe('READY_FOR_BATTLE')
    expect(completedRestore.models.every((model) => modelPresence(model) === 'ON_BATTLEFIELD')).toBe(true)
  })

  it('deploys the complete controlled Stormcast and Skaven forces to Ready for Battle', () => {
    let state = readyToDeploy()
    const drops: Array<[string, { x: number; y: number }]> = [
      ['sce-knight-questor', { x: 3, y: 3 }],
      ['skv-clawlord', { x: 3, y: 27 }],
      ['sce-liberators', { x: 8, y: 3 }],
      ['skv-clanrats', { x: 8, y: 27 }],
      ['sce-vanguard-raptors', { x: 15, y: 3 }],
      ['skv-rat-ogors', { x: 15, y: 27 }],
      ['sce-dracothian-guard', { x: 39, y: 4 }],
      ['skv-jezzails', { x: 39, y: 26 }],
    ]
    for (const [unitId, center] of drops) {
      const before = state
      state = deploy(state, unitId, center)
      expect(state, `${unitId} should deploy legally`).not.toBe(before)
    }
    expect(aosDeploymentState(state)).toMatchObject({
      phase: 'READY_FOR_BATTLE',
      deployedUnitIds: drops.map(([unitId]) => unitId),
    })
    expect(state.models.every((model) => modelPresence(model) === 'ON_BATTLEFIELD')).toBe(true)
    expect(state.committedOperations?.filter((operation) => operation.type === 'GAME_SYSTEM')).toHaveLength(8)
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    expect(() => loadRegisteredMatchRuntime(restored, gameSystemRegistry)).not.toThrow()
    expect(aosDeploymentState(restored)?.phase).toBe('READY_FOR_BATTLE')
  })
})
