import { describe, expect, it } from 'vitest'
import { evaluateUnitCoherency, isCoherencyResultValid } from '../engine/coherency'
import { isModelPositionInsideBattlefield } from '../engine/geometry/battlefield'
import { circlesOverlap } from '../engine/geometry/circles'
import { baseRadiusInches } from '../engine/spatial'
import { initialGameState } from './initialState'
import { getUnitCoherencyPolicy, getUnitDefinition } from './selectors'
import { gameReducer } from '../state/reducer'
import { solveSmartMove } from '../engine/smartMove'
import { hasUnitPerformedAction, movementUsedByModelInTurn } from './actionQueries'

describe('prototype Smart Move units', () => {
  it('defines the expanded roster with physical profiles and varied policies', () => {
    const expected = [
      { id: 'unit-a', name: 'Line 10', ownerId: 'player-1', count: 10, diameters: [25], movement: 6, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-b', name: 'Medium 10', ownerId: 'player-2', count: 10, diameters: [32], movement: 6, distance: 1, requiredNeighbors: 2 },
      { id: 'unit-c', name: 'Heavy 10', ownerId: 'player-2', count: 10, diameters: [50], movement: 6, distance: 2, requiredNeighbors: 2 },
      { id: 'unit-skirmish', name: 'Skirmish 5', ownerId: 'player-1', count: 5, diameters: [25], movement: 6, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-horde', name: 'Horde 20', ownerId: 'player-1', count: 20, diameters: [25], movement: 6, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-cohort', name: 'Cohort 20', ownerId: 'player-2', count: 20, diameters: [32], movement: 5, distance: 1, requiredNeighbors: 2 },
      { id: 'unit-fast', name: 'Fast 6', ownerId: 'player-1', count: 6, diameters: [40], movement: 10, distance: 1.5, requiredNeighbors: 1 },
      { id: 'unit-giants', name: 'Giants 3', ownerId: 'player-2', count: 3, diameters: [80], movement: 8, distance: 2, requiredNeighbors: 1 },
      { id: 'unit-mixed', name: 'Mixed 8', ownerId: 'player-1', count: 8, diameters: [32, 40, 50], movement: 6, distance: 1.5, requiredNeighbors: 1 },
    ]
    expect(initialGameState.units).toHaveLength(expected.length)
    initialGameState.units.forEach((unit, index) => {
      const expectedUnit = expected[index]
      const definition = getUnitDefinition(initialGameState, unit)
      const models = initialGameState.models.filter((model) => model.unitId === unit.id)
      expect(unit.id).toBe(expectedUnit.id)
      expect(definition?.name).toBe(expectedUnit.name)
      expect(unit.ownerId).toBe(expectedUnit.ownerId)
      expect(models.every((model) => model.ownerId === unit.ownerId)).toBe(true)
      expect(definition?.movementAllowance).toBe(expectedUnit.movement)
      expect(definition?.coherencyPolicy).toMatchObject({
        distance: expectedUnit.distance,
        requiredNeighbors: expectedUnit.requiredNeighbors,
        requireConnected: true,
      })
      expect(models).toHaveLength(expectedUnit.count)
      expect([...new Set(models.map((model) => model.base.diameterMm))].sort((a, b) => a - b)).toEqual(expectedUnit.diameters)
    })

    const cloned = structuredClone(initialGameState)
    cloned.unitDefinitions[0].coherencyPolicy!.distance = 9
    expect(cloned.unitDefinitions[1].coherencyPolicy?.distance).toBe(1)
    expect(cloned.unitDefinitions.find((definition) => definition.id === 'def-heavy')?.coherencyPolicy?.distance).toBe(2)
  })

  it('starts every unit coherent according to its real policy', () => {
    for (const unit of initialGameState.units) {
      const policy = getUnitCoherencyPolicy(initialGameState, unit)
      expect(policy).toBeDefined()
      const result = evaluateUnitCoherency(unit, initialGameState.models, policy!)
      expect(isCoherencyResultValid(result, policy!), `${unit.id}: ${JSON.stringify(result)}`).toBe(true)
      expect(result.models.every((model) => model.neighborCount >= policy!.requiredNeighbors)).toBe(true)
    }
  })

  it.each(initialGameState.units)('solves a real open-space full-unit move for $id', (unit) => {
    const policy = getUnitCoherencyPolicy(initialGameState, unit)!
    const models = initialGameState.models.filter((model) => unit.modelIds.includes(model.id))
    const centroid = {
      x: models.reduce((total, model) => total + model.position.x, 0) / models.length,
      y: models.reduce((total, model) => total + model.position.y, 0) / models.length,
    }
    const result = solveSmartMove({
      allModels: models,
      units: [unit],
      battlefield: initialGameState.battlefield,
      selectedModelIds: unit.modelIds,
      target: { x: centroid.x + 4, y: centroid.y },
      movementRemaining: Object.fromEntries(unit.modelIds.map((id) => [id, getUnitDefinition(initialGameState, unit)?.movementAllowance ?? 6])),
      coherencyPolicy: policy,
    })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    const projected = initialGameState.models.map((model) => result.positions[model.id]
      ? { ...model, position: result.positions[model.id] }
      : model)
    const coherency = evaluateUnitCoherency(unit, projected, policy)
    expect(isCoherencyResultValid(coherency, policy)).toBe(true)
    expect(result.assignments.every((assignment) => (
      assignment.movementCost <= assignment.movementRemaining + 1e-9
    ))).toBe(true)
  })

  it('starts inside the battlefield without any overlapping bases', () => {
    expect(initialGameState.models.every((model) => isModelPositionInsideBattlefield(
      model.position,
      model,
      initialGameState.battlefield,
    ))).toBe(true)
    for (let source = 0; source < initialGameState.models.length; source += 1) {
      for (let target = source + 1; target < initialGameState.models.length; target += 1) {
        const a = initialGameState.models[source]
        const b = initialGameState.models[target]
        expect(circlesOverlap(
          a.position,
          baseRadiusInches(a.base),
          b.position,
          baseRadiusInches(b.base),
        ), `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
  })

  it('reports manual incoherency without blocking movement, and cancel or undo restores validity', () => {
    const unit = initialGameState.units[0]
    const policy = getUnitCoherencyPolicy(initialGameState, unit)!
    const modelId = unit.modelIds[0]
    const start = initialGameState.models.find((model) => model.id === modelId)!.position

    const started = gameReducer(initialGameState, {
      type: 'movement/sessionStarted',
      sessionId: 'manual-incoherency',
      modelIds: [modelId],
    })
    const moved = gameReducer(started, {
      type: 'movement/requested',
      positions: { [modelId]: { x: start.x - 3, y: start.y } },
    })
    expect(moved.models.find((model) => model.id === modelId)?.position.x).toBe(start.x - 3)
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, moved.models, policy), policy)).toBe(false)

    const cancelled = gameReducer(moved, { type: 'movement/cancelled' })
    expect(cancelled.models.find((model) => model.id === modelId)?.position).toEqual(start)
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, cancelled.models, policy), policy)).toBe(true)

    const confirmed = gameReducer(moved, { type: 'movement/confirmed' })
    expect(confirmed.actionHistory).toHaveLength(1)
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, confirmed.models, policy), policy)).toBe(false)
    const undone = gameReducer(confirmed, { type: 'movement/undoLastConfirmed' })
    expect(undone.models.find((model) => model.id === modelId)?.position).toEqual(start)
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, undone.models, policy), policy)).toBe(true)
  })

  it('keeps a manually moved model fixed while Smart Move advances the untouched models from current positions', () => {
    const unit = initialGameState.units[0]
    const fixedId = 'mdl-a-005'
    const start = initialGameState.models.find((model) => model.id === fixedId)!.position
    const started = gameReducer(initialGameState, {
      type: 'movement/sessionStarted',
      sessionId: 'manual-before-smart',
      modelIds: [fixedId],
    })
    const requested = gameReducer(started, {
      type: 'movement/requested',
      positions: { [fixedId]: { x: start.x + 0.5, y: start.y } },
    })
    const moved = gameReducer(requested, { type: 'movement/confirmed' })
    const fixedPosition = moved.models.find((model) => model.id === fixedId)!.position
    const selectedIds = unit.modelIds.filter((id) => id !== fixedId)
    const policy = getUnitCoherencyPolicy(moved, unit)!
    const result = solveSmartMove({
      allModels: moved.models,
      units: moved.units,
      battlefield: moved.battlefield,
      selectedModelIds: selectedIds,
      target: { x: 22, y: 8 },
      movementRemaining: Object.fromEntries(selectedIds.map((id) => [id, 6])),
      coherencyPolicy: policy,
    })
    expect(hasUnitPerformedAction(moved.actionHistory, unit.id, 'MOVE', moved.gameContext)).toBe(true)
    expect(movementUsedByModelInTurn(moved.actionHistory, fixedId, moved.gameContext)).toBeCloseTo(0.5)
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.positions[fixedId]).toBeUndefined()
    expect(moved.models.find((model) => model.id === fixedId)!.position).toEqual(fixedPosition)
    expect(result.assignments.some((assignment) => assignment.movementCost > 0)).toBe(true)
    const projected = moved.models.map((model) => result.positions[model.id]
      ? { ...model, position: result.positions[model.id] }
      : model)
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, projected, policy), policy)).toBe(true)
  })

  it('permits another full movement operation for the same model in the same turn', () => {
    const modelId = 'mdl-a-001'
    const start = initialGameState.models.find((model) => model.id === modelId)!.position
    const firstStarted = gameReducer(initialGameState, {
      type: 'movement/sessionStarted', sessionId: 'first-leg', modelIds: [modelId],
    })
    const firstRequested = gameReducer(firstStarted, {
      type: 'movement/requested', positions: { [modelId]: { x: start.x - 2, y: start.y } },
    })
    const first = gameReducer(firstRequested, { type: 'movement/confirmed' })
    const afterFirst = first.models.find((model) => model.id === modelId)!.position
    const secondStarted = gameReducer(first, {
      type: 'movement/sessionStarted', sessionId: 'second-leg', modelIds: [modelId],
    })
    const secondRequested = gameReducer(secondStarted, {
      type: 'movement/requested', positions: { [modelId]: { x: afterFirst.x - 2, y: afterFirst.y } },
    })
    const second = gameReducer(secondRequested, { type: 'movement/confirmed' })
    expect(second.models.find((model) => model.id === modelId)!.position.x).toBeCloseTo(start.x - 4)
    expect(second.actionHistory[0].payload.movementUsed[modelId]).toBeCloseTo(2)
    expect(second.actionHistory[1].payload.movementUsed[modelId]).toBeCloseTo(2)
    expect(movementUsedByModelInTurn(second.actionHistory, modelId, second.gameContext)).toBeCloseTo(4)
    expect(second.actionHistory).toHaveLength(2)
  })

  it('allows the same previously moved model to start a fresh Smart Move allowance', () => {
    const unit = initialGameState.units[0]
    const modelId = 'mdl-a-005'
    const start = initialGameState.models.find((model) => model.id === modelId)!.position
    const started = gameReducer(initialGameState, {
      type: 'movement/sessionStarted', sessionId: 'prior-manual', modelIds: [modelId],
    })
    const requested = gameReducer(started, {
      type: 'movement/requested', positions: { [modelId]: { x: start.x + 0.5, y: start.y } },
    })
    const moved = gameReducer(requested, { type: 'movement/confirmed' })
    const result = solveSmartMove({
      allModels: moved.models,
      units: moved.units,
      battlefield: moved.battlefield,
      selectedModelIds: [modelId],
      target: { x: 24, y: 7 },
      movementRemaining: { [modelId]: 6 },
      coherencyPolicy: getUnitCoherencyPolicy(moved, unit)!,
    })
    expect(hasUnitPerformedAction(moved.actionHistory, unit.id, 'MOVE', moved.gameContext)).toBe(true)
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.assignments[0].movementRemaining).toBe(6)
    expect(result.assignments[0].movementCost).toBeGreaterThan(0)
  })

  it('allows manual movement to create a disconnected locally valid unit', () => {
    const unit = initialGameState.units[0]
    const policy = getUnitCoherencyPolicy(initialGameState, unit)!
    const movedIds = ['mdl-a-001', 'mdl-a-002', 'mdl-a-006', 'mdl-a-007']
    const started = gameReducer(initialGameState, {
      type: 'movement/sessionStarted', sessionId: 'disconnect-four', modelIds: movedIds,
    })
    const requested = gameReducer(started, {
      type: 'movement/requested',
      positions: Object.fromEntries(movedIds.map((id) => {
        const position = started.models.find((model) => model.id === id)!.position
        return [id, { x: position.x - 4, y: position.y }]
      })),
    })
    const confirmed = gameReducer(requested, { type: 'movement/confirmed' })
    const coherency = evaluateUnitCoherency(unit, confirmed.models, policy)
    expect(confirmed.actionHistory).toHaveLength(1)
    expect(coherency.neighborRequirementsSatisfied).toBe(true)
    expect(coherency.connected).toBe(false)
    expect(coherency.componentCount).toBe(2)
    expect(coherency.coherent).toBe(false)
  })

  it('solves from several independently confirmed current positions without moving those fixed models', () => {
    const unit = initialGameState.units[0]
    const policy = getUnitCoherencyPolicy(initialGameState, unit)!
    const manualMoves = [
      { id: 'mdl-a-005', dx: 0.4 },
      { id: 'mdl-a-010', dx: 0.4 },
      { id: 'mdl-a-004', dx: 0.2 },
    ]
    let current = structuredClone(initialGameState)
    for (const move of manualMoves) {
      const position = current.models.find((model) => model.id === move.id)!.position
      const started = gameReducer(current, {
        type: 'movement/sessionStarted', sessionId: `manual-${move.id}`, modelIds: [move.id],
      })
      const requested = gameReducer(started, {
        type: 'movement/requested',
        positions: { [move.id]: { x: position.x + move.dx, y: position.y } },
      })
      current = gameReducer(requested, { type: 'movement/confirmed' })
    }
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, current.models, policy), policy)).toBe(true)
    const fixedPositions = Object.fromEntries(manualMoves.map(({ id }) => [
      id,
      current.models.find((model) => model.id === id)!.position,
    ]))
    const selectedIds = unit.modelIds.filter((id) => !(id in fixedPositions))
    const result = solveSmartMove({
      allModels: current.models.filter((model) => model.unitId === unit.id),
      units: [unit],
      battlefield: current.battlefield,
      selectedModelIds: selectedIds,
      target: { x: 22, y: 8 },
      movementRemaining: Object.fromEntries(selectedIds.map((id) => [id, 6])),
      coherencyPolicy: policy,
    })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.assignments.some((assignment) => assignment.movementCost > 0)).toBe(true)
    for (const { id } of manualMoves) {
      expect(result.positions[id]).toBeUndefined()
      expect(current.models.find((model) => model.id === id)!.position).toEqual(fixedPositions[id])
    }
    const projected = current.models.map((model) => result.positions[model.id]
      ? { ...model, position: result.positions[model.id] }
      : model)
    expect(isCoherencyResultValid(evaluateUnitCoherency(unit, projected, policy), policy)).toBe(true)
  })
})
