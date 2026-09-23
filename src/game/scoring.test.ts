import { describe, expect, it } from 'vitest'
import { initialGameState } from './initialState'
import { gameReducer } from '../state/reducer'
import { scoreTotalForPlayer } from './scoring'

describe('generic score events', () => {
  it('derives totals from additions and corrections and can undo the latest score event', () => {
    let state = structuredClone(initialGameState)
    state = gameReducer(state, {
      type: 'score/eventRecorded', playerId: 'player-1', pointsDelta: 5,
      reason: 'Held objective', source: { type: 'manual', referenceId: 'objective-a' },
    })
    state = gameReducer(state, {
      type: 'score/eventRecorded', playerId: 'player-1', pointsDelta: -2,
      reason: 'Correction',
    })
    state = gameReducer(state, {
      type: 'score/eventRecorded', playerId: 'player-2', pointsDelta: 3,
      reason: 'Manual award',
    })
    let events = state.scoreHistory ?? []
    expect(scoreTotalForPlayer(events, 'player-1')).toBe(3)
    expect(scoreTotalForPlayer(events, 'player-2')).toBe(3)
    expect(events[0]).toMatchObject({
      sequence: 1, round: 1, turn: 1, turnId: 'turn-1',
      payload: { pointsDelta: 5, reason: 'Held objective', source: {
        type: 'manual', referenceId: 'objective-a',
      } },
    })

    state = gameReducer(state, { type: 'score/lastEventUndone' })
    events = state.scoreHistory ?? []
    expect(scoreTotalForPlayer(events, 'player-1')).toBe(3)
    expect(scoreTotalForPlayer(events, 'player-2')).toBe(0)
    expect(state.nextActionSequence).toBe(4)
  })
})
