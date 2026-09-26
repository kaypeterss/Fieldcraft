import { describe, expect, it } from 'vitest'
import type { DiceSequenceDefinition } from '../domain/types'
import type { RandomSource } from './dice'
import {
  beginDiceSequence,
  resolveDiceSequence,
  resolveNextDiceStage,
  type DiceStageModifierAdapter,
} from './diceSequence'

function sequenceRandom(values: readonly number[]): RandomSource {
  let index = 0
  return { next: () => {
    const value = values[index]
    if (value === undefined) throw new Error('Deterministic random sequence exhausted')
    index += 1
    return value
  } }
}

const definition = (continuation: 'successes' | 'failures' = 'successes'): DiceSequenceDefinition => ({
  id: 'check', label: 'Generic check', startingDiceCount: 4,
  stages: [
    { id: 'a', label: 'Stage A', sides: 6, threshold: 4, continuation },
    { id: 'b', label: 'Stage B', sides: 6, threshold: 4, continuation: 'successes' },
  ],
})

describe('generic chained dice resolution', () => {
  it('feeds successes into the next stage', () => {
    const result = resolveDiceSequence(definition(), sequenceRandom([
      0, .5, .7, .99, // 1,4,5,6 => 3 continue
      0, .2, .99, // 1,2,6 => 1 continues
    ]))
    expect(result.stageResults.map((stage) => stage.inputDiceCount)).toEqual([4, 3])
    expect(result.stageResults.map((stage) => stage.continuationCount)).toEqual([3, 1])
    expect(result.finalResult).toBe(1)
  })

  it('feeds failures into the next stage', () => {
    const result = resolveDiceSequence(definition('failures'), sequenceRandom([
      0, .5, .7, .99, // one failure continues
      .99,
    ]))
    expect(result.stageResults[0]).toMatchObject({ successCount: 3, failureCount: 1, continuationCount: 1 })
    expect(result.stageResults[1].inputDiceCount).toBe(1)
  })

  it('uses the existing reroll engine within a stage', () => {
    const result = resolveDiceSequence({
      id: 'reroll', label: 'Reroll check', startingDiceCount: 3,
      stages: [{
        id: 'a', label: 'Stage A', sides: 6, threshold: 4, continuation: 'successes',
        reroll: { values: [1] },
      }],
    }, sequenceRandom([0, .2, .99, .8]))
    expect(result.stageResults[0].roll).toMatchObject({
      originalResults: [1, 2, 6], finalResults: [5, 2, 6], successes: 2,
      rerolls: [{ values: [1], indices: [0], previousResults: [1], replacementResults: [5] }],
    })
  })

  it('resolves deterministically one stage at a time and supports zero-dice stages', () => {
    const configured: DiceSequenceDefinition = {
      id: 'four', label: 'Four stages', startingDiceCount: 2,
      stages: [
        { id: 'a', label: 'A', sides: 6, threshold: 6, continuation: 'successes' },
        { id: 'b', label: 'B', sides: 6, threshold: 4, continuation: 'successes' },
        { id: 'c', label: 'C', sides: 6, threshold: 4, continuation: 'failures' },
        { id: 'd', label: 'D', sides: 6, threshold: 5, continuation: 'failures' },
      ],
    }
    const random = sequenceRandom([0, .1])
    let result = beginDiceSequence(configured)
    result = resolveNextDiceStage(result, random)
    expect(result.complete).toBe(false)
    expect(result.stageResults[0].continuationCount).toBe(0)
    result = resolveNextDiceStage(result, random)
    result = resolveNextDiceStage(result, random)
    result = resolveNextDiceStage(result, random)
    expect(result.stageResults.map((stage) => stage.inputDiceCount)).toEqual([2, 0, 0, 0])
    expect(result.finalResult).toBe(0)
    expect(structuredClone(result)).toEqual(result)
  })

  it('offers a small adapter seam for GameSystem threshold modifiers', () => {
    const modifiers: DiceStageModifierAdapter = {
      resolveThreshold: (threshold, context) => context.stage.modifierIds?.includes('harder')
        ? threshold + 1 : threshold,
    }
    const result = resolveDiceSequence({
      id: 'modified', label: 'Modified', startingDiceCount: 1,
      stages: [{
        id: 'a', label: 'A', sides: 6, threshold: 3, continuation: 'successes',
        modifierIds: ['harder'],
      }],
    }, sequenceRandom([.4]), modifiers) // rolls 3, but effective threshold is 4
    expect(result.stageResults[0]).toMatchObject({ effectiveThreshold: 4, successCount: 0 })
  })

  it('lets an adapter branch a recorded pool without replacing the generic dice engine', () => {
    const result = resolveDiceSequence(definition(), sequenceRandom([
      .99, .7, .5, 0, // 6,5,4,1: adapter branches the 6 away
      .99, .99, // two dice continue
    ]), {
      resolveContinuationCount: ({ defaultContinuationCount, roll }, context) => context.stage.id === 'a'
        ? defaultContinuationCount - roll.finalResults.filter((value) => value === 6).length
        : defaultContinuationCount,
    })
    expect(result.stageResults[0]).toMatchObject({ successCount: 3, continuationCount: 2 })
    expect(result.stageResults[1].inputDiceCount).toBe(2)
  })
})
