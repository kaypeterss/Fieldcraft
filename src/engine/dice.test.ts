import { describe, expect, it } from 'vitest'
import type { RandomSource } from './dice'
import { countSuccesses, rerollDiceValues, rollDice } from './dice'

function sequenceRandom(values: readonly number[]): RandomSource {
  let index = 0
  return { next: () => {
    const value = values[index]
    if (value === undefined) throw new Error('Deterministic random sequence exhausted')
    index += 1
    return value
  } }
}

describe('generic dice engine', () => {
  it('uses an injected deterministic random source for multiple die types', () => {
    const d6 = rollDice({ count: 6, sides: 6 }, sequenceRandom([0, .16, .34, .5, .67, .999]))
    expect(d6.originalResults).toEqual([1, 1, 3, 4, 5, 6])
    expect(d6.finalResults).toEqual(d6.originalResults)
    expect(d6.total).toBe(20)
    expect(d6.distribution).toEqual({ 1: 2, 2: 0, 3: 1, 4: 1, 5: 1, 6: 1 })

    expect(rollDice({ count: 2, sides: 10 }, sequenceRandom([.19, .99])).finalResults).toEqual([2, 10])
    expect(rollDice({ count: 1, sides: 20 }, sequenceRandom([.95])).finalResults).toEqual([20])
  })

  it('handles large pools and counts optional successes from final results', () => {
    const values = Array.from({ length: 100 }, (_, index) => (index % 6) / 6)
    const pool = rollDice({ count: 100, sides: 6, successThreshold: 4 }, sequenceRandom(values))
    expect(pool.finalResults).toHaveLength(100)
    expect(pool.successes).toBe(countSuccesses(pool.finalResults, 4, 6))
    expect(Object.values(pool.distribution).reduce((sum, count) => sum + count, 0)).toBe(100)
  })

  it('preserves originals and records each value-based reroll with replacements', () => {
    const original = rollDice({ count: 5, sides: 6, successThreshold: 4 },
      sequenceRandom([0, .2, .4, .8, .99]))
    const rerolled = rerollDiceValues(original, [1, 2], sequenceRandom([.99, .5]))

    expect(original.finalResults).toEqual([1, 2, 3, 5, 6])
    expect(rerolled.originalResults).toEqual([1, 2, 3, 5, 6])
    expect(rerolled.finalResults).toEqual([6, 4, 3, 5, 6])
    expect(rerolled.rerolls).toEqual([{
      values: [1, 2], indices: [0, 1], previousResults: [1, 2], replacementResults: [6, 4],
    }])
    expect(rerolled.successes).toBe(4)
  })

  it('rejects invalid dice and random-source values', () => {
    expect(rollDice({ count: 0, sides: 6 }, sequenceRandom([]))).toMatchObject({
      finalResults: [], total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    })
    expect(() => rollDice({ count: -1, sides: 6 }, sequenceRandom([]))).toThrow(RangeError)
    expect(() => rollDice({ count: 1, sides: 1 }, sequenceRandom([0]))).toThrow(RangeError)
    expect(() => rollDice({ count: 1, sides: 6, successThreshold: 7 }, sequenceRandom([0]))).toThrow(RangeError)
    expect(() => rollDice({ count: 1, sides: 6 }, sequenceRandom([1]))).toThrow(RangeError)
  })
})
