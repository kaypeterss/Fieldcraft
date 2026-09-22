import { describe, expect, it } from 'vitest'
import type { GameState, TabletopModel, Unit } from '../domain/types'
import type { CoherencyPolicy } from './coherency'
import { hasUnitPerformedAction, movementUsedByModelInTurn } from '../game/actionQueries'
import { gameReducer } from '../state/reducer'
import { circlesOverlap } from './geometry/circles'
import { distanceBetween } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { createModelPathPlanner, findModelPath } from './pathfinding'
import { evaluateUnitCoherency } from './coherency'
import { baseRadiusInches, distanceBetweenBases } from './spatial'
import { solveSmartMove } from './smartMove'

const battlefield = { width: 30, height: 24 }

function model(
  id: string,
  x: number,
  y: number,
  unitId = 'unit-a',
  diameterMm = 25.4,
  canPassOverModels = false,
): TabletopModel {
  return {
    id,
    unitId,
    ownerId: unitId === 'unit-a' ? 'player-a' : 'player-b',
    position: { x, y },
    rotation: 0,
    base: { shape: 'circle', diameterMm },
    canPassOverModels,
  }
}

function unit(id: string, modelIds: string[]): Unit {
  return { id, modelIds, ownerId: id === 'unit-a' ? 'player-a' : 'player-b', definitionId: `def-${id}` }
}

function solve(
  models: TabletopModel[],
  units: Unit[],
  selectedModelIds: string[],
  target: { x: number; y: number },
  movementRemaining: Record<string, number> = Object.fromEntries(selectedModelIds.map((id) => [id, 20])),
  coherencyPolicy: CoherencyPolicy = { distance: 1, requiredNeighbors: 1 },
) {
  return solveSmartMove({
    allModels: models,
    units,
    battlefield,
    selectedModelIds,
    target,
    movementRemaining,
    coherencyPolicy,
  })
}

function gameState(models: TabletopModel[], units: Unit[]): GameState {
  return {
    schemaVersion: 3,
    battlefield,
    players: [{ id: 'player-a', displayName: 'A' }, { id: 'player-b', displayName: 'B' }],
    models,
    units,
    unitDefinitions: units.map((entry) => ({ id: entry.definitionId, name: entry.id, movementAllowance: 20 })),
    gameContext: { round: 2, turn: 1, turnSequence: 3, turnId: 'turn-3', activePlayerId: 'player-a' },
    turnConfiguration: { playerOrder: ['player-a', 'player-b'] },
    actionHistory: [],
    nextActionSequence: 1,
    movementSession: null,
    lastConfirmedMovementUndo: null,
  }
}

describe('Smart Move pathfinding', () => {
  it('routes a normal model around a circular blocker and counts the detour', () => {
    const mover = model('mover', 2, 8)
    const blocker = model('blocker', 5, 8, 'unit-b')
    const result = findModelPath({ model: mover, destination: { x: 8, y: 8 }, obstacles: [blocker], battlefield })
    expect(result).not.toBeNull()
    expect(result!.path.length).toBeGreaterThan(2)
    expect(result!.distance).toBeGreaterThan(6)
  })

  it('uses a direct path for pass-over models but still rejects an overlapping destination', () => {
    const flyer = model('flyer', 2, 8, 'unit-a', 25.4, true)
    const blocker = model('blocker', 5, 8, 'unit-b')
    expect(findModelPath({ model: flyer, destination: { x: 8, y: 8 }, obstacles: [blocker], battlefield })).toMatchObject({ distance: 6 })
    expect(findModelPath({ model: flyer, destination: { x: 5, y: 8 }, obstacles: [blocker], battlefield })).toBeNull()
  })

  it('reuses a scoped visibility graph without changing deterministic path results', () => {
    const mover = model('planner-mover', 2, 8)
    const obstacles = [
      model('planner-blocker-a', 5, 8, 'unit-b'),
      model('planner-blocker-b', 8, 8, 'unit-b'),
    ]
    const planner = createModelPathPlanner()
    for (const destination of [{ x: 11, y: 7 }, { x: 11, y: 9 }, { x: 11, y: 10 }]) {
      const request = { model: mover, destination, obstacles, battlefield }
      expect(findModelPath(request, planner)).toEqual(findModelPath(request))
    }
    expect(planner.visibilityGraphs.size).toBeGreaterThan(0)
  })
})

