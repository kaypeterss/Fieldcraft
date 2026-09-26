import { describe, expect, it } from 'vitest'
import type { GameState, JsonValue } from '../../domain/types'
import { resolveDiceSequence } from '../../engine/diceSequence'
import { rollDice } from '../../engine/dice'
import { activeBattlefieldModels } from '../../game/modelPresence'
import { deserializeMatch, serializeMatch } from '../../game/matchPersistence'
import { gameReducer } from '../../state/reducer'
import { reduceGameCommand } from '../../state/commandBoundary'
import { gameSystemRegistry } from '../registeredGameSystems'
import { loadRegisteredMatchRuntime } from '../runtime'
import { createAosChargePileInDemo } from './chargePileInDemo'
import { aosUnitDamagePresentation, deriveAosCombatModelMarkers } from './combatPresentation'
import {
  aosAttackingModelIdsForTarget,
  aosAttackCountForTarget,
  aosAttackProfileOptions,
  aosAttackSequenceDefinition,
  aosAttackSequenceModifiers,
  aosDamageAllocationOptions,
  aosCoherencyCorrectionOptions,
  aosFightAvailability,
  aosUnitAllocatedDamage,
  aosUnitProfile,
  effectiveAosSave,
  ensureAosCombatState,
} from './combat'
import { aosMatchStateData } from './deployment'

function command(state: GameState, type: string, actorPlayerId: string, payload?: JsonValue): GameState {
  return reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
    type: 'gameSystem/command', command: { type, actorPlayerId, payload },
  })
}

function random(values: number[]) {
  let index = 0
  return { next: () => ((values[index++] ?? 1) - 0.5) / 6 }
}

function recordSequence(state: GameState, playerId: string, unitId: string, profileId: string, targetUnitId: string, values: number[]) {
  const attacker = state.units.find((unit) => unit.id === unitId)!
  const target = state.units.find((unit) => unit.id === targetUnitId)!
  const weapon = aosUnitProfile(state, attacker)!.weapons.find((entry) => entry.id === profileId)!
  const targetProfile = aosUnitProfile(state, target)!
  const attacks = aosAttackCountForTarget(state, unitId, profileId, targetUnitId)
  const definition = aosAttackSequenceDefinition({ id: `test:${unitId}:${profileId}:${targetUnitId}`, attacks, weapon, target: targetProfile })
  const resolution = resolveDiceSequence(definition, random(values), aosAttackSequenceModifiers(weapon))
  const id = `dice-sequence-${state.nextActionSequence}`
  return {
    state: gameReducer(state, { type: 'dice/sequenceRecorded', playerId, resolution }), id, resolution,
  }
}

function declareProfiles(state: GameState, playerId: string, targetUnitId: string): GameState {
  const fight = ensureAosCombatState(aosMatchStateData(state)!, state).activeFight!
  const allocations = aosAttackProfileOptions(state, fight.unitId)
    .filter((option) => option.maximumAttacks > 0 && !option.unsupportedReason)
    .map((option) => ({
      profileId: option.profile.id,
      targetUnitId,
      attacks: aosAttackCountForTarget(state, fight.unitId, option.profile.id, targetUnitId),
    }))
  return command(state, 'aos/combat/declare-attacks', playerId, {
    allocations,
  })
}

function combatState(activeIds = ['sce-knight-questor-1', 'skv-clawlord-1'], wardQa = false): GameState {
  const base = createAosChargePileInDemo(true)
  const active = new Set(activeIds)
  const positions = new Map(activeIds.map((id, index) => [id, { x: 10 + (index % 2) * 2.1, y: 10 + Math.floor(index / 2) * 0.1 }]))
  return {
    ...base,
    units: wardQa ? base.units : base.units.map((unit) => unit.id === 'skv-clawlord'
      ? { ...unit, definitionId: 'aos-clawlord-on-gnaw-beast' } : unit),
    unitDefinitions: wardQa ? base.unitDefinitions : base.unitDefinitions.map((definition) => definition.id === 'aos-qa-ward-guard'
      ? { ...definition, id: 'aos-clawlord-on-gnaw-beast', name: 'Clawlord on Gnaw-beast' } : definition),
    models: base.models.map((model) => ({
      ...model,
      presence: active.has(model.id) ? 'ON_BATTLEFIELD' as const : 'OFF_BOARD' as const,
      position: positions.get(model.id) ?? model.position,
    })),
  }
}

