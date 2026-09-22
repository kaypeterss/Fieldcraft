import { describe, expect, it } from 'vitest'
import type { Footprint, TabletopModel } from '../domain/types'
import { footprintDemoGameState } from '../game/initialState'
import { isModelPositionInsideBattlefield } from './geometry/battlefield'
import { poseForModel, sweepFootprintTranslation } from './geometry/footprints'
import { distanceBetween, type Point } from './geometry/point'
import {
  createModelPathPlanner,
  findModelPath,
  isFixedOrientationPathWithinPolicy,
  type ModelPathResult,
} from './pathfinding'

const battlefield = { width: 20, height: 12 }
const inch = 25.4
const demoModel = (id: string) => footprintDemoGameState.models.find((entry) => entry.id === id)!

const circle = (diameter: number): Footprint => ({ shape: 'circle', diameterMm: diameter * inch })
const ellipse = (width: number, height: number): Footprint => ({
  shape: 'ellipse', widthMm: width * inch, heightMm: height * inch,
})
const rectangle = (width: number, height: number): Footprint => ({
  shape: 'rectangle', widthMm: width * inch, heightMm: height * inch,
})
const polygon = (vertices: Point[]): Footprint => ({
  shape: 'polygon',
  verticesMm: vertices.map((point) => ({ x: point.x * inch, y: point.y * inch })),
})

function model(
  id: string,
  footprint: Footprint,
  x: number,
  y: number,
  rotation = 0,
  canPassOverModels = false,
): TabletopModel {
  return {
    id,
    unitId: id,
    ownerId: 'player',
    position: { x, y },
    rotation,
    base: footprint,
    canPassOverModels,
  }
}

function expectLegalPath(
  mover: TabletopModel,
  obstacles: ReadonlyArray<TabletopModel>,
  result: ModelPathResult | null,
): asserts result is ModelPathResult {
  expect(result).not.toBeNull()
  expect(result!.path[0]).toEqual(mover.position)
  for (const point of result!.path) {
    expect(isModelPositionInsideBattlefield(point, mover, battlefield)).toBe(true)
  }
  for (let index = 1; index < result!.path.length; index += 1) {
    const start = result!.path[index - 1]
    const end = result!.path[index]
    for (const obstacle of obstacles) {
      expect(sweepFootprintTranslation(
        mover.base,
        poseForModel(mover, start),
        { x: end.x - start.x, y: end.y - start.y },
        obstacle.base,
        poseForModel(obstacle),
      )).toBeNull()
    }
  }
  const measuredDistance = result!.path.slice(1).reduce(
    (sum, point, index) => sum + distanceBetween(result!.path[index], point),
    0,
  )
  expect(result!.distance).toBeCloseTo(measuredDistance, 9)
}

