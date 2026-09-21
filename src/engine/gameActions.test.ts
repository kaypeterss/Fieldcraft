import { describe, expect, it } from 'vitest'
import type { GameState } from '../domain/types'
import {
  actionsByPlayerInTurn,
  actionsByUnitInTurn,
  actionsInRound,
  actionsInTurn,
  hasUnitPerformedAction,
  mostRecentAction,
} from '../game/actionQueries'
import { initialGameState } from '../game/initialState'
import { getPlayerForModel, getPlayerForUnit } from '../game/selectors'
import { advanceTurn } from '../game/turns'
import { gameReducer } from '../state/reducer'
import { individualSameUnitHandoffTarget } from '../tools/selection'

function freshState(): GameState {
  return JSON.parse(JSON.stringify(initialGameState)) as GameState
}

function confirmTranslation(state: GameState, modelIds: string[], dx: number, dy: number): GameState {
  const started = gameReducer(state, {
    type: 'movement/sessionStarted',
    sessionId: `session-${state.nextActionSequence}`,
    modelIds,
  })
  const positions = Object.fromEntries(modelIds.map((modelId) => {
    const model = started.models.find((candidate) => candidate.id === modelId)!
    return [modelId, { x: model.position.x + dx, y: model.position.y + dy }]
  }))
  return gameReducer(gameReducer(started, { type: 'movement/requested', positions }), { type: 'movement/confirmed' })
}

