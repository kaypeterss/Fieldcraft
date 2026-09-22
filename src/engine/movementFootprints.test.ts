import { describe, expect, it } from 'vitest'
import type { Footprint, TabletopModel } from '../domain/types'
import {
  footprintBounds,
  footprintInsideBattlefield,
  footprintsOverlap,
  poseForModel,
} from './geometry/footprints'
import { resolveRigidTranslation } from './movement'

const battlefield = { width: 60, height: 44 }

const circle: Footprint = { shape: 'circle', diameterMm: 50.8 }
const oval: Footprint = { shape: 'ellipse', widthMm: 101.6, heightMm: 50.8 }
const rectangle: Footprint = { shape: 'rectangle', widthMm: 101.6, heightMm: 50.8 }
const polygon: Footprint = {
  shape: 'polygon',
  verticesMm: [
    { x: -50.8, y: -25.4 }, { x: 50.8, y: -25.4 },
    { x: 38.1, y: 38.1 }, { x: -38.1, y: 38.1 },
  ],
}

function model(
  id: string,
  x: number,
  y: number,
  base: Footprint,
  rotation = 0,
  canPassOverModels = false,
): TabletopModel {
  return {
    id,
    unitId: 'unit',
    ownerId: 'player',
    position: { x, y },
    rotation,
    base,
    canPassOverModels,
  }
}

function move(moving: TabletopModel[], blockers: TabletopModel[], translation: { x: number; y: number }) {
  return resolveRigidTranslation({
    allModels: [...moving, ...blockers],
    modelIds: moving.map((entry) => entry.id),
    translation,
    battlefield,
  })
}

function expectLegal(models: TabletopModel[], positions: ReadonlyMap<string, { x: number; y: number }>) {
  const projected = models.map((entry) => ({
    ...entry,
    position: positions.get(entry.id) ?? entry.position,
  }))
  expect(projected.every((entry) => footprintInsideBattlefield(
    entry.base,
    poseForModel(entry),
    battlefield,
  ))).toBe(true)
  for (let first = 0; first < projected.length; first += 1) {
    for (let second = first + 1; second < projected.length; second += 1) {
      expect(footprintsOverlap(
        projected[first].base,
        poseForModel(projected[first]),
        projected[second].base,
        poseForModel(projected[second]),
      )).toBe(false)
    }
  }
}

describe('fixed-orientation non-circular manual movement', () => {
  it('stops circle against oval at continuous contact', () => {
    const moving = model('circle', 5, 10, circle)
    const blocker = model('oval', 15, 10, oval)
    const result = move([moving], [blocker], { x: 20, y: 0 })
    expect(result.positions.get(moving.id)?.x).toBeCloseTo(12, 6)
    expectLegal([moving, blocker], result.positions)
  })

  it('stops oval against a rotated rectangle without circular approximation', () => {
    const moving = model('oval', 5, 10, oval, Math.PI / 2)
    const blocker = model('rectangle', 15, 10, rectangle, Math.PI / 4)
    const result = move([moving], [blocker], { x: 20, y: 0 })
    const accepted = result.positions.get(moving.id)!
    expect(accepted.x).toBeGreaterThan(10)
    expect(accepted.x).toBeLessThan(13)
    expect(accepted.y).toBeGreaterThan(10)
    expect(result.translationPath.length).toBeGreaterThan(2)
    expectLegal([moving, blocker], result.positions)
  })

  it('stops rectangle against polygon and prevents fast-drag tunneling', () => {
    const moving = model('rectangle', 4, 10, rectangle, Math.PI / 6)
    const blocker = model('polygon', 30, 10, polygon, Math.PI / 2)
    const result = move([moving], [blocker], { x: 50, y: 0 })
    const accepted = result.positions.get(moving.id)!
    expect(accepted.x).toBeGreaterThan(20)
    expect(accepted.x).toBeLessThan(30)
    expect(result.distances.get(moving.id)).toBeLessThan(50)
    expectLegal([moving, blocker], result.positions)
  })

  it('uses the footprint contact normal to slide an oval around a circle', () => {
    const moving = model('oval', 5, 8, oval)
    const blocker = model('circle', 12, 10, circle)
    const result = move([moving], [blocker], { x: 14, y: 7 })
    const accepted = result.positions.get(moving.id)!
    expect(accepted.x).toBeGreaterThan(8)
    expect(accepted.y).toBeGreaterThan(14)
    expect(result.translationPath.length).toBeGreaterThan(2)
    expectLegal([moving, blocker], result.positions)
  })

  it('slides a rotated rectangle along the battlefield edge', () => {
    const moving = model('rectangle', 55, 10, rectangle, Math.PI / 4)
    const result = move([moving], [], { x: 10, y: 8 })
    const accepted = result.positions.get(moving.id)!
    const bounds = footprintBounds(moving.base, poseForModel(moving, accepted))
    expect(bounds.right).toBeCloseTo(battlefield.width, 8)
    expect(accepted.y).toBeGreaterThan(10)
    expectLegal([moving], result.positions)
  })

  it('rigid-moves a mixed-footprint group through shared collision constraints', () => {
    const first = model('oval', 5, 8, oval, Math.PI / 6)
    const second = model('rectangle', 5, 14, rectangle, Math.PI / 4)
    const circleBlocker = model('circle-blocker', 16, 8, circle)
    const polygonBlocker = model('polygon-blocker', 16, 14, polygon, Math.PI / 2)
    const result = move([first, second], [circleBlocker, polygonBlocker], { x: 20, y: 3 })
    const firstFinal = result.positions.get(first.id)!
    const secondFinal = result.positions.get(second.id)!
    expect(secondFinal.x - firstFinal.x).toBeCloseTo(second.position.x - first.position.x)
    expect(secondFinal.y - firstFinal.y).toBeCloseTo(second.position.y - first.position.y)
    expect(first.rotation).toBe(Math.PI / 6)
    expect(second.rotation).toBe(Math.PI / 4)
    expectLegal([first, second, circleBlocker, polygonBlocker], result.positions)
  })

  it('allows pass-over crossing but rejects an overlapping destination', () => {
    const flyer = model('flyer', 5, 10, oval, 0, true)
    const blocker = model('blocker', 12, 10, rectangle, Math.PI / 4)
    const crossed = move([flyer], [blocker], { x: 15, y: 0 })
    expect(crossed.positions.get(flyer.id)).toEqual({ x: 20, y: 10 })

    const illegalDestination = move([flyer], [blocker], { x: 7, y: 0 })
    expect(illegalDestination.positions.get(flyer.id)?.x).toBeLessThan(12)
    expectLegal([flyer, blocker], illegalDestination.positions)
  })
})
