import type {
  DiceSequenceDefinition,
  DiceSequenceResolution,
  DiceStageDefinition,
  DiceStageResult,
} from '../domain/types'
import { rerollDiceValues, rollDice, type RandomSource } from './dice'

export interface DiceStageModifierContext {
  sequence: DiceSequenceDefinition
  stage: DiceStageDefinition
  stageIndex: number
  inputDiceCount: number
}

/**
 * Minimal GameSystem seam. Adapter-owned modifier IDs may adjust a threshold;
 * result modification remains deliberately deferred until its audit trail is defined.
 */
export interface DiceStageModifierAdapter {
  resolveThreshold?: (baseThreshold: number, context: DiceStageModifierContext) => number
}

export function beginDiceSequence(definition: DiceSequenceDefinition): DiceSequenceResolution {
  validateDiceSequenceDefinition(definition)
  return {
    definition: cloneDefinition(definition),
    stageResults: [],
    complete: definition.stages.length === 0,
    ...(definition.stages.length === 0 ? { finalResult: definition.startingDiceCount } : {}),
  }
}

export function resolveNextDiceStage(
  resolution: DiceSequenceResolution,
  random: RandomSource,
  modifiers?: DiceStageModifierAdapter,
): DiceSequenceResolution {
  validateDiceSequenceResolution(resolution)
  if (resolution.complete) return cloneResolution(resolution)
  const stageIndex = resolution.stageResults.length
  const stage = resolution.definition.stages[stageIndex]
  const previous = resolution.stageResults[stageIndex - 1]
  const inputDiceCount = previous?.continuationCount ?? resolution.definition.startingDiceCount
  const context: DiceStageModifierContext = {
    sequence: resolution.definition,
    stage,
    stageIndex,
    inputDiceCount,
  }
  const effectiveThreshold = modifiers?.resolveThreshold?.(stage.threshold, context) ?? stage.threshold
  if (!Number.isInteger(effectiveThreshold) || effectiveThreshold < 1 || effectiveThreshold > stage.sides) {
    throw new RangeError(`Effective threshold for stage ${stage.id} must be from 1 to D${stage.sides}`)
  }
  let roll = rollDice({ count: inputDiceCount, sides: stage.sides, successThreshold: effectiveThreshold }, random)
  if (inputDiceCount > 0 && stage.reroll?.values.length) {
    roll = rerollDiceValues(roll, stage.reroll.values, random)
  }
  const successCount = roll.successes ?? 0
  const failureCount = inputDiceCount - successCount
  const continuationCount = stage.continuation === 'successes' ? successCount : failureCount
  const stageResult: DiceStageResult = {
    stage: cloneStage(stage),
    inputDiceCount,
    effectiveThreshold,
    roll,
    successCount,
    failureCount,
    continuationCount,
  }
  const stageResults = [...resolution.stageResults.map(cloneStageResult), stageResult]
  const complete = stageResults.length === resolution.definition.stages.length
  return {
    definition: cloneDefinition(resolution.definition),
    stageResults,
    complete,
    ...(complete ? { finalResult: continuationCount } : {}),
  }
}

export function resolveRemainingDiceSequence(
  resolution: DiceSequenceResolution,
  random: RandomSource,
  modifiers?: DiceStageModifierAdapter,
): DiceSequenceResolution {
  let current = cloneResolution(resolution)
  while (!current.complete) current = resolveNextDiceStage(current, random, modifiers)
  return current
}

export function resolveDiceSequence(
  definition: DiceSequenceDefinition,
  random: RandomSource,
  modifiers?: DiceStageModifierAdapter,
): DiceSequenceResolution {
  return resolveRemainingDiceSequence(beginDiceSequence(definition), random, modifiers)
}

export function validateDiceSequenceDefinition(definition: DiceSequenceDefinition): void {
  if (!definition.id.trim() || !definition.label.trim()) throw new RangeError('Sequence ID and label are required')
  if (!Number.isInteger(definition.startingDiceCount) || definition.startingDiceCount < 0) {
    throw new RangeError('Starting dice count must be a non-negative integer')
  }
  const ids = new Set<string>()
  definition.stages.forEach((stage) => {
    if (!stage.id.trim() || !stage.label.trim()) throw new RangeError('Stage ID and label are required')
    if (ids.has(stage.id)) throw new RangeError(`Duplicate dice stage ID: ${stage.id}`)
    ids.add(stage.id)
    if (!Number.isInteger(stage.sides) || stage.sides < 2) throw new RangeError('Stage die sides must be at least 2')
    if (!Number.isInteger(stage.threshold) || stage.threshold < 1 || stage.threshold > stage.sides) {
      throw new RangeError(`Stage threshold must be from 1 to D${stage.sides}`)
    }
    if (stage.reroll?.values.some((value) => !Number.isInteger(value) || value < 1 || value > stage.sides)) {
      throw new RangeError(`Stage reroll values must be from 1 to D${stage.sides}`)
    }
  })
}

function validateDiceSequenceResolution(resolution: DiceSequenceResolution): void {
  validateDiceSequenceDefinition(resolution.definition)
  if (resolution.stageResults.length > resolution.definition.stages.length) {
    throw new RangeError('Sequence has more results than configured stages')
  }
  if (resolution.complete !== (resolution.stageResults.length === resolution.definition.stages.length)) {
    throw new RangeError('Sequence completion flag does not match its stage results')
  }
}

export function cloneResolution(resolution: DiceSequenceResolution): DiceSequenceResolution {
  return {
    definition: cloneDefinition(resolution.definition),
    stageResults: resolution.stageResults.map(cloneStageResult),
    complete: resolution.complete,
    ...(resolution.finalResult === undefined ? {} : { finalResult: resolution.finalResult }),
  }
}

function cloneDefinition(definition: DiceSequenceDefinition): DiceSequenceDefinition {
  return { ...definition, stages: definition.stages.map(cloneStage) }
}

function cloneStage(stage: DiceStageDefinition): DiceStageDefinition {
  return {
    ...stage,
    ...(stage.reroll ? { reroll: { values: [...stage.reroll.values] } } : {}),
    ...(stage.modifierIds ? { modifierIds: [...stage.modifierIds] } : {}),
  }
}

function cloneStageResult(result: DiceStageResult): DiceStageResult {
  return {
    ...result,
    stage: cloneStage(result.stage),
    roll: {
      ...result.roll,
      originalResults: [...result.roll.originalResults],
      rerolls: result.roll.rerolls.map((reroll) => ({
        values: [...reroll.values], indices: [...reroll.indices],
        previousResults: [...reroll.previousResults], replacementResults: [...reroll.replacementResults],
      })),
      finalResults: [...result.roll.finalResults],
      distribution: { ...result.roll.distribution },
    },
  }
}
