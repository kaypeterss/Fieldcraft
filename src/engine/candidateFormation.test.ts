import { describe, expect, it } from 'vitest'
import type { TabletopModel, Unit } from '../domain/types'
import {
  projectCandidateModels,
  validateCandidateFormation,
} from './candidateFormation'

const battlefield = { width: 20, height: 20 }

function model(id: string, x: number, y: number, unitId = 'unit-1'): TabletopModel {
  return {
    id,
    unitId,
    ownerId: 'player-1',
    position: { x, y },
    rotation: 0,
    base: { shape: 'circle', diameterMm: 25.4 },
    canPassOverModels: false,
  }
}

describe('candidate formation validation', () => {
  it('projects hypothetical positions without mutating authoritative models', () => {
    const models = [model('a', 2, 2), model('b', 5, 2)]
    const snapshot = structuredClone(models)
    const projected = projectCandidateModels(models, { a: { x: 3, y: 4 } })
    expect(projected[0].position).toEqual({ x: 3, y: 4 })
    expect(projected[1]).toBe(models[1])
    expect(models).toEqual(snapshot)
  })

  it('reports bases that extend beyond the battlefield', () => {
    const result = validateCandidateFormation({
      allModels: [model('a', 2, 2)],
      battlefield,
      positions: { a: { x: 0.49, y: 2 } },
    })
    expect(result.destinationValid).toBe(false)
    expect(result.violations).toContainEqual({ type: 'OUT_OF_BOUNDS', modelIds: ['a'] })
  })

  it('allows touching stationary models and reports stationary overlap', () => {
    const models = [model('a', 2, 2), model('blocker', 5, 2, 'unit-2')]
    expect(validateCandidateFormation({
      allModels: models,
      battlefield,
      positions: { a: { x: 4, y: 2 } },
    }).valid).toBe(true)
    expect(validateCandidateFormation({
      allModels: models,
      battlefield,
      positions: { a: { x: 4.1, y: 2 } },
    }).violations).toContainEqual({
      type: 'COLLIDES_WITH_STATIONARY_MODEL',
      modelIds: ['a', 'blocker'],
    })
  })

  it('checks independently positioned candidate models against each other', () => {
    const result = validateCandidateFormation({
      allModels: [model('a', 2, 2), model('b', 5, 2)],
      battlefield,
      positions: { a: { x: 8, y: 8 }, b: { x: 8.5, y: 8 } },
    })
    expect(result.violations).toContainEqual({
      type: 'CANDIDATE_INTERNAL_OVERLAP',
      modelIds: ['a', 'b'],
    })
  })

  it('keeps destination validity separate from caller-supplied reachability cost', () => {
    const result = validateCandidateFormation({
      allModels: [model('a', 2, 2)],
      battlefield,
      positions: { a: { x: 8, y: 2 } },
      reachability: {
        movementCosts: { a: 7 },
        movementAllowances: { a: 6 },
      },
    })
    expect(result.destinationValid).toBe(true)
    expect(result.reachabilityValid).toBe(false)
    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual({
      type: 'MOVEMENT_ALLOWANCE_EXCEEDED',
      modelIds: ['a'],
      movementCost: 7,
      movementAllowance: 6,
    })
  })

  it('optionally reuses coherency evaluation on projected positions', () => {
    const models = [model('a', 2, 2), model('b', 3, 2)]
    const unit: Unit = { id: 'unit-1', ownerId: 'player-1', definitionId: 'definition-1', modelIds: ['a', 'b'] }
    const positions = { b: { x: 10, y: 2 } }
    expect(validateCandidateFormation({ allModels: models, battlefield, positions }).valid).toBe(true)
    const result = validateCandidateFormation({
      allModels: models,
      battlefield,
      positions,
      coherency: { unit, policy: { distance: 1, requiredNeighbors: 1 } },
    })
    expect(result.destinationValid).toBe(false)
    expect(result.violations.some((violation) => violation.type === 'COHERENCY_FAILED')).toBe(true)
  })
})
