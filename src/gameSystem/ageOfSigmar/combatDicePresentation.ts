import type { DicePoolResult, DiceSequenceResolution } from '../../domain/types'

export type AosCombatDiceMode = 'quick' | 'step'

/**
 * UI-only view over the exact pools already used by the authoritative combat command.
 * It deliberately contains no random source and cannot resolve or reroll anything.
 */
export interface AosCombatDiceReview {
  attackerUnitId: string
  profileId: string
  targetUnitId: string
  sequenceRecordId: string
  resolution: DiceSequenceResolution
  ward?: DicePoolResult
  damage?: DicePoolResult
  thresholdContext?: Readonly<Record<string, { baseThreshold: number; effectiveThreshold: number; modifierLabel?: string }>>
}

export interface AosCombatDiceStageView {
  id: string
  label: string
  inputDiceCount: number
  sides: number
  baseThreshold?: number
  effectiveThreshold?: number
  thresholdModifier?: number
  results: readonly number[]
  successes?: number
  failures?: number
  continuation: number
  continuationLabel: string
  modifierLabel?: string
}

/** The order here is the player-facing AoS resolution order, not a second resolver. */
export function aosCombatDiceStages(review: AosCombatDiceReview): AosCombatDiceStageView[] {
  const sequenceStages = review.resolution.stageResults.map((result) => {
    const threshold = review.thresholdContext?.[result.stage.id]
    const baseThreshold = threshold?.baseThreshold ?? result.stage.threshold
    const effectiveThreshold = threshold?.effectiveThreshold ?? result.effectiveThreshold
    return {
    id: result.stage.id,
    label: result.stage.label,
    inputDiceCount: result.inputDiceCount,
    sides: result.stage.sides,
    baseThreshold,
    effectiveThreshold,
    thresholdModifier: effectiveThreshold - baseThreshold,
    ...(threshold?.modifierLabel ? { modifierLabel: threshold.modifierLabel } : {}),
    results: result.roll.finalResults,
    successes: result.successCount,
    failures: result.failureCount,
    continuation: result.continuationCount,
    continuationLabel: result.stage.continuation === 'successes' ? 'continue' : 'unsaved',
  }})
  const ward = review.ward ? [poolStage('ward', 'Ward', review.ward, 'damage remains', true)] : []
  const damage = review.damage ? [poolStage('damage', 'Damage', review.damage, 'damage', false)] : []
  return [...sequenceStages, ...ward, ...damage]
}

export function combatDiceReviewFingerprint(review: AosCombatDiceReview): string {
  return JSON.stringify(aosCombatDiceStages(review).map((stage) => ({
    id: stage.id,
    results: stage.results,
    successes: stage.successes,
    failures: stage.failures,
    continuation: stage.continuation,
  })))
}

function poolStage(
  id: string,
  label: string,
  pool: DicePoolResult,
  continuationLabel: string,
  continueOnFailures: boolean,
): AosCombatDiceStageView {
  const successes = pool.successes
  const failures = successes === undefined ? undefined : pool.count - successes
  return {
    id,
    label,
    inputDiceCount: pool.count,
    sides: pool.sides,
    ...(pool.successThreshold === undefined ? {} : {
      baseThreshold: pool.successThreshold,
      effectiveThreshold: pool.successThreshold,
      thresholdModifier: 0,
    }),
    results: pool.finalResults,
    ...(successes === undefined ? {} : { successes, failures }),
    continuation: successes === undefined ? pool.total : continueOnFailures ? failures ?? 0 : pool.total,
    continuationLabel,
  }
}