describe('fixed-orientation generic footprint pathfinding', () => {
  it.each([
    ['ellipse', demoModel('demo-ellipse').base, demoModel('demo-ellipse').rotation],
    ['rectangle', demoModel('demo-rectangle').base, demoModel('demo-rectangle').rotation],
    ['polygon', demoModel('demo-polygon').base, demoModel('demo-polygon').rotation],
  ] as const)('routes a %s around a blocker without changing its orientation', (_name, footprint, rotation) => {
    const mover = model('mover', footprint, 3, 6, rotation)
    const blockers = [model('blocker', rectangle(2, 3), 10, 6, Math.PI / 12)]
    const result = findModelPath({
      model: mover,
      destination: { x: 17, y: 6 },
      obstacles: blockers,
      battlefield,
    })

    expectLegalPath(mover, blockers, result)
    expect(result.path.length).toBeGreaterThan(2)
    expect(result.distance).toBeGreaterThan(14)
    expect(mover.rotation).toBe(rotation)
  })

  it('routes around mixed-shape blockers with deterministic cached results', () => {
    const mover = model('mover', polygon([
      { x: -0.8, y: -0.5 }, { x: 0.9, y: -0.4 }, { x: 0.6, y: 0.7 }, { x: -0.7, y: 0.6 },
    ]), 2, 6, Math.PI / 7)
    const blockers = [
      model('circle', circle(1.5), 7, 5.5),
      model('ellipse', ellipse(2, 1), 10, 6.5, Math.PI / 3),
      model('rectangle', rectangle(1.5, 2.5), 13, 5.5, Math.PI / 9),
    ]
    const request = { model: mover, destination: { x: 18, y: 6 }, obstacles: blockers, battlefield }
    const planner = createModelPathPlanner()
    const first = findModelPath(request, planner)
    const second = findModelPath(request, planner)

    expectLegalPath(mover, blockers, first)
    expect(second).toEqual(first)
    expect(planner.visibilityGraphs.size).toBe(1)
  })

  it('lets a narrow oval cross a sealed gap only at the fitting fixed orientation', () => {
    const blockers = [
      model('wall-top', rectangle(1, 5.35), 10, 2.675),
      model('wall-bottom', rectangle(1, 5.35), 10, 9.325),
    ]
    const horizontal = model('horizontal', ellipse(3, 1), 3, 6, 0)
    const vertical = model('vertical', ellipse(3, 1), 3, 6, Math.PI / 2)

    const fitting = findModelPath({
      model: horizontal, destination: { x: 17, y: 6 }, obstacles: blockers, battlefield,
    })
    expectLegalPath(horizontal, blockers, fitting)
    expect(fitting.path).toHaveLength(2)
    expect(findModelPath({
      model: vertical, destination: { x: 17, y: 6 }, obstacles: blockers, battlefield,
    })).toBeNull()
  })

  it('rejects a destination whose rotated footprint leaves the battlefield', () => {
    const mover = model('mover', rectangle(3, 1), 4, 4, Math.PI / 4)
    expect(findModelPath({
      model: mover,
      destination: { x: 0.5, y: 4 },
      obstacles: [],
      battlefield,
    })).toBeNull()
  })

  it('preserves pass-over crossing while requiring an exact legal destination', () => {
    const mover = model('flyer', ellipse(2, 1), 2, 6, Math.PI / 5, true)
    const blocker = model('blocker', rectangle(2, 3), 10, 6, Math.PI / 9)
    const direct = findModelPath({
      model: mover, destination: { x: 18, y: 6 }, obstacles: [blocker], battlefield,
    })
    expect(direct).toMatchObject({ path: [{ x: 2, y: 6 }, { x: 18, y: 6 }], distance: 16 })
    expect(findModelPath({
      model: mover, destination: blocker.position, obstacles: [blocker], battlefield,
    })).toBeNull()
  })
})

describe('pathfinding parity and movement policies', () => {
  it('keeps deterministic circular routing and direct-path behavior', () => {
    const mover = model('mover', circle(1), 2, 6)
    const blocker = model('blocker', circle(2), 10, 6)
    const routedRequest = {
      model: mover, destination: { x: 18, y: 6 }, obstacles: [blocker], battlefield,
    }
    const routed = findModelPath(routedRequest)
    expectLegalPath(mover, [blocker], routed)
    expect(routed.path.length).toBeGreaterThan(2)
    expect(findModelPath(routedRequest)).toEqual(routed)
    expect(findModelPath({
      model: mover, destination: { x: 2, y: 10 }, obstacles: [blocker], battlefield,
    })).toEqual({ path: [{ x: 2, y: 6 }, { x: 2, y: 10 }], distance: 4 })
  })

  it('applies the existing policy meanings to fixed-orientation paths', () => {
    const mover = model('mover', rectangle(2, 1), 0, 0)
    const result = {
      path: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 1, y: 0 }],
      distance: 5 + Math.sqrt(20),
    }
    expect(isFixedOrientationPathWithinPolicy({
      model: mover, movementPolicy: { type: 'movement-envelope' }, movementAllowance: 5,
    }, result)).toBe(true)
    expect(isFixedOrientationPathWithinPolicy({
      model: mover, movementPolicy: { type: 'free-rotation' }, movementAllowance: 5,
    }, result)).toBe(false)
    expect(isFixedOrientationPathWithinPolicy({
      model: mover,
      movementPolicy: { type: 'fixed-rotation-charge', rotationCharge: 2 },
      movementAllowance: result.distance,
    }, result)).toBe(true)
  })
})