describe('players and game context', () => {
  it('resolves both prototype players and unit ownership', () => {
    const state = freshState()
    expect(state.players.map((player) => player.displayName)).toEqual(['Player 1', 'Player 2'])
    expect(state.units.map((unit) => getPlayerForUnit(state, unit)?.id)).toEqual([
      'player-1', 'player-2', 'player-2',
    ])
    expect(state.models.map((model) => getPlayerForModel(state, model)?.displayName)).toEqual([
      ...Array(10).fill('Player 1'), ...Array(8).fill('Player 2'),
    ])
    const renamed = freshState()
    renamed.players[0].displayName = 'Kay'
    expect(getPlayerForUnit(renamed, renamed.units[0])?.displayName).toBe('Kay')
    expect(getPlayerForModel(renamed, renamed.models[0])?.displayName).toBe('Kay')
    expect(renamed.units[0].ownerId).toBe('player-1')
    expect(renamed.models[0].ownerId).toBe('player-1')
  })

  it('starts in round one with Player 1 and optional phases disabled', () => {
    const state = freshState()
    expect(state.gameContext).toEqual({
      round: 1,
      turn: 1,
      turnSequence: 1,
      turnId: 'turn-1',
      activePlayerId: 'player-1',
    })
    expect(state.gameContext.phase).toBeUndefined()
    expect(JSON.parse(JSON.stringify(state.gameContext))).toEqual(state.gameContext)
  })

  it('advances through configured players and increments the round after the cycle', () => {
    const state = freshState()
    const playerTwo = gameReducer(state, { type: 'game/turnEnded' })
    expect(playerTwo.gameContext).toMatchObject({ round: 1, turn: 2, turnSequence: 2, turnId: 'turn-2', activePlayerId: 'player-2' })
    const nextRound = gameReducer(playerTwo, { type: 'game/turnEnded' })
    expect(nextRound.gameContext).toMatchObject({ round: 2, turn: 1, turnSequence: 3, turnId: 'turn-3', activePlayerId: 'player-1' })
  })

  it('resets display turns within each round while preserving unique internal turns', () => {
    const contexts = [freshState().gameContext]
    let state = freshState()
    for (let index = 0; index < 5; index += 1) {
      state = gameReducer(state, { type: 'game/turnEnded' })
      contexts.push(state.gameContext)
    }
    expect(contexts.map(({ round, turn }) => `R${round}/T${turn}`)).toEqual([
      'R1/T1', 'R1/T2', 'R2/T1', 'R2/T2', 'R3/T1', 'R3/T2',
    ])
    expect(contexts.map(({ turnSequence }) => turnSequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(contexts.map(({ turnId }) => turnId)).size).toBe(6)
  })

  it('uses configuration rather than a hardcoded two-player turn switch', () => {
    const context = { round: 4, turn: 2, turnSequence: 7, turnId: 'turn-7', activePlayerId: 'p2' }
    expect(advanceTurn(context, { playerOrder: ['p1', 'p2', 'p3'], phases: ['Action'] })).toEqual({
      round: 4,
      turn: 3,
      turnSequence: 8,
      turnId: 'turn-8',
      activePlayerId: 'p3',
      phase: 'Action',
    })
  })

  it('does not end the turn while a movement session is active', () => {
    const state = gameReducer(freshState(), {
      type: 'movement/sessionStarted',
      sessionId: 'active-move',
      modelIds: ['mdl-a-001'],
    })
    expect(gameReducer(state, { type: 'game/turnEnded' })).toBe(state)
  })
})

describe('confirmed move actions', () => {
  it('records one complete action for an individual confirmation, not its pointer requests', () => {
    const state = freshState()
    const started = gameReducer(state, { type: 'movement/sessionStarted', sessionId: 'individual', modelIds: ['mdl-a-001'] })
    const requested = gameReducer(started, { type: 'movement/requested', positions: { 'mdl-a-001': { x: 8.5, y: 9 } } })
    expect(requested.actionHistory).toHaveLength(0)
    const confirmed = gameReducer(requested, { type: 'movement/confirmed' })
    expect(confirmed.actionHistory).toHaveLength(1)
    expect(confirmed.actionHistory[0]).toMatchObject({
      id: 'action-1',
      sequence: 1,
      type: 'MOVE',
      playerId: 'player-1',
      round: 1,
      turn: 1,
      turnSequence: 1,
      turnId: 'turn-1',
      payload: {
        modelIds: ['mdl-a-001'],
        unitIds: ['unit-a'],
        ownerIds: ['player-1'],
        startingPositions: { 'mdl-a-001': { x: 9, y: 9 } },
        finalPositions: { 'mdl-a-001': { x: 8.5, y: 9 } },
      },
    })
    expect(confirmed.actionHistory[0].payload.movementUsed['mdl-a-001']).toBeCloseTo(0.5)
  })

  it('captures an optional phase when the current configuration supplies one', () => {
    const state = freshState()
    state.gameContext.phase = 'Prototype Action'
    const confirmed = confirmTranslation(state, ['mdl-a-001'], -0.5, 0)
    expect(confirmed.actionHistory[0].phase).toBe('Prototype Action')
  })

  it('records one action for a whole unit and one for a mixed rigid selection', () => {
    const state = freshState()
    const wholeUnit = confirmTranslation(state, state.units[0].modelIds, -0.5, 0)
    expect(wholeUnit.actionHistory).toHaveLength(1)
    expect(wholeUnit.actionHistory[0].payload.modelIds).toEqual(state.units[0].modelIds)
    expect(wholeUnit.actionHistory[0].payload.unitIds).toEqual(['unit-a'])

    const mixed = confirmTranslation(state, ['mdl-a-001', 'mdl-b-001'], -0.25, 0)
    expect(mixed.actionHistory).toHaveLength(1)
    expect(mixed.actionHistory[0].payload.unitIds).toEqual(['unit-a', 'unit-b'])
    expect(mixed.actionHistory[0].payload.ownerIds).toEqual(['player-1', 'player-2'])
  })

  it('does not record cancelled or no-op movement', () => {
    const started = gameReducer(freshState(), { type: 'movement/sessionStarted', sessionId: 'cancel', modelIds: ['mdl-a-001'] })
    const requested = gameReducer(started, { type: 'movement/requested', positions: { 'mdl-a-001': { x: 8.5, y: 9 } } })
    expect(gameReducer(requested, { type: 'movement/cancelled' }).actionHistory).toHaveLength(0)
    expect(gameReducer(started, { type: 'movement/confirmed' }).actionHistory).toHaveLength(0)
  })

  it('increments sequence deterministically and snapshots immutable historical positions', () => {
    const first = confirmTranslation(freshState(), ['mdl-a-001'], -0.5, 0)
    const firstSnapshot = JSON.parse(JSON.stringify(first.actionHistory[0]))
    const second = confirmTranslation(first, ['mdl-a-001'], -0.5, 0)
    expect(second.actionHistory.map((action) => action.sequence)).toEqual([1, 2])
    expect(second.actionHistory[0]).toEqual(firstSnapshot)
    expect(second.actionHistory[1].payload.startingPositions['mdl-a-001']).toEqual({ x: 8.5, y: 9 })
    expect(JSON.parse(JSON.stringify(second.actionHistory))).toEqual(second.actionHistory)
    expect(JSON.parse(JSON.stringify(second))).toEqual(second)
  })

  it('records display and internal turn context without changing action sequencing', () => {
    let state = freshState()
    for (let index = 0; index < 4; index += 1) state = gameReducer(state, { type: 'game/turnEnded' })
    const moved = confirmTranslation(state, ['mdl-a-001'], -0.5, 0)
    expect(moved.actionHistory[0]).toMatchObject({
      sequence: 1,
      round: 3,
      turn: 1,
      turnSequence: 5,
      turnId: 'turn-5',
    })
  })
})

describe('action queries, movement status, and undo', () => {
  it('queries actions by round, turn, player, unit, and recency', () => {
    const moved = confirmTranslation(freshState(), ['mdl-a-001'], -0.5, 0)
    const action = moved.actionHistory[0]
    expect(actionsInRound(moved.actionHistory, 1)).toEqual([action])
    expect(actionsInTurn(moved.actionHistory, moved.gameContext)).toEqual([action])
    expect(actionsByPlayerInTurn(moved.actionHistory, 'player-1', moved.gameContext)).toEqual([action])
    expect(actionsByUnitInTurn(moved.actionHistory, 'unit-a', moved.gameContext)).toEqual([action])
    expect(actionsByUnitInTurn(moved.actionHistory, 'unit-b', moved.gameContext)).toEqual([])
    expect(mostRecentAction(moved.actionHistory)).toEqual(action)
  })

  it('derives movement status and clears it when the corresponding action is undone', () => {
    const moved = confirmTranslation(freshState(), ['mdl-a-001'], -0.5, 0)
    expect(hasUnitPerformedAction(moved.actionHistory, 'unit-a', 'MOVE', moved.gameContext)).toBe(true)
    expect(hasUnitPerformedAction(moved.actionHistory, 'unit-b', 'MOVE', moved.gameContext)).toBe(false)
    const undone = gameReducer(moved, { type: 'movement/undoLastConfirmed' })
    expect(undone.models.find((model) => model.id === 'mdl-a-001')?.position).toEqual({ x: 9, y: 9 })
    expect(undone.actionHistory).toHaveLength(0)
    expect(hasUnitPerformedAction(undone.actionHistory, 'unit-a', 'MOVE', undone.gameContext)).toBe(false)
    const movedAgain = confirmTranslation(undone, ['mdl-a-001'], -0.25, 0)
    expect(movedAgain.actionHistory[0].sequence).toBe(2)
  })

  it('keeps history but resets derived status and movement undo across a turn boundary', () => {
    const moved = confirmTranslation(freshState(), ['mdl-a-001'], -0.5, 0)
    const nextTurn = gameReducer(moved, { type: 'game/turnEnded' })
    expect(nextTurn.actionHistory).toHaveLength(1)
    expect(hasUnitPerformedAction(nextTurn.actionHistory, 'unit-a', 'MOVE', nextTurn.gameContext)).toBe(false)
    expect(gameReducer(nextTurn, { type: 'movement/undoLastConfirmed' })).toBe(nextTurn)
  })

  it('never reuses an action sequence after undo', () => {
    const first = confirmTranslation(freshState(), ['mdl-a-001'], -0.25, 0)
    const second = confirmTranslation(first, ['mdl-a-001'], -0.25, 0)
    const undone = gameReducer(second, { type: 'movement/undoLastConfirmed' })
    const third = confirmTranslation(undone, ['mdl-a-001'], -0.25, 0)
    expect(third.actionHistory.map((action) => action.sequence)).toEqual([1, 3])
    expect(third.nextActionSequence).toBe(4)
  })
})

describe('individual same-unit movement handoff', () => {
  it('confirms each meaningful model once and leaves the next model selected but idle', () => {
    let state = gameReducer(freshState(), {
      type: 'movement/sessionStarted', sessionId: 'move-a', modelIds: ['mdl-a-001'],
    })
    state = gameReducer(state, {
      type: 'movement/requested', positions: { 'mdl-a-001': { x: 8.5, y: 9 } },
    })
    const selectedB = individualSameUnitHandoffTarget(state.movementSession, state.models, 'mdl-a-002')
    expect(selectedB).toBe('mdl-a-002')
    state = gameReducer(state, { type: 'movement/confirmed' })
    expect(state.actionHistory).toHaveLength(1)
    expect(state.actionHistory[0].payload.modelIds).toEqual(['mdl-a-001'])
    expect(state.actionHistory[0].payload.movementUsed['mdl-a-001']).toBeCloseTo(0.5)
    expect(state.movementSession).toBeNull()

    state = gameReducer(state, {
      type: 'movement/sessionStarted', sessionId: 'move-b', modelIds: [selectedB!],
    })
    expect(state.movementSession?.models['mdl-a-002'].movementUsed).toBe(0)
    state = gameReducer(state, {
      type: 'movement/requested', positions: { 'mdl-a-002': { x: 10.5, y: 9 } },
    })
    const selectedC = individualSameUnitHandoffTarget(state.movementSession, state.models, 'mdl-a-003')
    expect(selectedC).toBe('mdl-a-003')
    state = gameReducer(state, { type: 'movement/confirmed' })
    expect(state.actionHistory.map((action) => action.payload.modelIds)).toEqual([
      ['mdl-a-001'], ['mdl-a-002'],
    ])
    expect(state.movementSession).toBeNull()
  })

  it('hands off a no-op session without creating history or movement status', () => {
    const started = gameReducer(freshState(), {
      type: 'movement/sessionStarted', sessionId: 'no-op-a', modelIds: ['mdl-a-001'],
    })
    expect(individualSameUnitHandoffTarget(started.movementSession, started.models, 'mdl-a-002')).toBe('mdl-a-002')
    const handedOff = gameReducer(started, { type: 'movement/confirmed' })
    expect(handedOff.movementSession).toBeNull()
    expect(handedOff.actionHistory).toHaveLength(0)
    expect(hasUnitPerformedAction(handedOff.actionHistory, 'unit-a', 'MOVE', handedOff.gameContext)).toBe(false)
  })

  it('rejects different-unit and group handoffs while standard resolution still works', () => {
    let individual = gameReducer(freshState(), {
      type: 'movement/sessionStarted', sessionId: 'different-unit', modelIds: ['mdl-a-001'],
    })
    individual = gameReducer(individual, {
      type: 'movement/requested', positions: { 'mdl-a-001': { x: 8.5, y: 9 } },
    })
    expect(individualSameUnitHandoffTarget(individual.movementSession, individual.models, 'mdl-b-001')).toBeNull()
    expect(individual.actionHistory).toHaveLength(0)
    expect(individual.movementSession).not.toBeNull()
    expect(gameReducer(individual, { type: 'movement/confirmed' }).actionHistory).toHaveLength(1)

    const group = gameReducer(freshState(), {
      type: 'movement/sessionStarted', sessionId: 'group', modelIds: ['mdl-a-001', 'mdl-a-002'],
    })
    expect(individualSameUnitHandoffTarget(group.movementSession, group.models, 'mdl-a-003')).toBeNull()
    expect(individualSameUnitHandoffTarget(group.movementSession, group.models, 'mdl-b-001')).toBeNull()
  })

  it('keeps normal undo and cancel semantics after handoffs', () => {
    const movedA = confirmTranslation(freshState(), ['mdl-a-001'], -0.5, 0)
    const movedB = confirmTranslation(movedA, ['mdl-a-002'], -0.5, 0)
    const undoneB = gameReducer(movedB, { type: 'movement/undoLastConfirmed' })
    expect(undoneB.actionHistory.map((action) => action.payload.modelIds)).toEqual([['mdl-a-001']])
    expect(undoneB.models.find((model) => model.id === 'mdl-a-002')?.position).toEqual({ x: 11, y: 9 })
    expect(undoneB.models.find((model) => model.id === 'mdl-a-001')?.position).toEqual({ x: 8.5, y: 9 })

    let movingB = gameReducer(movedA, {
      type: 'movement/sessionStarted', sessionId: 'cancel-b', modelIds: ['mdl-a-002'],
    })
    movingB = gameReducer(movingB, {
      type: 'movement/requested', positions: { 'mdl-a-002': { x: 10.5, y: 9 } },
    })
    const cancelledB = gameReducer(movingB, { type: 'movement/cancelled' })
    expect(cancelledB.actionHistory.map((action) => action.payload.modelIds)).toEqual([['mdl-a-001']])
    expect(cancelledB.models.find((model) => model.id === 'mdl-a-002')?.position).toEqual({ x: 11, y: 9 })
  })
})
