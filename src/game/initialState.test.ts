import { describe, expect, it } from 'vitest'
import { evaluateUnitCoherency, isCoherencyResultValid } from '../engine/coherency'
import { isModelPositionInsideBattlefield } from '../engine/geometry/battlefield'
import { footprintsOverlap, poseForModel } from '../engine/geometry/footprints'
import { footprintDemoGameState, initialGameState, orientationGapGameState } from './initialState'
import { getUnitCoherencyPolicy, getUnitDefinition } from './selectors'
import { gameReducer } from '../state/reducer'
import { solveSmartMove } from '../engine/smartMove'
import { hasUnitPerformedAction, movementUsedByModelInTurn } from './actionQueries'

describe('prototype Smart Move units', () => {
  it('keeps the orientation-aware QA playground inside the table, non-overlapping, and coherent', () => {
    const state = orientationGapGameState
    expect(state.battlefield).toEqual({ width: 80, height: 60 })
    for (const model of state.models) {
      expect(Number.isFinite(model.position.x) && Number.isFinite(model.position.y), model.id).toBe(true)
      expect(isModelPositionInsideBattlefield(model.position, model, state.battlefield), model.id).toBe(true)
    }
    for (let first = 0; first < state.models.length; first += 1) {
      for (let second = first + 1; second < state.models.length; second += 1) {
        expect(footprintsOverlap(
          state.models[first].base, poseForModel(state.models[first]),
          state.models[second].base, poseForModel(state.models[second]),
        ),
          `${state.models[first].id} overlaps ${state.models[second].id}`).toBe(false)
      }
    }
    for (const unit of state.units) {
      const policy = getUnitCoherencyPolicy(state, unit)!
      const result = evaluateUnitCoherency(unit, state.models, policy)
      expect(isCoherencyResultValid(result, policy), unit.id).toBe(true)
    }
    for (const [unitId, expectedCount] of [
      ['qa-cavalry', 6], ['qa-large-ovals', 3], ['qa-rectangles', 5],
      ['qa-hulls', 4], ['qa-circles', 10],
    ] as const) {
      expect(state.units.find((unit) => unit.id === unitId)?.modelIds).toHaveLength(expectedCount)
    }
  })

  it('keeps the four-shape geometry board isolated from the realistic gameplay roster', () => {
    expect(footprintDemoGameState.models.map((model) => model.base.shape)).toEqual([
      'circle', 'ellipse', 'rectangle', 'polygon',
    ])
    expect(footprintDemoGameState.models.map((model) => model.rotation)).toEqual([
      0, Math.PI / 6, Math.PI / 4, Math.PI / 2,
    ])
    const started = gameReducer(footprintDemoGameState, {
      type: 'movement/sessionStarted', sessionId: 'mixed-shape-demo',
      modelIds: footprintDemoGameState.models.map((model) => model.id),
    })
    expect(started.movementSession?.modelIds).toEqual(footprintDemoGameState.models.map((model) => model.id))
    const demoUnit = footprintDemoGameState.units[0]
    const demoPolicy = getUnitCoherencyPolicy(footprintDemoGameState, demoUnit)!
    const demoCoherency = evaluateUnitCoherency(
      demoUnit,
      footprintDemoGameState.models,
      demoPolicy,
    )
    expect(demoCoherency.models).toHaveLength(4)
    expect(demoCoherency.links.length).toBeGreaterThan(0)
    expect(demoCoherency.connected).toBe(true)
    expect(initialGameState.models.some((model) => model.base.shape === 'ellipse')).toBe(true)
    expect(initialGameState.models.some((model) => model.base.shape === 'polygon')).toBe(true)
  })
  it('defines the realistic test roster with requested physical profiles and policies', () => {
    const expected = [
      { id: 'unit-a', name: 'Standard Infantry', ownerId: 'player-1', count: 10, footprint: { shape: 'circle', diameterMm: 32 }, movement: 6, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-horde', name: 'Horde', ownerId: 'player-2', count: 20, footprint: { shape: 'circle', diameterMm: 25 }, movement: 6, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-cavalry', name: 'Oval Cavalry', ownerId: 'player-1', count: 6, footprint: { shape: 'ellipse', widthMm: 75, heightMm: 42 }, movement: 10, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-b', name: 'Elite Large-Base Unit', ownerId: 'player-2', count: 5, footprint: { shape: 'circle', diameterMm: 50 }, movement: 6, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-c', name: 'Heavy Oval Unit', ownerId: 'player-2', count: 3, footprint: { shape: 'ellipse', widthMm: 90, heightMm: 52 }, movement: 8, distance: 2, requiredNeighbors: 1 },
      { id: 'unit-vehicles', name: 'Vehicle / Hull Unit', ownerId: 'player-2', count: 3, footprint: { shape: 'polygon' }, movement: 10, distance: 1, requiredNeighbors: 1 },
      { id: 'unit-strong', name: 'Strong Coherency Unit', ownerId: 'player-1', count: 10, footprint: { shape: 'circle', diameterMm: 40 }, movement: 5, distance: 1, requiredNeighbors: 2 },
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
      expect(models.every((model) => JSON.stringify(model.base) === JSON.stringify(models[0].base))).toBe(true)
      expect(models[0].base).toMatchObject(expectedUnit.footprint)
      expect(models.every((model) => model.rotation === models[0].rotation)).toBe(true)
    })

    const cloned = structuredClone(initialGameState)
    cloned.unitDefinitions[0].coherencyPolicy!.distance = 9
    expect(cloned.unitDefinitions[1].coherencyPolicy?.distance).toBe(1)
    expect(cloned.unitDefinitions.find((definition) => definition.id === 'def-heavy-oval')?.coherencyPolicy?.distance).toBe(2)
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

  it('smoke-tests Oval Cavalry Smart Move against a hull blocker', () => {
    const unit = initialGameState.units.find((candidate) => candidate.id === 'unit-cavalry')!
    const models = initialGameState.models.filter((candidate) => candidate.unitId === unit.id)
    const blocker = structuredClone(initialGameState.models.find((candidate) => candidate.unitId === 'unit-vehicles')!)
    blocker.id = 'cavalry-smoke-blocker'
    blocker.position = { x: 27, y: 6.05 }
    const target = { x: 30.35, y: 6.05 }
    const policy = getUnitCoherencyPolicy(initialGameState, unit)!
    const result = solveSmartMove({
      allModels: [...models, blocker],
      units: [unit],
      battlefield: initialGameState.battlefield,
      selectedModelIds: unit.modelIds,
      target,
      movementRemaining: Object.fromEntries(unit.modelIds.map((id) => [id, 10])),
      coherencyPolicy: policy,
    })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(result.assignments.some((assignment) => assignment.movementCost > 0)).toBe(true)
    for (const model of models) {
      const position = result.positions[model.id] ?? model.position
      expect(footprintsOverlap(model.base, poseForModel(model, position), blocker.base, poseForModel(blocker))).toBe(false)
    }
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
        expect(footprintsOverlap(a.base, poseForModel(a), b.base, poseForModel(b)), `${a.id} overlaps ${b.id}`).toBe(false)
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
      target: { x: 14, y: 7 },
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
