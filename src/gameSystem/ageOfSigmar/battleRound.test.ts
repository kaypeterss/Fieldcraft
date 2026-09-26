import { describe, expect, it } from 'vitest'
import type { GameState, JsonValue } from '../../domain/types'
import { createScoreEvent } from '../../game/scoring'
import { reduceGameCommand } from '../../state/commandBoundary'
import { gameSystemRegistry } from '../registeredGameSystems'
import { loadRegisteredMatchRuntime } from '../runtime'
import { createAgeOfSigmarAlphaMatch } from './ageOfSigmarMatch'
import { AOS_TURN_PHASES, aosBattleState, aosRoundResources, currentAosPhase } from './battleRound'
import { initialAosDeploymentState, type AosDeploymentFact } from './deployment'
import { prepareAgeOfSigmarMatch } from './prepareAgeOfSigmarMatch'

function command(state: GameState, type: string, actorPlayerId: string, payload?: JsonValue): GameState {
  return reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
    type: 'gameSystem/command', command: { type, actorPlayerId, payload },
  })
}

function readyForBattle(firstFinisherId = 'player-1'): GameState {
  const state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch({ matchId: 'round-test' }))
  const orderedPlayers = [firstFinisherId, state.players.find((player) => player.id !== firstFinisherId)!.id]
  let sequence = 1
  const facts: AosDeploymentFact[] = orderedPlayers.flatMap((playerId) => state.units
    .filter((unit) => unit.ownerId === playerId)
    .map((unit) => ({ sequence: sequence++, type: 'UNIT_DEPLOYED' as const, playerId, unitId: unit.id, ability: 'DEPLOY_UNIT' as const })))
  const deployment = {
    ...initialAosDeploymentState(),
    phase: 'READY_FOR_BATTLE' as const,
    deployedUnitIds: state.units.map((unit) => unit.id),
    facts,
    attackerPlayerId: 'player-1', defenderPlayerId: 'player-2',
    territoryByPlayerId: { 'player-1': 'attacker-territory', 'player-2': 'defender-territory' },
  }
  return {
    ...state,
    models: state.models.map((model, index) => ({
      ...model,
      presence: 'ON_BATTLEFIELD' as const,
      // This clock fixture is intentionally out of combat; Fight tests own engagement state.
      position: { x: model.ownerId === 'player-1' ? 5 : 35, y: 3 + (index % 10) * 2.5 },
    })),
    gameSystemState: {
      ...state.gameSystemState!,
      data: { status: 'deployment', setup: (state.gameSystemState!.data as Record<string, JsonValue>).setup, deployment } as unknown as JsonValue,
    },
  }
}

function startRoundOne(firstPlayerId = 'player-1', firstFinisherId = 'player-1'): GameState {
  let state = readyForBattle(firstFinisherId)
  state = command(state, 'aos/battle/start', 'player-1')
  state = command(state, 'aos/battle/choose-first-player', firstFinisherId, { firstPlayerId })
  return state
}

function finishRound(state: GameState): GameState {
  if (aosBattleState(state)?.stage === 'START_OF_ROUND') {
    state = command(state, 'aos/battle/continue', state.gameContext.activePlayerId)
  }
  for (let index = 0; index < AOS_TURN_PHASES.length * 2; index += 1) {
    state = command(state, 'aos/battle/end-phase', state.gameContext.activePlayerId)
  }
  return state
}