describe('Smart Move solver', () => {
  it('accepts one, partial, and complete same-unit selections and rejects multiple units', () => {
    const models = [model('a', 2, 2), model('b', 3, 2), model('c', 4, 2), model('x', 20, 20, 'unit-b')]
    const units = [unit('unit-a', ['a', 'b', 'c']), unit('unit-b', ['x'])]
    expect(solve(models, units, ['c'], { x: 4, y: 3 }).failureReasons).not.toContain('INVALID_SELECTION')
    expect(solve(models, units, ['b', 'c'], { x: 4, y: 3 }).failureReasons).not.toContain('INVALID_SELECTION')
    expect(solve(models, units, ['a', 'b', 'c'], { x: 8, y: 8 }).failureReasons).not.toContain('INVALID_SELECTION')
    expect(solve(models, units, ['a', 'x'], { x: 8, y: 8 }).failureReasons).toContain('MULTIPLE_UNITS')
  })

  it('generates a deterministic valid formation without mutating input', () => {
    const models = Array.from({ length: 5 }, (_, index) => model(`a${index}`, 2 + index * 1.2, 3))
    const units = [unit('unit-a', models.map((entry) => entry.id))]
    const snapshot = structuredClone({ models, units })
    const first = solve(models, units, models.map((entry) => entry.id), { x: 12, y: 12 })
    const second = solve(models, units, models.map((entry) => entry.id), { x: 12, y: 12 })
    expect(first.valid).toBe(true)
    expect(second.positions).toEqual(first.positions)
    expect(second.assignments).toEqual(first.assignments)
    expect({ models, units }).toEqual(snapshot)
    const candidateModels = models.map((entry) => ({ ...entry, position: first.positions[entry.id] }))
    for (let source = 0; source < candidateModels.length; source += 1) {
      for (let target = source + 1; target < candidateModels.length; target += 1) {
        expect(circlesOverlap(
          candidateModels[source].position,
          baseRadiusInches(candidateModels[source].base),
          candidateModels[target].position,
          baseRadiusInches(candidateModels[target].base),
        )).toBe(false)
      }
    }
  })

  it.each([
    { name: 'one-neighbor', diameterMm: 25.4, policy: { distance: 1, requiredNeighbors: 1 } },
    { name: 'two-neighbor', diameterMm: 32, policy: { distance: 1, requiredNeighbors: 2 } },
    { name: 'three-neighbor', diameterMm: 50, policy: { distance: 2, requiredNeighbors: 3 } },
  ])('uses the complete $name policy while maximizing target progress', ({ diameterMm, policy }) => {
    const touching = diameterMm / 25.4 + GEOMETRY_EPSILON * 16
    const starts = compactHexPoints(10, { x: 10, y: 12 }, touching + policy.distance * 0.4)
    const models = starts.map((position, index) => model(
      `policy-${index}`,
      position.x,
      position.y,
      'unit-a',
      diameterMm,
      true,
    ))
    const selectedIds = models.map((entry) => entry.id)
    const unitA = unit('unit-a', selectedIds)
    const target = { x: 20, y: 12 }
    const result = solve(
      models,
      [unitA],
      selectedIds,
      target,
      Object.fromEntries(selectedIds.map((id) => [id, 30])),
      policy,
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    const projected = models.map((entry) => ({ ...entry, position: result.positions[entry.id] }))
    const coherency = evaluateUnitCoherency(unitA, projected, policy)
    expect(coherency.coherent).toBe(true)
    expect(coherency.models.every((entry) => entry.neighborCount >= policy.requiredNeighbors)).toBe(true)
    expect(projected.every((entry) => (
      distanceBetween(entry.position, target) < distanceBetween(
        models.find((modelValue) => modelValue.id === entry.id)!.position,
        target,
      )
    ))).toBe(true)
  })

  it('does not maximize spacing when a nearer sensible formation already fulfills the target', () => {
    const spacing = 1 + 0.4 + GEOMETRY_EPSILON * 16
    const starts = compactHexPoints(5, { x: 8, y: 8 }, spacing)
    const models = starts.map((position, index) => model(`a${index}`, position.x, position.y, 'unit-a', 25.4, true))
    const unitA = unit('unit-a', models.map((entry) => entry.id))
    const result = solve(
      models,
      [unitA],
      models.map((entry) => entry.id),
      { x: 16, y: 8 },
      Object.fromEntries(models.map((entry) => [entry.id, 20])),
    )
    expect(result.valid).toBe(true)
    const projected = models.map((entry) => ({ ...entry, position: result.positions[entry.id] }))
    const minimumEdgeGap = Math.min(...projected.flatMap((source, sourceIndex) => projected
      .slice(sourceIndex + 1)
      .map((targetModel) => distanceBetweenBases(source, targetModel))))
    expect(minimumEdgeGap).toBeLessThan(1)
  })

  it('moves one model only as far toward the target as complete-unit coherency permits', () => {
    const fixed = model('fixed', 2, 4)
    const selected = model('selected', 3, 4)
    const unitA = unit('unit-a', ['fixed', 'selected'])
    const result = solve(
      [fixed, selected],
      [unitA],
      ['selected'],
      { x: 10, y: 4 },
      { selected: 6 },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.positions.selected.x).toBeGreaterThan(selected.position.x)
    expect(result.positions.selected.x).toBeLessThanOrEqual(4 + GEOMETRY_EPSILON)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('keeps unselected same-unit models fixed and evaluates complete-unit coherency', () => {
    const fixed = [model('fixed-a', 3, 3), model('fixed-b', 4, 3)]
    const moving = [model('moving-a', 5, 3), model('moving-b', 6, 3)]
    const models = [...fixed, ...moving]
    const units = [unit('unit-a', models.map((entry) => entry.id))]
    const valid = solve(models, units, moving.map((entry) => entry.id), { x: 5, y: 4 })
    expect(valid.valid, JSON.stringify(valid)).toBe(true)
    expect(Object.keys(valid.positions).sort()).toEqual(['moving-a', 'moving-b'])
    expect(valid.coherency?.connected).toBe(true)

    const disconnected = solve(
      models,
      units,
      moving.map((entry) => entry.id),
      { x: 20, y: 18 },
      undefined,
      { distance: 1, requiredNeighbors: 1, requireConnected: true },
    )
    expect(disconnected.valid).toBe(false)
    expect(disconnected.failureReasons).toContain('COHERENCY')
    expect(models.map((entry) => entry.position)).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
    ])
  })

  it('respects mixed base sizes and adapts candidates inward at battlefield edges', () => {
    const models = [model('small', 2, 2, 'unit-a', 25.4), model('large', 4, 2, 'unit-a', 50.8)]
    const units = [unit('unit-a', ['small', 'large'])]
    const result = solve(models, units, ['small', 'large'], { x: 0.1, y: 0.1 })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    for (const candidate of models) {
      const position = result.positions[candidate.id]
      const radius = baseRadiusInches(candidate.base)
      expect(position.x).toBeGreaterThanOrEqual(radius - GEOMETRY_EPSILON)
      expect(position.y).toBeGreaterThanOrEqual(radius - GEOMETRY_EPSILON)
    }
    expect(circlesOverlap(
      result.positions.small,
      baseRadiusInches(models[0].base),
      result.positions.large,
      baseRadiusInches(models[1].base),
    )).toBe(false)
  })

  it.each([
    { label: 'top-left', target: { x: 0.1, y: 0.1 } },
    { label: 'top-right', target: { x: 29.9, y: 0.1 } },
    { label: 'bottom-left', target: { x: 0.1, y: 23.9 } },
    { label: 'bottom-right', target: { x: 29.9, y: 23.9 } },
  ])('keeps formations inside the battlefield at the $label corner', ({ target }) => {
    const models = [model('a', 14, 11), model('b', 15.2, 11), model('c', 16.4, 11)]
    const units = [unit('unit-a', models.map((entry) => entry.id))]
    const result = solve(models, units, models.map((entry) => entry.id), target, { a: 40, b: 40, c: 40 })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    for (const candidate of models) {
      const position = result.positions[candidate.id]
      const radius = baseRadiusInches(candidate.base)
      expect(position.x).toBeGreaterThanOrEqual(radius - GEOMETRY_EPSILON)
      expect(position.x).toBeLessThanOrEqual(battlefield.width - radius + GEOMETRY_EPSILON)
      expect(position.y).toBeGreaterThanOrEqual(radius - GEOMETRY_EPSILON)
      expect(position.y).toBeLessThanOrEqual(battlefield.height - radius + GEOMETRY_EPSILON)
    }
  })

  it.each([
    { label: 'left', target: { x: -5, y: 12 } },
    { label: 'right', target: { x: 40, y: 12 } },
    { label: 'top', target: { x: 15, y: -5 } },
    { label: 'bottom', target: { x: 15, y: 34 } },
    { label: 'corner', target: { x: 40, y: 34 } },
  ])('accepts an unconstrained target outside the $label edge while containing models', ({ target }) => {
    const models = [model('outside-a', 14, 12), model('outside-b', 15.2, 12)]
    const result = solve(
      models,
      [unit('unit-a', models.map((entry) => entry.id))],
      models.map((entry) => entry.id),
      target,
      { 'outside-a': 6, 'outside-b': 6 },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.target).toEqual(target)
    for (const candidate of models) {
      const position = result.positions[candidate.id]
      const radius = baseRadiusInches(candidate.base)
      expect(position.x).toBeGreaterThanOrEqual(radius - GEOMETRY_EPSILON)
      expect(position.x).toBeLessThanOrEqual(battlefield.width - radius + GEOMETRY_EPSILON)
      expect(position.y).toBeGreaterThanOrEqual(radius - GEOMETRY_EPSILON)
      expect(position.y).toBeLessThanOrEqual(battlefield.height - radius + GEOMETRY_EPSILON)
    }
  })

  it.each([25, 32, 50, 80])('stops a %imm base at its legal footprint boundary toward an outside target', (diameterMm) => {
    const radius = diameterMm / 25.4 / 2
    const mover = model(`edge-${diameterMm}`, battlefield.width - radius - 2.7, 12, 'unit-a', diameterMm)
    const result = solve(
      [mover],
      [unit('unit-a', [mover.id])],
      [mover.id],
      { x: battlefield.width + 12, y: 12 },
      { [mover.id]: 6 },
      { distance: 1, requiredNeighbors: 0, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.target.x).toBe(battlefield.width + 12)
    expect(result.positions[mover.id].x).toBeCloseTo(battlefield.width - radius, 8)
  })

  it('respects each model remaining movement independently', () => {
    const models = [model('limited', 2, 2), model('mobile', 3, 2)]
    const units = [unit('unit-a', ['limited', 'mobile'])]
    const result = solve(models, units, ['limited', 'mobile'], { x: 8, y: 8 }, { limited: 0.25, mobile: 20 })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    const limitedCost = result.assignments.find((assignment) => assignment.modelId === 'limited')!.movementCost
    const mobileCost = result.assignments.find((assignment) => assignment.modelId === 'mobile')!.movementCost
    expect(limitedCost).toBeGreaterThan(0)
    expect(limitedCost).toBeLessThanOrEqual(0.25 + GEOMETRY_EPSILON)
    expect(mobileCost).toBeGreaterThan(limitedCost)
  })

  it('treats a zero-remaining selected model as fixed while other models use their own budgets', () => {
    const models = [
      model('zero', 5, 8),
      model('two', 6.2, 8),
      model('four', 7.4, 8),
      model('six', 8.6, 8),
    ]
    const units = [unit('unit-a', models.map((entry) => entry.id))]
    const target = { x: 18, y: 8 }
    const result = solve(
      models,
      units,
      models.map((entry) => entry.id),
      target,
      { zero: 0, two: 2, four: 4, six: 6 },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    const assignments = Object.fromEntries(result.assignments.map((entry) => [entry.modelId, entry]))
    expect(assignments.zero.destination).toEqual(models[0].position)
    expect(assignments.zero.movementCost).toBe(0)
    expect(assignments.two.movementCost).toBeLessThanOrEqual(2 + GEOMETRY_EPSILON)
    expect(assignments.four.movementCost).toBeLessThanOrEqual(4 + GEOMETRY_EPSILON)
    expect(assignments.six.movementCost).toBeLessThanOrEqual(6 + GEOMETRY_EPSILON)
    expect(assignments.two.movementCost + assignments.four.movementCost + assignments.six.movementCost).toBeGreaterThan(0)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('stops at a close target instead of spending unused movement or overshooting it', () => {
    const models = [model('left', 5, 5), model('right', 6.2, 5)]
    const units = [unit('unit-a', ['left', 'right'])]
    const target = { x: 7.2, y: 5 }
    const result = solve(models, units, ['left', 'right'], target, { left: 6, right: 6 })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    for (const assignment of result.assignments) {
      const startDistance = distanceBetween(assignment.start, target)
      const finalDistance = distanceBetween(assignment.destination, target)
      expect(finalDistance).toBeLessThanOrEqual(startDistance + GEOMETRY_EPSILON)
      expect(assignment.movementCost).toBeLessThan(6)
    }
  })

  it('uses the full six-inch fast-path opportunity for a coherent open unit', () => {
    const starts = compactHexPoints(5, { x: 8, y: 10 }, 1.35)
    const models = starts.map((position, index) => model(
      `reform-${index}`,
      position.x,
      position.y,
      'unit-a',
      25.4,
      true,
    ))
    const selectedIds = models.map((entry) => entry.id)
    const target = { x: 22, y: 14 }
    const result = solve(
      models,
      [unit('unit-a', selectedIds)],
      selectedIds,
      target,
      Object.fromEntries(selectedIds.map((id) => [id, 6])),
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.fastPathAccepted).toBe(true)
    expect(result.diagnostics?.fallbackUsed).toBe(false)
    expect(result.assignments.every((assignment) => (
      Math.abs(assignment.movementCost - 6) <= GEOMETRY_EPSILON
    ))).toBe(true)
  })

  it('keeps a common translation when per-model direct convergence would collide', () => {
    const models = [model('upper', 5, 5), model('lower', 5, 6)]
    const selectedIds = models.map((entry) => entry.id)
    const result = solve(
      models,
      [unit('unit-a', selectedIds)],
      selectedIds,
      { x: 25, y: 5.5 },
      { upper: 6, lower: 6 },
      { distance: 1, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('COMMON_TRANSLATION')
    const offsets = result.assignments.map((assignment) => ({
      x: assignment.destination.x - assignment.start.x,
      y: assignment.destination.y - assignment.start.y,
    }))
    expect(result.assignments.every((assignment) => Math.abs(assignment.movementCost - 6) <= GEOMETRY_EPSILON)).toBe(true)
    expect(distanceBetween(offsets[0], offsets[1])).toBeLessThanOrEqual(GEOMETRY_EPSILON)
  })

  it.each([10, 20])('moves every model in an open coherent %i-model unit the full six inches', (count) => {
    const starts = compactHexPoints(count, { x: 9, y: 12 }, 1.35)
    const models = starts.map((position, index) => model(
      `open-${String(index).padStart(2, '0')}`,
      position.x,
      position.y,
      'unit-a',
      25.4,
      true,
    ))
    const selectedIds = models.map((entry) => entry.id)
    const result = solve(
      models,
      [unit('unit-a', selectedIds)],
      selectedIds,
      { x: 27, y: 12 },
      Object.fromEntries(selectedIds.map((id) => [id, 6])),
      { distance: 1, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.fastPathAccepted).toBe(true)
    expect(result.candidatesTested).toBeLessThanOrEqual(2)
    for (const assignment of result.assignments) {
      expect(assignment.movementCost).toBeCloseTo(6, 9)
      expect(distanceBetween(assignment.start, assignment.destination)).toBeCloseTo(6, 9)
    }
  })

  it('uses each different direct movement maximum when the simultaneous final formation is legal', () => {
    const models = [
      model('six-a', 8.6, 7),
      model('six-b', 7.4, 7),
      model('four', 5, 7),
      model('two', 2.6, 7),
    ]
    const selectedIds = models.map((entry) => entry.id)
    const result = solve(
      models,
      [unit('unit-a', selectedIds)],
      selectedIds,
      { x: 25, y: 7 },
      { 'six-a': 6, 'six-b': 6, four: 4, two: 2 },
      { distance: 10, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('DIRECT_MAXIMUM')
    expect(Object.fromEntries(result.assignments.map((assignment) => [
      assignment.modelId,
      Number(assignment.movementCost.toFixed(8)),
    ]))).toEqual({ four: 4, 'six-a': 6, 'six-b': 6, two: 2 })
  })

  it('fails safely when a blocker makes every searched formation unreachable', () => {
    const mover = model('mover', 2, 2)
    const companion = model('companion', 3, 2)
    const blockers = Array.from({ length: 8 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 8
      return model(`block-${index}`, 2 + Math.cos(angle) * 1.1, 2 + Math.sin(angle) * 1.1, 'unit-b')
    })
    const models = [mover, companion, ...blockers]
    const units = [unit('unit-a', ['mover', 'companion']), unit('unit-b', blockers.map((entry) => entry.id))]
    const snapshot = structuredClone(models)
    const result = solve(models, units, ['mover'], { x: 10, y: 10 })
    expect(result.valid).toBe(false)
    expect(result.failureReasons).toContain('NO_REACHABLE_FORMATION')
    expect(models).toEqual(snapshot)
  })

  it('orders fallback placement by current target distance with a stable ID tie-break', () => {
    const models = [
      model('near-b', 8, 5, 'unit-a', 25.4, true),
      model('far', 5, 4, 'unit-a', 25.4, true),
      model('near-a', 8, 3, 'unit-a', 25.4, true),
    ]
    const units = [unit('unit-a', models.map((entry) => entry.id))]
    const result = solve(
      models,
      units,
      models.map((entry) => entry.id),
      { x: 15, y: 4 },
      Object.fromEntries(models.map((entry) => [entry.id, 20])),
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.diagnostics?.fallbackOrder).toEqual(['near-a', 'near-b', 'far'])
  })

  it('builds a coherent advancing front around a blocker instead of holding the whole unit back', () => {
    const starts = compactHexPoints(10, { x: 7, y: 12 }, 1.2)
    const moving = starts.map((position, index) => model(`advance-${index}`, position.x, position.y))
    const blocker = model('central-blocker', 12, 12, 'unit-b', 50.8)
    const models = [...moving, blocker]
    const units = [unit('unit-a', moving.map((entry) => entry.id)), unit('unit-b', [blocker.id])]
    const result = solve(
      models,
      units,
      moving.map((entry) => entry.id),
      { x: 26, y: 12 },
      Object.fromEntries(moving.map((entry) => [entry.id, 8])),
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.coherency?.coherent).toBe(true)
    expect(result.coherency?.connected).toBe(true)
    expect(result.diagnostics!.totalTargetProgress).toBeGreaterThan(35)
    expect(result.diagnostics!.minimumUsefulProgressPercent).toBeGreaterThan(0)
  })

  it('lets the clear side advance strongly when a blocker affects only one side', () => {
    const moving = Array.from({ length: 10 }, (_, index) => {
      const row = index < 5 ? 0 : 1
      const column = index % 5
      return model(`side-${index}`, 5 + column * 1.2, 10.8 + row * 1.2)
    })
    const blocker = model('side-blocker', 12.2, 10.5, 'unit-b', 50.8)
    const models = [...moving, blocker]
    const units = [unit('unit-a', moving.map((entry) => entry.id)), unit('unit-b', [blocker.id])]
    const target = { x: 25, y: 12 }
    const result = solve(
      models,
      units,
      moving.map((entry) => entry.id),
      target,
      Object.fromEntries(moving.map((entry) => [entry.id, 7])),
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    const progress = (entry: TabletopModel) => distanceBetween(entry.position, target)
      - distanceBetween(result.positions[entry.id], target)
    const clearSideProgress = moving.slice(5).map(progress)
    expect(Math.max(...clearSideProgress)).toBeGreaterThan(5)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('allows later models to complete a two-neighbor policy for the first provisional model', () => {
    const starts = compactHexPoints(5, { x: 7, y: 12 }, 1.25)
    const models = starts.map((position, index) => model(
      `future-${index}`,
      position.x,
      position.y,
      'unit-a',
      32,
      true,
    ))
    const unitA = unit('unit-a', models.map((entry) => entry.id))
    const policy = { distance: 1, requiredNeighbors: 2, requireConnected: true }
    const result = solve(
      models,
      [unitA],
      models.map((entry) => entry.id),
      { x: 18, y: 12 },
      Object.fromEntries(models.map((entry) => [entry.id, 20])),
      policy,
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.coherency?.models.every((entry) => entry.neighborCount >= 2)).toBe(true)
  })

  it('uses bounded backtracking when the furthest-first branch cannot complete', () => {
    const moving = [
      model('front', 8, 12),
      model('middle', 6.8, 12),
      model('rear', 5.6, 12),
    ]
    const blockers = [model('gate-center', 11.5, 12, 'unit-b')]
    const models = [...moving, ...blockers]
    const units = [
      unit('unit-a', moving.map((entry) => entry.id)),
      unit('unit-b', blockers.map((entry) => entry.id)),
    ]
    const result = solve(
      models,
      units,
      moving.map((entry) => entry.id),
      { x: 18, y: 12 },
      Object.fromEntries(moving.map((entry) => [entry.id, 6])),
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.diagnostics!.backtrackingNodes).toBeGreaterThan(moving.length + 1)
    expect(result.diagnostics!.backtrackingNodes).toBeLessThanOrEqual(360)
    expect(result.diagnostics!.finalValidations).toBeGreaterThan(0)
  })

  it.each([25, 32, 50])('keeps equivalent %imm base fallback searches within explicit bounds', (diameterMm) => {
    const starts = compactHexPoints(10, { x: 10, y: 12 }, diameterMm / 25.4 + 0.4)
    const models = starts.map((position, index) => model(
      `base-${diameterMm}-${index}`,
      position.x,
      position.y,
      'unit-a',
      diameterMm,
      true,
    ))
    const result = solve(
      models,
      [unit('unit-a', models.map((entry) => entry.id))],
      models.map((entry) => entry.id),
      { x: 20, y: 12 },
      Object.fromEntries(models.map((entry) => [entry.id, 30])),
      { distance: 1, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.diagnostics!.candidatePositionsDeduplicated).toBeLessThan(10_000)
    expect(result.diagnostics!.pathfindingCalls).toBeLessThanOrEqual(1_220)
    expect(result.diagnostics!.backtrackingNodes).toBeLessThanOrEqual(360)
  })

  it.each([1, 2, 3])('keeps the 32mm-base %i-neighbor fallback policy within explicit bounds', (requiredNeighbors) => {
    const starts = compactHexPoints(10, { x: 10, y: 12 }, 32 / 25.4 + 0.4)
    const models = starts.map((position, index) => model(
      `policy32-${requiredNeighbors}-${index}`,
      position.x,
      position.y,
      'unit-a',
      32,
      true,
    ))
    const result = solve(
      models,
      [unit('unit-a', models.map((entry) => entry.id))],
      models.map((entry) => entry.id),
      { x: 20, y: 12 },
      Object.fromEntries(models.map((entry) => [entry.id, 30])),
      { distance: requiredNeighbors === 3 ? 2 : 1, requiredNeighbors, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.diagnostics!.pathfindingCalls).toBeLessThanOrEqual(1_220)
    expect(result.diagnostics!.backtrackingNodes).toBeLessThanOrEqual(360)
  })

  it.each([1, 5, 10, 20])('keeps the bounded search practical for %i selected models', (count) => {
    const starts = compactHexPoints(count, { x: 15, y: 12 })
    const models = Array.from({ length: count }, (_, index) => model(
      `model-${String(index).padStart(2, '0')}`,
      starts[index].x,
      starts[index].y,
      'unit-a',
      25.4,
      true,
    ))
    const units = [unit('unit-a', models.map((entry) => entry.id))]
    const startedAt = performance.now()
    const result = solveSmartMove({
      allModels: models,
      units,
      battlefield,
      selectedModelIds: models.map((entry) => entry.id),
      target: { x: 23, y: 12 },
      movementRemaining: Object.fromEntries(models.map((entry) => [entry.id, 30])),
      coherencyPolicy: { distance: 1, requiredNeighbors: count === 1 ? 0 : 1 },
    })
    const elapsedMs = performance.now() - startedAt
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.candidatesTested).toBeLessThanOrEqual(34)
    expect(elapsedMs).toBeLessThan(5_000)
  })

  it('bounds routed path work for a representative 20-model blocker fallback', () => {
    const spacing = 32 / 25.4 + 0.42
    const moving = Array.from({ length: 20 }, (_, index) => model(
      `perf-${String(index).padStart(2, '0')}`,
      6 + (index % 5) * spacing,
      15 + Math.floor(index / 5) * spacing,
      'unit-a',
      32,
    ))
    const blocker = model('perf-blocker', 13, 14.5, 'unit-b', 50)
    const result = solve(
      [...moving, blocker],
      [unit('unit-a', moving.map((entry) => entry.id)), unit('unit-b', [blocker.id])],
      moving.map((entry) => entry.id),
      { x: 30, y: 17 },
      Object.fromEntries(moving.map((entry) => [entry.id, 8])),
      { distance: 1, requiredNeighbors: 2, requireConnected: true },
    )
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('FALLBACK')
    expect(result.diagnostics!.pathfindingCalls).toBeLessThanOrEqual(100)
    expect(result.diagnostics!.directPathChecks).toBeLessThanOrEqual(1_000)
    expect(result.diagnostics!.backtrackingNodes).toBeLessThanOrEqual(60)
    expect(result.diagnostics!.totalTargetProgress).toBeGreaterThan(145)
    expect(result.coherency?.coherent).toBe(true)
  })
})

function compactHexPoints(count: number, center: { x: number; y: number }, spacing = 1 + GEOMETRY_EPSILON * 16) {
  const axial: Array<{ q: number; r: number }> = [{ q: 0, r: 0 }]
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ]
  for (let ring = 1; axial.length < count; ring += 1) {
    let current = { q: -ring, r: ring }
    for (const direction of directions) {
      for (let step = 0; step < ring && axial.length < count; step += 1) {
        axial.push({ ...current })
        current = { q: current.q + direction.q, r: current.r + direction.r }
      }
    }
  }
  const raw = axial.slice(0, count).map(({ q, r }) => ({
    x: spacing * (q + r / 2),
    y: spacing * (Math.sqrt(3) / 2) * r,
  }))
  const centroid = {
    x: raw.reduce((total, point) => total + point.x, 0) / raw.length,
    y: raw.reduce((total, point) => total + point.y, 0) / raw.length,
  }
  return raw.map((point) => ({
    x: center.x + point.x - centroid.x,
    y: center.y + point.y - centroid.y,
  }))
}

describe('Smart Move authoritative application', () => {
  it('applies one atomic MOVE action and existing undo restores the exact state', () => {
    const models = [model('a', 2, 2), model('b', 3, 2), model('fixed', 4, 2)]
    const units = [unit('unit-a', ['a', 'b', 'fixed'])]
    const state = gameState(models, units)
    const solved = solve(models, units, ['a', 'b'], { x: 4, y: 3 })
    expect(solved.valid, JSON.stringify(solved)).toBe(true)
    const applied = gameReducer(state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: Object.fromEntries(solved.assignments.map((entry) => [entry.modelId, entry.start])),
      finalPositions: Object.fromEntries(solved.assignments.map((entry) => [entry.modelId, entry.destination])),
      movementUsed: Object.fromEntries(solved.assignments.map((entry) => [entry.modelId, entry.movementCost])),
    })
    expect(applied.actionHistory).toHaveLength(1)
    expect(applied.actionHistory[0]).toMatchObject({
      type: 'MOVE',
      playerId: 'player-a',
      round: 2,
      turn: 1,
      turnId: 'turn-3',
    })
    expect(applied.actionHistory[0].payload.modelIds.sort()).toEqual(['a', 'b'])
    expect(applied.models.find((entry) => entry.id === 'fixed')?.position).toEqual({ x: 4, y: 2 })
    expect(movementUsedByModelInTurn(applied.actionHistory, 'a', applied.gameContext)).toBeGreaterThan(0)
    expect(hasUnitPerformedAction(applied.actionHistory, 'unit-a', 'MOVE', applied.gameContext)).toBe(true)

    const undone = gameReducer(applied, { type: 'movement/undoLastConfirmed' })
    expect(undone.models).toEqual(state.models)
    expect(undone.actionHistory).toEqual([])
    expect(undone.lastConfirmedMovementUndo).toBeNull()
    expect(hasUnitPerformedAction(undone.actionHistory, 'unit-a', 'MOVE', undone.gameContext)).toBe(false)
  })

  it('rejects stale and no-op candidate applications without affecting history or undo', () => {
    const models = [model('a', 2, 2), model('b', 3, 2)]
    const state = gameState(models, [unit('unit-a', ['a', 'b'])])
    const noOp = gameReducer(state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { a: { x: 2, y: 2 } },
      finalPositions: { a: { x: 2, y: 2 } },
      movementUsed: { a: 0 },
    })
    expect(noOp).toBe(state)
    const stale = gameReducer(state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { a: { x: 99, y: 99 } },
      finalPositions: { a: { x: 4, y: 4 } },
      movementUsed: { a: 3 },
    })
    expect(stale).toBe(state)
  })

  it('rejects candidate application while a manual movement session is active', () => {
    const models = [model('a', 2, 2), model('b', 3, 2)]
    const state = gameState(models, [unit('unit-a', ['a', 'b'])])
    const moving = gameReducer(state, { type: 'movement/sessionStarted', sessionId: 'manual', modelIds: ['a'] })
    const result = gameReducer(moving, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { b: { x: 3, y: 2 } },
      finalPositions: { b: { x: 4, y: 2 } },
      movementUsed: { b: 1 },
    })
    expect(result).toBe(moving)
    expect(result.actionHistory).toEqual([])
  })

  it('accumulates confirmed movement for each model only in the current turn', () => {
    const models = [model('a', 2, 2), model('b', 3, 2)]
    const units = [unit('unit-a', ['a', 'b'])]
    const state = gameState(models, units)
    const first = gameReducer(state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { a: { x: 2, y: 2 } },
      finalPositions: { a: { x: 3, y: 2 } },
      movementUsed: { a: 1.25 },
    })
    const second = gameReducer(first, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { a: { x: 3, y: 2 } },
      finalPositions: { a: { x: 4, y: 2 } },
      movementUsed: { a: 0.75 },
    })
    expect(movementUsedByModelInTurn(second.actionHistory, 'a', second.gameContext)).toBe(2)
    expect(movementUsedByModelInTurn(second.actionHistory, 'b', second.gameContext)).toBe(0)
    expect(movementUsedByModelInTurn(second.actionHistory, 'a', {
      ...second.gameContext,
      turnId: 'another-turn',
    })).toBe(0)
  })

  it('preserves model ownership while using current actor context', () => {
    const enemy = model('enemy', 10, 10, 'unit-b')
    const companion = model('companion', 11, 10, 'unit-b')
    const state = gameState([enemy, companion], [unit('unit-b', ['enemy', 'companion'])])
    const result = solve(state.models, state.units, ['enemy'], { x: 10, y: 11 })
    expect(result.valid).toBe(true)
    const applied = gameReducer(state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { enemy: result.assignments[0].start },
      finalPositions: { enemy: result.assignments[0].destination },
      movementUsed: { enemy: result.assignments[0].movementCost },
    })
    expect(applied.models.find((entry) => entry.id === 'enemy')?.ownerId).toBe('player-b')
    expect(applied.actionHistory[0].playerId).toBe('player-a')
    expect(applied.actionHistory[0].payload.ownerIds).toEqual(['player-b'])
  })
})