describe('Age of Sigmar Fight and damage', () => {
  it('presents two casualties plus a one-point unit remainder without marking a survivor', () => {
    let state = createAosChargePileInDemo(true)
    const coherentPositions = [
      { x: 17, y: 18 }, { x: 18.5, y: 18 }, { x: 20, y: 18 },
      { x: 17.75, y: 19.4 }, { x: 19.25, y: 19.4 },
    ]
    state = { ...state, models: state.models.map((model) => model.unitId === 'sce-liberators'
      ? { ...model, position: coherentPositions[Number(model.id.slice(-1)) - 1] } : model) }
    const data = aosMatchStateData(state)!
    state = { ...state, gameSystemState: { ...state.gameSystemState!, data: { ...data, combat: {
      foughtUnitIds: [], allocatedDamageByUnitId: {}, fightFacts: [], destroyedUnitFacts: [],
      turnId: state.gameContext.turnId,
      activeFight: { unitId: 'skv-rat-ogors', playerId: 'player-2', turnId: state.gameContext.turnId,
        stage: 'ALLOCATE_DAMAGE', pileInComplete: true, resolvedProfileIds: [], pendingDamage: {
          attackerUnitId: 'skv-rat-ogors', targetUnitId: 'sce-liberators', profileId: 'claws-blades-fangs',
          sequenceRecordId: 'test', attacks: 3, hits: 3, criticalMortalHits: 0, wounds: 3,
          saved: 0, unsaved: 3, grossDamage: 5, wardPrevented: 0, remaining: 5, slainModelIds: [],
        } },
    } } as unknown as JsonValue } }
    state = command(state, 'aos/combat/allocate-damage', 'player-1', { modelId: 'sce-liberators-4' })
    state = command(state, 'aos/combat/allocate-damage', 'player-1', { modelId: 'sce-liberators-5' })
    state = command(state, 'aos/combat/allocate-damage', 'player-1', {})
    expect(state.models.filter((model) => model.unitId === 'sce-liberators' && model.presence === 'DESTROYED').map((model) => model.id))
      .toEqual(['sce-liberators-4', 'sce-liberators-5'])
    expect(aosUnitDamagePresentation(state, 'sce-liberators')).toMatchObject({
      healthThreshold: 2, currentDamage: 1, untilNextSlain: 1, badgeText: '✚ 1/2',
    })
    const loaded = deserializeMatch(serializeMatch(state), gameSystemRegistry).state
    expect(aosUnitDamagePresentation(loaded, 'sce-liberators')).toEqual(aosUnitDamagePresentation(state, 'sce-liberators'))
    const loadedData = aosMatchStateData(loaded)!
    const loadedCombat = ensureAosCombatState(loadedData, loaded)
    const ratDamaged = { ...loaded, gameSystemState: { ...loaded.gameSystemState!, data: {
      ...loadedData, combat: { ...loadedCombat, allocatedDamageByUnitId: {
        ...loadedCombat.allocatedDamageByUnitId, 'skv-rat-ogors': 3,
      } },
    } as unknown as JsonValue } }
    expect(aosUnitDamagePresentation(ratDamaged, 'skv-rat-ogors')).toMatchObject({
      currentDamage: 3, healthThreshold: 4, untilNextSlain: 1, badgeText: '✚ 3/4',
    })
    const cleared = { ...loaded, gameSystemState: { ...loaded.gameSystemState!, data: {
      ...loadedData, combat: { ...loadedCombat, allocatedDamageByUnitId: { ...loadedCombat.allocatedDamageByUnitId, 'sce-liberators': 0 } },
    } as unknown as JsonValue } }
    expect(aosUnitDamagePresentation(cleared, 'sce-liberators')?.badgeText).toBeNull()
    const destroyed = { ...loaded, models: loaded.models.map((model) => model.unitId === 'sce-liberators'
      ? { ...model, presence: 'DESTROYED' as const } : model) }
    expect(aosUnitDamagePresentation(destroyed, 'sce-liberators')).toBeNull()
  })
  it('allows every Liberator as the first slain model, then resolves only minimum coherency losses', () => {
    const ids = ['skv-rat-ogors-1', ...Array.from({ length: 5 }, (_, index) => `sce-liberators-${index + 1}`)]
    let state = combatState(ids)
    const positions = [
      { x: 17, y: 18 }, { x: 18.9, y: 18 }, { x: 20.8, y: 18 },
      { x: 17.95, y: 19.9 }, { x: 19.85, y: 19.9 },
    ]
    state = { ...state, models: state.models.map((model) => model.unitId === 'sce-liberators'
      ? { ...model, position: positions[Number(model.id.slice(-1)) - 1] } : model) }
    expect(aosDamageAllocationOptions(state, 'sce-liberators').map((option) => option[0])).toEqual(ids.slice(1))
    const data = aosMatchStateData(state)!
    const health = aosUnitProfile(state, state.units.find((unit) => unit.id === 'sce-liberators')!)!.health
    state = { ...state, gameSystemState: { ...state.gameSystemState!, data: { ...data, combat: {
      foughtUnitIds: [], allocatedDamageByUnitId: {}, fightFacts: [], destroyedUnitFacts: [],
      turnId: state.gameContext.turnId,
      activeFight: { unitId: 'skv-rat-ogors', playerId: 'player-2', turnId: state.gameContext.turnId,
        stage: 'ALLOCATE_DAMAGE', pileInComplete: true, resolvedProfileIds: [], pendingDamage: {
          attackerUnitId: 'skv-rat-ogors', targetUnitId: 'sce-liberators', profileId: 'claws-blades-fangs',
          sequenceRecordId: 'test', attacks: 1, hits: 1, criticalMortalHits: 0, wounds: 1,
          saved: 0, unsaved: 1, grossDamage: health, wardPrevented: 0, remaining: health, slainModelIds: [],
        } },
    } } as unknown as JsonValue } }
    state = command(state, 'aos/combat/allocate-damage', 'player-1', { modelId: 'sce-liberators-2' })
    expect(state.models.find((model) => model.id === 'sce-liberators-2')?.presence).toBe('DESTROYED')
    let pending = ensureAosCombatState(aosMatchStateData(state)!, state).activeFight?.pendingDamage
    expect(pending?.coherencyCorrection?.minimumAdditionalRemovals).toBeGreaterThan(0)
    while (pending?.coherencyCorrection) {
      const options = aosCoherencyCorrectionOptions(state, 'sce-liberators')
      state = command(state, 'aos/combat/allocate-damage', 'player-1', { modelId: options[0][0] })
      pending = ensureAosCombatState(aosMatchStateData(state)!, state).activeFight?.pendingDamage
    }
    const combat = ensureAosCombatState(aosMatchStateData(state)!, state)
    const fact = combat.activeAttackFacts?.[0] ?? combat.fightFacts.at(-1)?.attackResolutions[0]
    expect(fact?.slainModelIds).toContain('sce-liberators-2')
    expect(fact?.coherencySlainModelIds?.length).toBeGreaterThan(0)
  })
  it('enforces Fight timing, active-player-first opportunity, and already-Fought state', () => {
    let state = combatState()
    expect(aosFightAvailability(state, 'sce-knight-questor')).toMatchObject({ eligible: true, opportunityPlayerId: 'player-1' })
    expect(aosFightAvailability(state, 'skv-clawlord')).toMatchObject({ eligible: false, opportunityPlayerId: 'player-1' })
    expect(command(state, 'aos/battle/end-phase', 'player-1')).toBe(state)
    state = command(state, 'aos/combat/start-fight', 'player-1', { unitId: 'sce-knight-questor' })
    expect(ensureAosCombatState(aosMatchStateData(state)!, state).activeFight).toMatchObject({ stage: 'PILE_IN', unitId: 'sce-knight-questor' })
    state = command(state, 'aos/combat/pile-in-complete', 'player-1')
    expect(ensureAosCombatState(aosMatchStateData(state)!, state).activeFight?.stage).toBe('ATTACKS')
  })

  it('uses actual footprint edge range to build the attack pool and applies Rend to Save', () => {
    const state = combatState()
    const option = aosAttackProfileOptions(state, 'sce-knight-questor')[0]
    expect(option).toMatchObject({ profileModelIds: ['sce-knight-questor-1'], eligibleModelIds: ['sce-knight-questor-1'], maximumAttacks: 5 })
    expect(option.eligibleTargetUnitIds).toContain('skv-clawlord')
    expect(aosAttackingModelIdsForTarget(state, 'sce-knight-questor', 'questor-warblade', 'skv-clawlord'))
      .toEqual(option.eligibleModelIds)
    expect(effectiveAosSave(4, 2)).toBe(6)
    const target = state.units.find((unit) => unit.id === 'skv-clawlord')!
    const weapon = aosUnitProfile(state, state.units.find((unit) => unit.id === 'sce-knight-questor')!)!.weapons[0]
    expect(aosAttackSequenceDefinition({ id: 'save', attacks: 5, weapon, target: aosUnitProfile(state, target)! })
      .stages.at(-1)).toMatchObject({ id: 'save', threshold: 6, continuation: 'failures' })
  })

  it('derives the authored Grandhammer marker and profile association without inferring a leader role', () => {
    const state = combatState([
      'sce-liberators-1', 'sce-liberators-2', 'sce-liberators-3', 'sce-liberators-4', 'sce-liberators-5',
      'skv-rat-ogors-1',
    ])
    const grandhammer = aosAttackProfileOptions(state, 'sce-liberators')
      .find((option) => option.profile.id === 'grandhammer')!
    expect(grandhammer.profileModelIds).toEqual(['sce-liberators-5'])
    expect(deriveAosCombatModelMarkers(state)).toContainEqual({
      modelId: 'sce-liberators-5', kind: 'loadout', symbol: '◆', label: 'Grandhammer', profileId: 'grandhammer',
    })
    expect(deriveAosCombatModelMarkers(state).some((marker) => marker.kind === 'role')).toBe(false)
  })

  it('branches Crit (Mortal) before Wound while retaining the generic chained-roll record', () => {
    const state = combatState()
    const attacker = state.units.find((unit) => unit.id === 'sce-knight-questor')!
    const target = state.units.find((unit) => unit.id === 'skv-clawlord')!
    const weapon = aosUnitProfile(state, attacker)!.weapons[0]
    const definition = aosAttackSequenceDefinition({ id: 'crit', attacks: 5, weapon, target: aosUnitProfile(state, target)! })
    const result = resolveDiceSequence(definition, random([
      6, 5, 4, 2, 1, // three hits, one mortal crit: two continue
      4, 2, // one wound
      1, // failed save
    ]), aosAttackSequenceModifiers(weapon))
    expect(result.stageResults.map((stage) => stage.inputDiceCount)).toEqual([5, 2, 1])
    expect(result.stageResults[0]).toMatchObject({ successCount: 3, continuationCount: 2 })
  })

  it('carries Crit (Auto-wound) around the Wound roll and into Save', () => {
    const state = combatState()
    const attacker = state.units.find((unit) => unit.id === 'skv-clanrats')!
    const target = state.units.find((unit) => unit.id === 'sce-knight-questor')!
    const weapon = aosUnitProfile(state, attacker)!.weapons[0]
    const definition = aosAttackSequenceDefinition({ id: 'auto-wound', attacks: 2, weapon, target: aosUnitProfile(state, target)! })
    const result = resolveDiceSequence(definition, random([6, 4, 1, 1]), aosAttackSequenceModifiers(weapon))
    expect(result.stageResults.map((stage) => stage.inputDiceCount)).toEqual([2, 1, 1])
    expect(result.stageResults[1]).toMatchObject({ successCount: 0, continuationCount: 1 })
  })

  it('resolves chained attacks, persists unit damage, and protects revealed combat from Undo', () => {
    let state = combatState()
    state = command(state, 'aos/combat/start-fight', 'player-1', { unitId: 'sce-knight-questor' })
    state = command(state, 'aos/combat/pile-in-complete', 'player-1')
    state = declareProfiles(state, 'player-1', 'skv-clawlord')
    const recorded = recordSequence(state, 'player-1', 'sce-knight-questor', 'questor-warblade', 'skv-clawlord', [
      4, 4, 2, 2, 2, // two hits
      4, 2, // one wound
      6, // save succeeds at 6 after Anti-HERO Rend 2
    ])
    state = command(recorded.state, 'aos/combat/resolve-attacks', 'player-1', {
      profileId: 'questor-warblade', targetUnitId: 'skv-clawlord', sequenceRecordId: recorded.id,
    })
    const combat = ensureAosCombatState(aosMatchStateData(state)!, state)
    expect(combat.foughtUnitIds).toContain('sce-knight-questor')
    expect(combat.activeFight).toBeUndefined()
    expect(aosFightAvailability(state, 'sce-knight-questor')).toMatchObject({ eligible: false, alreadyFought: true })
    expect(aosFightAvailability(state, 'skv-clawlord')).toMatchObject({ eligible: true, opportunityPlayerId: 'player-2' })
    expect(state.lastCommittedOperationUndo).not.toBeNull()
    expect(reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, { type: 'history/undoLastCommitted' })).toBe(state)
  })

  it('allocates a non-lethal unit damage remainder and restores it exactly through save/load', () => {
    let state = combatState()
    state = command(state, 'aos/combat/start-fight', 'player-1', { unitId: 'sce-knight-questor' })
    state = command(state, 'aos/combat/pile-in-complete', 'player-1')
    state = declareProfiles(state, 'player-1', 'skv-clawlord')
    const recorded = recordSequence(state, 'player-1', 'sce-knight-questor', 'questor-warblade', 'skv-clawlord', [
      4, 2, 2, 2, 2, // one hit
      4, // wound
      1, // unsaved => 2 damage
    ])
    state = command(recorded.state, 'aos/combat/resolve-attacks', 'player-1', {
      profileId: 'questor-warblade', targetUnitId: 'skv-clawlord', sequenceRecordId: recorded.id,
    })
    state = command(state, 'aos/combat/allocate-damage', 'player-2', { slainModelIds: [] })
    expect(aosUnitAllocatedDamage(state, 'skv-clawlord')).toBe(2)
    const loaded = deserializeMatch(serializeMatch(state), gameSystemRegistry).state
    expect(aosUnitAllocatedDamage(loaded, 'skv-clawlord')).toBe(2)
    expect(ensureAosCombatState(aosMatchStateData(loaded)!, loaded).foughtUnitIds).toContain('sce-knight-questor')
  })

  it('rolls Ward once per damage point after Save and before allocating the surviving pool', () => {
    let state = combatState(undefined, true)
    state = command(state, 'aos/combat/start-fight', 'player-1', { unitId: 'sce-knight-questor' })
    state = command(state, 'aos/combat/pile-in-complete', 'player-1')
    state = declareProfiles(state, 'player-1', 'skv-clawlord')
    const recorded = recordSequence(state, 'player-1', 'sce-knight-questor', 'questor-warblade', 'skv-clawlord', [
      4, 4, 2, 2, 2, 4, 4, 1, 1, // two unsaved, four damage
    ])
    state = recorded.state
    const wardRecordId = `dice-${state.nextActionSequence}`
    const ward = rollDice({ count: 4, sides: 6, successThreshold: 6 }, random([6, 1, 6, 1]))
    state = gameReducer(state, { type: 'dice/rollRecorded', playerId: 'player-2', result: ward })
    state = command(state, 'aos/combat/resolve-attacks', 'player-1', {
      profileId: 'questor-warblade', targetUnitId: 'skv-clawlord', sequenceRecordId: recorded.id, wardRecordId,
    })
    expect(ensureAosCombatState(aosMatchStateData(state)!, state).activeFight?.pendingDamage)
      .toMatchObject({ grossDamage: 4, wardPrevented: 2, remaining: 2 })
    state = command(state, 'aos/combat/allocate-damage', 'player-2', { slainModelIds: [] })
    expect(aosUnitAllocatedDamage(state, 'skv-clawlord')).toBe(2)
  })

  it('resolves a controlled D3 damage characteristic through a separate generic dice record', () => {
    let state = combatState()
    const data = aosMatchStateData(state)!
    state = { ...state, gameSystemState: { ...state.gameSystemState!, data: { ...data, combat: {
      foughtUnitIds: [], allocatedDamageByUnitId: {}, fightFacts: [], destroyedUnitFacts: [],
      turnId: state.gameContext.turnId, opportunityPlayerId: 'player-2',
    } } as unknown as JsonValue } }
    state = command(state, 'aos/combat/start-fight', 'player-2', { unitId: 'skv-clawlord' })
    state = command(state, 'aos/combat/pile-in-complete', 'player-2')
    state = declareProfiles(state, 'player-2', 'sce-knight-questor')
    expect(ensureAosCombatState(aosMatchStateData(state)!, state).activeFight?.declaredAttacks).toHaveLength(2)
    expect(command(state, 'aos/combat/declare-attacks', 'player-2', { allocations: [] })).toBe(state)
    const recorded = recordSequence(state, 'player-2', 'skv-clawlord', 'gnaw-beast-chisel-fangs', 'sce-knight-questor', [
      4, 1, 1, 1, // one hit
      3, // one wound
      1, // one unsaved wound
    ])
    state = recorded.state
    const randomDamageRecordId = `dice-${state.nextActionSequence}`
    const damage = rollDice({ count: 1, sides: 3 }, { next: () => (3 - 0.5) / 3 })
    state = gameReducer(state, { type: 'dice/rollRecorded', playerId: 'player-2', result: damage })
    state = command(state, 'aos/combat/resolve-attacks', 'player-2', {
      profileId: 'gnaw-beast-chisel-fangs', targetUnitId: 'sce-knight-questor',
      sequenceRecordId: recorded.id, randomDamageRecordId,
    })
    expect(ensureAosCombatState(aosMatchStateData(state)!, state).activeFight?.pendingDamage)
      .toMatchObject({ grossDamage: 3, remaining: 3, randomDamageRecordId })
  })

  it('chooses successive casualties from the remaining models and terminates a destroyed target', () => {
    const activeIds = ['skv-rat-ogors-1', 'sce-liberators-1', 'sce-liberators-2', 'sce-liberators-3']
    let state = combatState(activeIds)
    const data = aosMatchStateData(state)!
    state = { ...state, gameSystemState: { ...state.gameSystemState!, data: { ...data, combat: {
      foughtUnitIds: [], allocatedDamageByUnitId: {}, fightFacts: [], destroyedUnitFacts: [],
      turnId: state.gameContext.turnId, opportunityPlayerId: 'player-2',
    } } as unknown as JsonValue } }
    state = command(state, 'aos/combat/start-fight', 'player-2', { unitId: 'skv-rat-ogors' })
    state = command(state, 'aos/combat/pile-in-complete', 'player-2')
    state = declareProfiles(state, 'player-2', 'sce-liberators')
    const attacks = aosAttackCountForTarget(state, 'skv-rat-ogors', 'claws-blades-fangs', 'sce-liberators')
    expect(attacks).toBe(5)
    const recorded = recordSequence(state, 'player-2', 'skv-rat-ogors', 'claws-blades-fangs', 'sce-liberators', [
      6, 6, 6, 6, 6, // hits
      6, 6, 6, 6, 6, // wounds
      1, 1, 1, 1, 1, // five unsaved, 10 damage
    ])
    state = command(recorded.state, 'aos/combat/resolve-attacks', 'player-2', {
      profileId: 'claws-blades-fangs', targetUnitId: 'sce-liberators', sequenceRecordId: recorded.id,
    })
    for (let index = 0; index < 3; index += 1) {
      const option = aosDamageAllocationOptions(state, 'sce-liberators')[0]
      expect(option).toHaveLength(1)
      state = command(state, 'aos/combat/allocate-damage', 'player-1', { modelId: option[0] })
    }
    expect(activeBattlefieldModels(state).filter((model) => model.unitId === 'sce-liberators')).toHaveLength(0)
    expect(state.models.filter((model) => model.unitId === 'sce-liberators').slice(0, 3)
      .every((model) => model.presence === 'DESTROYED')).toBe(true)
    const combat = ensureAosCombatState(aosMatchStateData(state)!, state)
    expect(combat.destroyedUnitFacts).toContainEqual(expect.objectContaining({ unitId: 'sce-liberators', sourceUnitId: 'skv-rat-ogors' }))
    expect(combat.activeFight).toBeUndefined()
    const loaded = deserializeMatch(serializeMatch(state), gameSystemRegistry).state
    expect(activeBattlefieldModels(loaded).filter((model) => model.unitId === 'sce-liberators')).toHaveLength(0)
    expect(ensureAosCombatState(aosMatchStateData(loaded)!, loaded)).toMatchObject({
      foughtUnitIds: expect.arrayContaining(['skv-rat-ogors']),
      destroyedUnitFacts: expect.arrayContaining([expect.objectContaining({ unitId: 'sce-liberators' })]),
    })
  })
})
