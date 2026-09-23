import type { DicePoolResult, DiceReroll } from '../domain/types'

export interface RandomSource {
  /** Returns a uniformly distributed value in the half-open range [0, 1). */
  next(): number
}

/** The only production boundary that directly uses Math.random. */
export const systemRandomSource: RandomSource = {
  next: () => Math.random(),
}

export interface DiceRollRequest {
  count: number
  sides: number
  successThreshold?: number
}

export function rollDice(request: DiceRollRequest, random: RandomSource): DicePoolResult {
  validateDiceRequest(request)
  const originalResults = Array.from({ length: request.count }, () => rollDie(request.sides, random))
  return summarizeDicePool({
    count: request.count,
    sides: request.sides,
    originalResults,
    rerolls: [],
    finalResults: originalResults,
    successThreshold: request.successThreshold,
  })
}

/** Rerolls every current die whose value is selected, once for this reroll pass. */
export function rerollDiceValues(
  pool: DicePoolResult,
  selectedValues: readonly number[],
  random: RandomSource,
): DicePoolResult {
  assertDicePoolIntegrity(pool)
  const values = [...new Set(selectedValues)].sort((a, b) => a - b)
  if (values.length === 0) return cloneDicePool(pool)
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > pool.sides)) {
    throw new RangeError(`Reroll values must be integers from 1 to D${pool.sides}`)
  }
  const selected = new Set(values)
  const finalResults = [...pool.finalResults]
  const indices: number[] = []
  const previousResults: number[] = []
  const replacementResults: number[] = []
  finalResults.forEach((value, index) => {
    if (!selected.has(value)) return
    const replacement = rollDie(pool.sides, random)
    indices.push(index)
    previousResults.push(value)
    replacementResults.push(replacement)
    finalResults[index] = replacement
  })
  const reroll: DiceReroll = { values, indices, previousResults, replacementResults }
  return summarizeDicePool({
    ...pool,
    originalResults: [...pool.originalResults],
    rerolls: [...pool.rerolls.map(cloneReroll), reroll],
    finalResults,
  })
}

export function countSuccesses(results: readonly number[], threshold: number, sides: number): number {
  validateSuccessThreshold(threshold, sides)
  return results.reduce((total, value) => total + Number(value >= threshold), 0)
}

export function resultDistribution(results: readonly number[], sides: number): Record<number, number> {
  validateSides(sides)
  const distribution: Record<number, number> = {}
  for (let value = 1; value <= sides; value += 1) distribution[value] = 0
  results.forEach((value) => {
    if (!Number.isInteger(value) || value < 1 || value > sides) {
      throw new RangeError(`Die result must be an integer from 1 to D${sides}`)
    }
    distribution[value] += 1
  })
  return distribution
}

export function cloneDicePool(pool: DicePoolResult): DicePoolResult {
  return {
    ...pool,
    originalResults: [...pool.originalResults],
    rerolls: pool.rerolls.map(cloneReroll),
    finalResults: [...pool.finalResults],
    distribution: { ...pool.distribution },
  }
}

export function assertDicePoolIntegrity(pool: DicePoolResult): void {
  validateDiceRequest(pool)
  if (pool.originalResults.length !== pool.count || pool.finalResults.length !== pool.count) {
    throw new RangeError('Dice pool result count does not match its result arrays')
  }
  const expected = summarizeDicePool({
    count: pool.count,
    sides: pool.sides,
    originalResults: pool.originalResults,
    rerolls: pool.rerolls,
    finalResults: pool.finalResults,
    successThreshold: pool.successThreshold,
  })
  if (expected.total !== pool.total || expected.successes !== pool.successes
    || Object.keys(expected.distribution).some((key) => (
      expected.distribution[Number(key)] !== pool.distribution[Number(key)]
    ))) throw new RangeError('Dice pool summary does not match its final results')
  pool.rerolls.forEach((reroll) => {
    if (reroll.indices.length !== reroll.previousResults.length
      || reroll.indices.length !== reroll.replacementResults.length) {
      throw new RangeError('Dice reroll arrays must have matching lengths')
    }
  })
}

function summarizeDicePool(pool: Omit<DicePoolResult, 'total' | 'distribution' | 'successes'>): DicePoolResult {
  const finalResults = [...pool.finalResults]
  const total = finalResults.reduce((sum, value) => sum + value, 0)
  return {
    ...pool,
    originalResults: [...pool.originalResults],
    rerolls: pool.rerolls.map(cloneReroll),
    finalResults,
    total,
    distribution: resultDistribution(finalResults, pool.sides),
    ...(pool.successThreshold === undefined ? {} : {
      successes: countSuccesses(finalResults, pool.successThreshold, pool.sides),
    }),
  }
}

function rollDie(sides: number, random: RandomSource): number {
  const value = random.next()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('RandomSource.next() must return a finite value in [0, 1)')
  }
  return Math.floor(value * sides) + 1
}

function validateDiceRequest(request: DiceRollRequest): void {
  if (!Number.isInteger(request.count) || request.count < 0) {
    throw new RangeError('Dice count must be a non-negative integer')
  }
  validateSides(request.sides)
  if (request.successThreshold !== undefined) {
    validateSuccessThreshold(request.successThreshold, request.sides)
  }
}

function validateSides(sides: number): void {
  if (!Number.isInteger(sides) || sides < 2) throw new RangeError('Die sides must be an integer of at least 2')
}

function validateSuccessThreshold(threshold: number, sides: number): void {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > sides) {
    throw new RangeError(`Success threshold must be an integer from 1 to D${sides}`)
  }
}

function cloneReroll(reroll: DiceReroll): DiceReroll {
  return {
    values: [...reroll.values],
    indices: [...reroll.indices],
    previousResults: [...reroll.previousResults],
    replacementResults: [...reroll.replacementResults],
  }
}
