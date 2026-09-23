import { describe, expect, it } from 'vitest'
import { rollDice, rerollDiceValues, type RandomSource } from '../engine/dice'
import { initialGameState } from './initialState'
import { gameReducer } from '../state/reducer'
import { resolveDiceSequence } from '../engine/diceSequence'

const sequenceRandom = (values: readonly number[]): RandomSource => {
  let index = 0
  return { next: () => values[index++] }
}

describe('dice roll history', () => {
  it('records player and game context and updates rerolls without losing originals', () => {
    const original = rollDice({ count: 3, sides: 6, successThreshold: 4 }, sequenceRandom([0, .5, .99]))
    let state = gameReducer(structuredClone(initialGameState), {
      type: 'dice/rollRecorded', playerId: 'player-2', result: original,
    })
    const roll = state.diceHistory?.[0]
    expect(roll).toMatchObject({
      id: 'dice-1', sequence: 1, type: 'DICE_ROLL', playerId: 'player-2',
      round: 1, turn: 1, turnId: 'turn-1', originalResults: [1, 4, 6],
      finalResults: [1, 4, 6], successes: 2,
    })
    expect(state.nextActionSequence).toBe(2)

    const updated = rerollDiceValues(original, [1], sequenceRandom([.8]))
    state = gameReducer(state, { type: 'dice/rollUpdated', rollId: 'dice-1', result: updated })
    expect(state.diceHistory?.[0]).toMatchObject({
      sequence: 1, originalResults: [1, 4, 6], finalResults: [5, 4, 6], successes: 3,
      rerolls: [{ values: [1], indices: [0], previousResults: [1], replacementResults: [5] }],
    })
    expect(state.nextActionSequence).toBe(2)
    expect(structuredClone(state.diceHistory)).toEqual(state.diceHistory)
  })

  it('ignores records for unknown players and invalid updates', () => {
    const result = rollDice({ count: 1, sides: 6 }, sequenceRandom([0]))
    const state = structuredClone(initialGameState)
    expect(gameReducer(state, { type: 'dice/rollRecorded', playerId: 'missing', result })).toBe(state)
    expect(gameReducer(state, { type: 'dice/rollUpdated', rollId: 'missing', result })).toBe(state)
  })

  it('records a complete sequence with player and round/turn/phase context', () => {
    const state = structuredClone(initialGameState)
    state.gameContext.phase = 'Prototype Phase'
    const resolution = resolveDiceSequence({
      id: 'sequence', label: 'Generic sequence', startingDiceCount: 2,
      stages: [
        { id: 'a', label: 'First', sides: 6, threshold: 3, continuation: 'successes' },
        { id: 'b', label: 'Second', sides: 10, threshold: 5, continuation: 'failures' },
      ],
    }, sequenceRandom([.5, .99, 0, .9]))
    const recorded = gameReducer(state, {
      type: 'dice/sequenceRecorded', playerId: 'player-1', resolution,
    })
    expect(recorded.diceHistory?.[0]).toMatchObject({
      id: 'dice-sequence-1', type: 'DICE_SEQUENCE', playerId: 'player-1',
      round: 1, turn: 1, phase: 'Prototype Phase', finalResult: 1,
      stageResults: [
        { inputDiceCount: 2, continuationCount: 2 },
        { inputDiceCount: 2, continuationCount: 1 },
      ],
    })
    expect(structuredClone(recorded.diceHistory)).toEqual(recorded.diceHistory)
  })
})
