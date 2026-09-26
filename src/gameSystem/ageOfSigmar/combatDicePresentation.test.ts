import { describe, expect, it } from 'vitest'
import type { DicePoolResult, DiceSequenceResolution } from '../../domain/types'
import { aosCombatDiceStages, combatDiceReviewFingerprint, type AosCombatDiceReview } from './combatDicePresentation'

const pool = (results: number[], threshold?: number): DicePoolResult => ({
  count: results.length,
  sides: 6,
  originalResults: [...results],
  rerolls: [],
  finalResults: [...results],
  total: results.reduce((sum, value) => sum + value, 0),
  distribution: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [index + 1, results.filter((value) => value === index + 1).length])),
  ...(threshold === undefined ? {} : { successThreshold: threshold, successes: results.filter((value) => value >= threshold).length }),
})

function review(): AosCombatDiceReview {
  const hit = pool([6, 4, 2], 4)
  const wound = pool([5, 1], 3)
  const save = pool([4], 5)
  const resolution: DiceSequenceResolution = {
    definition: { id: 'attack', label: 'Attack', startingDiceCount: 3, stages: [
      { id: 'hit', label: 'Hit', sides: 6, threshold: 4, continuation: 'successes' },
      { id: 'wound', label: 'Wound', sides: 6, threshold: 3, continuation: 'successes' },
      { id: 'save', label: 'Save', sides: 6, threshold: 4, continuation: 'failures' },
    ] },
    stageResults: [
      { stage: { id: 'hit', label: 'Hit', sides: 6, threshold: 4, continuation: 'successes' }, inputDiceCount: 3, effectiveThreshold: 4, roll: hit, successCount: 2, failureCount: 1, continuationCount: 2 },
      { stage: { id: 'wound', label: 'Wound', sides: 6, threshold: 3, continuation: 'successes' }, inputDiceCount: 2, effectiveThreshold: 3, roll: wound, successCount: 1, failureCount: 1, continuationCount: 1 },
      { stage: { id: 'save', label: 'Save', sides: 6, threshold: 4, continuation: 'failures' }, inputDiceCount: 1, effectiveThreshold: 5, roll: save, successCount: 0, failureCount: 1, continuationCount: 1 },
    ],
    complete: true,
    finalResult: 1,
  }
  return { attackerUnitId: 'liberators', profileId: 'hammer', targetUnitId: 'rats', sequenceRecordId: 'dice-sequence-1', resolution,
    thresholdContext: { save: { baseThreshold: 4, effectiveThreshold: 5, modifierLabel: 'Rend -1' } },
    ward: pool([5, 2], 5), damage: pool([3], undefined) }
}

describe('AoS combat dice presentation', () => {
  it('presents exact authoritative pools in resolution order with effective modifiers', () => {
    const stages = aosCombatDiceStages(review())
    expect(stages.map((stage) => stage.id)).toEqual(['hit', 'wound', 'save', 'ward', 'damage'])
    expect(stages[0].results).toEqual([6, 4, 2])
    expect(stages[2]).toMatchObject({ baseThreshold: 4, effectiveThreshold: 5, thresholdModifier: 1, modifierLabel: 'Rend -1', continuation: 1 })
    expect(stages[3]).toMatchObject({ successes: 1, failures: 1, continuation: 1 })
    expect(stages[4]).toMatchObject({ continuation: 3 })
  })

  it('is mode-independent and never mutates or rerolls the stored results', () => {
    const value = review()
    const before = structuredClone(value)
    const quickFingerprint = combatDiceReviewFingerprint(value)
    const stepFingerprint = combatDiceReviewFingerprint(value)
    expect(stepFingerprint).toBe(quickFingerprint)
    expect(value).toEqual(before)
  })
})
