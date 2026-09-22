import { describe, expect, it } from 'vitest'
import type { Footprint, TabletopModel, Unit } from '../domain/types'
import { footprintDemoGameState } from '../game/initialState'
import { projectCandidateModels } from './candidateFormation'
import { distanceBetweenBases } from './spatial'
import { solveSmartMove } from './smartMove'

const inch = 25.4
const battlefield = { width: 20, height: 12 }
const circle: Footprint = { shape: 'circle', diameterMm: inch }
const rectangle = (width: number, height: number): Footprint => ({
  shape: 'rectangle', widthMm: width * inch, heightMm: height * inch,
})
const demoFootprint = (id: string) => structuredClone(
  footprintDemoGameState.models.find((model) => model.id === id)!.base,
)

function model(
  id: string,
  base: Footprint,
  x: number,
  y: number,
  rotation = 0,
  unitId = 'unit',
): TabletopModel {
  return {
    id,
    unitId,
    ownerId: unitId === 'unit' ? 'player-a' : 'player-b',
    position: { x, y },
    rotation,
    base,
    canPassOverModels: false,
  }
}

function unit(models: ReadonlyArray<TabletopModel>): Unit {
  return {
    id: 'unit', ownerId: 'player-a', definitionId: 'definition',
    modelIds: models.filter((entry) => entry.unitId === 'unit').map((entry) => entry.id),
  }
}

function solve(
  models: TabletopModel[],
  selectedModelIds: string[],
  target: { x: number; y: number },
  movement: number | Readonly<Record<string, number>> = 20,
  coherencyPolicy = { distance: 2, requiredNeighbors: 0, requireConnected: true },
) {
  return solveSmartMove({
    allModels: models,
    units: [unit(models)],
    battlefield,
    selectedModelIds,
    target,
    movementRemaining: typeof movement === 'number'
      ? Object.fromEntries(selectedModelIds.map((id) => [id, movement]))
      : movement,
    coherencyPolicy,
  })
}

describe('Smart Move with fixed-orientation generic footprints', () => {
  it.each([
    ['oval', 'demo-ellipse', Math.PI / 6],
    ['rectangle', 'demo-rectangle', Math.PI / 4],
    ['polygon', 'demo-polygon', Math.PI / 2],
  ] as const)('moves one %s without changing its orientation', (_name, footprintId, rotation) => {
    const mover = model('mover', demoFootprint(footprintId), 3, 6, rotation)
    const result = solve([mover], [mover.id], { x: 12, y: 6 }, 6)

    expect(result.valid).toBe(true)
    expect(result.positions[mover.id].x).toBeGreaterThan(mover.position.x)
    const projected = projectCandidateModels([mover], result.positions)[0]
    expect(projected.rotation).toBe(rotation)
    expect(mover.rotation).toBe(rotation)
  })

  it('moves a mixed circle/oval/rectangle/hull unit with each footprint intact', () => {
    const models = [
      model('circle', circle, 2, 3),
      model('oval', demoFootprint('demo-ellipse'), 6, 3, Math.PI / 6),
      model('rectangle', demoFootprint('demo-rectangle'), 10, 3, Math.PI / 4),
      model('polygon', demoFootprint('demo-polygon'), 14, 3, Math.PI / 2),
    ]
    const rotations = Object.fromEntries(models.map((entry) => [entry.id, entry.rotation]))
    const result = solve(models, models.map((entry) => entry.id), { x: 18, y: 8 }, 3, {
      distance: 3, requiredNeighbors: 1, requireConnected: true,
    })

    expect(result.valid).toBe(true)
    expect(result.assignments).toHaveLength(4)
    const projected = projectCandidateModels(models, result.positions)
    expect(Object.fromEntries(projected.map((entry) => [entry.id, entry.rotation]))).toEqual(rotations)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('uses generic pathfinding to route an oval around a rectangular blocker', () => {
    const mover = model('mover', demoFootprint('demo-ellipse'), 3, 6, Math.PI / 6)
    const blocker = model('blocker', rectangle(2, 3), 10, 6, Math.PI / 12, 'enemy')
    const result = solve([mover, blocker], [mover.id], { x: 17, y: 6 }, 18)

    expect(result.valid).toBe(true)
    expect(result.assignments[0].path.length).toBeGreaterThan(2)
    expect(result.assignments[0].destination.x).toBeGreaterThan(10)
    expect(mover.rotation).toBe(Math.PI / 6)
  })

  it('keeps the human-like fallback for a mixed unit with a blocker', () => {
    const selected = [
      model('circle', circle, 3, 4),
      model('oval', demoFootprint('demo-ellipse'), 6, 4, Math.PI / 6),
      model('rectangle', demoFootprint('demo-rectangle'), 3, 7.5, Math.PI / 4),
      model('polygon', demoFootprint('demo-polygon'), 6, 7.5, Math.PI / 2),
    ]
    const blocker = model('blocker', rectangle(2, 4), 10, 6, Math.PI / 12, 'enemy')
    const result = solve(
      [...selected, blocker],
      selected.map((entry) => entry.id),
      { x: 17, y: 6 },
      { circle: 6, oval: 5.5, rectangle: 5, polygon: 4.5 },
      { distance: 3, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.valid).toBe(true)
    expect(result.diagnostics?.fallbackUsed).toBe(true)
    expect(result.assignments.some((assignment) => assignment.path.length > 2)).toBe(true)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('does not send a fixed-orientation oval through a sealed gap it cannot fit', () => {
    const mover = model('mover', demoFootprint('demo-ellipse'), 3, 6, Math.PI / 2)
    const blockers = [
      model('wall-top', rectangle(1, 5.35), 10, 2.675, 0, 'enemy'),
      model('wall-bottom', rectangle(1, 5.35), 10, 9.325, 0, 'enemy'),
    ]
    const result = solve([mover, ...blockers], [mover.id], { x: 17, y: 6 }, 18)

    expect(result.valid).toBe(true)
    expect(result.assignments[0].destination.x).toBeLessThan(10)
    expect(mover.rotation).toBe(Math.PI / 2)
  })

  it('maintains mixed-footprint coherency with a fixed same-unit anchor', () => {
    const fixedOval = model('fixed', demoFootprint('demo-ellipse'), 4, 6, Math.PI / 6)
    const movingHull = model('moving', demoFootprint('demo-polygon'), 7, 6, Math.PI / 2)
    const models = [fixedOval, movingHull]
    const result = solve(models, [movingHull.id], { x: 15, y: 6 }, 6, {
      distance: 2, requiredNeighbors: 1, requireConnected: true,
    })

    expect(result.valid).toBe(true)
    const projected = projectCandidateModels(models, result.positions,
      Object.fromEntries(result.assignments.flatMap((assignment) => assignment.finalRotation === undefined
        ? [] : [[assignment.modelId, assignment.finalRotation]])))
    expect(distanceBetweenBases(projected[0], projected[1])).toBeLessThanOrEqual(2 + 1e-9)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('preserves established circle direct-move behavior', () => {
    const mover = model('mover', circle, 2, 6)
    const result = solve([mover], [mover.id], { x: 12, y: 6 }, 6)
    expect(result.valid).toBe(true)
    expect(result.assignments[0]).toMatchObject({
      destination: { x: 8, y: 6 },
      path: [{ x: 2, y: 6 }, { x: 8, y: 6 }],
      movementCost: 6,
    })
  })
})