describe('Age of Sigmar battle clock', () => {
  it('uses deployment completion order for Round 1 and does not roll priority', () => {
    let state = readyForBattle('player-2')
    state = command(state, 'aos/battle/start', 'player-1')
    expect(aosBattleState(state)).toMatchObject({ stage: 'FIRST_PLAYER_CHOICE', round: 1, chooserPlayerId: 'player-2' })
    expect(state.matchLifecycle).toBe('IN_PROGRESS')
    expect(state.diceHistory).toEqual([])
    const rejected = command(state, 'aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-1' })
    expect(rejected).toBe(state)
    state = command(state, 'aos/battle/choose-first-player', 'player-2', { firstPlayerId: 'player-1' })
    expect(aosBattleState(state)).toMatchObject({ stage: 'START_OF_ROUND', firstPlayerId: 'player-1', secondPlayerId: 'player-2' })
  })

  it('uses the exact seven-phase order and exactly two player turns', () => {
    let state = startRoundOne()
    state = command(state, 'aos/battle/continue', 'player-1')
    const observed: string[] = []
    for (let index = 0; index < AOS_TURN_PHASES.length * 2; index += 1) {
      observed.push(`${state.gameContext.activePlayerId}:${currentAosPhase(aosBattleState(state)!)?.id}`)
      state = command(state, 'aos/battle/end-phase', state.gameContext.activePlayerId)
    }
    expect(observed).toEqual([
      ...AOS_TURN_PHASES.map((phase) => `player-1:${phase.id}`),
      ...AOS_TURN_PHASES.map((phase) => `player-2:${phase.id}`),
    ])
    expect(aosBattleState(state)?.stage).toBe('END_OF_ROUND')
  })

  it('rolls priority from Round 2, gives a tie to the previous first player, and records a double turn', () => {
    let state = finishRound(startRoundOne('player-1'))
    state = command(state, 'aos/battle/continue', 'player-2')
    expect(aosBattleState(state)).toMatchObject({ stage: 'PRIORITY_ROLL', round: 2 })
    state = command(state, 'aos/battle/priority-rolled', 'player-1', { 'player-1': 4, 'player-2': 4 })
    expect(aosBattleState(state)).toMatchObject({
      stage: 'PRIORITY_CHOICE', chooserPlayerId: 'player-1', priority: { tied: true },
    })
    state = command(state, 'aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-2' })
    expect(aosBattleState(state)).toMatchObject({
      stage: 'START_OF_ROUND', firstPlayerId: 'player-2',
      doubleTurns: [{ round: 2, playerId: 'player-2' }],
    })
  })

  it('determines the underdog from confirmed VP and has no underdog on a tie', () => {
    const tied = startRoundOne()
    expect(aosBattleState(tied)?.underdogPlayerId).toBeUndefined()

    let trailing = readyForBattle()
    trailing = {
      ...trailing,
      scoreHistory: [createScoreEvent({
        sequence: 100, playerId: 'player-1', pointsDelta: 3, reason: 'Confirmed test score',
        gameContext: trailing.gameContext,
      })],
    }
    trailing = command(trailing, 'aos/battle/start', 'player-1')
    trailing = command(trailing, 'aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-1' })
    expect(aosBattleState(trailing)?.underdogPlayerId).toBe('player-2')
    expect(aosRoundResources(trailing)?.byPlayerId['player-1'].commandPoints).toBe(4)
    expect(aosRoundResources(trailing)?.byPlayerId['player-2'].commandPoints).toBe(5)
  })

  it('initializes Fury from deployment roles and generates exact Round 1 Rage resources', () => {
    const state = startRoundOne()
    const resources = aosRoundResources(state)!
    expect(resources.generatedForRound).toBe(1)
    expect(resources.byPlayerId['player-1']).toMatchObject({ commandPoints: 4, fury: 1 })
    expect(resources.byPlayerId['player-2']).toMatchObject({ commandPoints: 4, fury: 2 })
    expect(resources.byPlayerId['player-1'].rageDice).toHaveLength(1)
    expect(resources.byPlayerId['player-2'].rageDice).toHaveLength(2)
  })

  it('lazily upgrades an M9.4 battle save that predates resource state', () => {
    let state = startRoundOne()
    const legacyData = structuredClone(state.gameSystemState!.data) as Record<string, JsonValue>
    delete legacyData.resources
    state = { ...state, gameSystemState: { ...state.gameSystemState!, data: legacyData } }
    state = command(state, 'aos/battle/continue', state.gameContext.activePlayerId)
    expect(aosRoundResources(state)?.generatedForRound).toBe(1)
    expect(aosRoundResources(state)?.byPlayerId['player-1'].commandPoints).toBe(4)
    expect(aosRoundResources(state)?.byPlayerId['player-2'].fury).toBe(2)
  })

  it('spends resources authoritatively, rejects insufficient spending, and persists exact tokens', () => {
    let state = startRoundOne()
    state = command(state, 'aos/resources/spend-command-points', 'player-1', { amount: 2 })
    state = command(state, 'aos/resources/spend-rage-dice', 'player-2', { amount: 1 })
    expect(aosRoundResources(state)?.byPlayerId['player-1'].commandPoints).toBe(2)
    expect(aosRoundResources(state)?.byPlayerId['player-2'].rageDice).toHaveLength(1)
    const rejected = command(state, 'aos/resources/spend-command-points', 'player-1', { amount: 3 })
    expect(rejected).toBe(state)
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    expect(() => loadRegisteredMatchRuntime(restored, gameSystemRegistry)).not.toThrow()
    expect(aosRoundResources(restored)).toEqual(aosRoundResources(state))
  })

  it('undoes spending by restoring exact resource tokens without regenerating them', () => {
    let state = startRoundOne()
    const original = structuredClone(aosRoundResources(state))
    state = command(state, 'aos/resources/spend-rage-dice', 'player-2', { amount: 1 })
    expect(aosRoundResources(state)?.byPlayerId['player-2'].rageDice).toHaveLength(1)
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'history/undoLastCommitted',
    })
    expect(aosRoundResources(state)).toEqual(original)
  })

  it('expires CP and Rage at round end, preserves Fury, and regenerates for Round 2', () => {
    let state = finishRound(startRoundOne())
    expect(aosRoundResources(state)?.byPlayerId['player-1']).toMatchObject({ commandPoints: 0, fury: 1, rageDice: [] })
    expect(aosRoundResources(state)?.byPlayerId['player-2']).toMatchObject({ commandPoints: 0, fury: 2, rageDice: [] })
    state = command(state, 'aos/battle/continue', state.gameContext.activePlayerId)
    state = command(state, 'aos/battle/priority-rolled', 'player-1', { 'player-1': 6, 'player-2': 2 })
    state = command(state, 'aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-1' })
    expect(aosRoundResources(state)?.generatedForRound).toBe(2)
    expect(aosRoundResources(state)?.byPlayerId['player-1'].rageDice[0].id).toBe('rage-r2-player-1-1')
    expect(aosRoundResources(state)?.byPlayerId['player-2'].rageDice).toHaveLength(2)
  })

  it('completes after Round 5 without inventing final scoring', () => {
    let state = startRoundOne()
    for (let round = 1; round <= 5; round += 1) {
      state = finishRound(state)
      state = command(state, 'aos/battle/continue', state.gameContext.activePlayerId)
      if (round < 5) {
        state = command(state, 'aos/battle/priority-rolled', 'player-1', { 'player-1': 6, 'player-2': 2 })
        state = command(state, 'aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-1' })
      }
    }
    expect(aosBattleState(state)).toMatchObject({ stage: 'BATTLE_COMPLETE', round: 5 })
    expect(aosBattleState(state)?.completedRounds).toHaveLength(5)
    expect(state.matchLifecycle).toBe('COMPLETED')
    expect(state.scoreHistory).toEqual([])
  })

  it('round-trips mid-phase and pending priority without rerolling or changing state', () => {
    let midPhase = startRoundOne('player-2')
    midPhase = command(midPhase, 'aos/battle/continue', 'player-2')
    midPhase = command(midPhase, 'aos/battle/end-phase', 'player-2')
    midPhase = command(midPhase, 'aos/battle/end-phase', 'player-2')
    const restoredPhase = JSON.parse(JSON.stringify(midPhase)) as GameState
    expect(() => loadRegisteredMatchRuntime(restoredPhase, gameSystemRegistry)).not.toThrow()
    expect(restoredPhase.gameContext).toEqual(midPhase.gameContext)
    expect(aosBattleState(restoredPhase)).toEqual(aosBattleState(midPhase))

    let pending = finishRound(midPhase)
    pending = command(pending, 'aos/battle/continue', pending.gameContext.activePlayerId)
    pending = command(pending, 'aos/battle/priority-rolled', 'player-1', { 'player-1': 2, 'player-2': 5 })
    const restoredPriority = JSON.parse(JSON.stringify(pending)) as GameState
    expect(() => loadRegisteredMatchRuntime(restoredPriority, gameSystemRegistry)).not.toThrow()
    expect(aosBattleState(restoredPriority)?.priority).toEqual(aosBattleState(pending)?.priority)
  })

  it('does not expose revealed priority information to generic Undo', () => {
    let state = finishRound(startRoundOne())
    state = command(state, 'aos/battle/continue', state.gameContext.activePlayerId)
    state = command(state, 'aos/battle/priority-rolled', 'player-1', { 'player-1': 6, 'player-2': 1 })
    expect(state.lastCommittedOperationUndo).toBeNull()
    const undone = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'history/undoLastCommitted',
    })
    expect(undone).toBe(state)
    expect(aosBattleState(undone)?.priority).toEqual(aosBattleState(state)?.priority)
  })
})
