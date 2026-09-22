import { describe, expect, it } from 'vitest'
import type { TabletopModel, Unit } from '../domain/types'
import { distanceBetween } from '../engine/geometry/point'
import { measureBetweenTargets, type MeasurementTarget } from './measurement'

function model(
  id: string,
  x: number,
  y: number,
  diameterMm = 25.4,
  unitId = `unit-${id}`,
): TabletopModel {
  return {
    id,
    unitId,
    ownerId: 'player-a',
    position: { x, y },
    rotation: 0,
    base: { shape: 'circle', diameterMm },
    canPassOverModels: false,
  }
}

function unit(id: string, modelIds: string[]): Unit {
  return { id, modelIds, ownerId: 'player-a', definitionId: `definition-${id}` }
}

function targetModel(modelId: string): MeasurementTarget {
  return { type: 'model', modelId }
}

function targetUnit(unitId: string): MeasurementTarget {
  return { type: 'unit', unitId }
}

function targetPoint(x: number, y: number): MeasurementTarget {
  return { type: 'point', point: { x, y } }
}

describe('generic measurement targets', () => {
  it('measures point to point in target order', () => {
    const result = measureBetweenTargets(
      { models: [], units: [] },
      targetPoint(1, 2),
      targetPoint(4, 6),
    )
    expect(result).toMatchObject({
      distanceInches: 5,
      startAnchor: { x: 1, y: 2 },
      endAnchor: { x: 4, y: 6 },
    })
  })

  it('measures between equal circular bases using edge anchors', () => {
    const a = model('a', 0, 0)
    const b = model('b', 5, 0)
    const result = measureBetweenTargets({ models: [a, b], units: [] }, targetModel('a'), targetModel('b'))
    expect(result).toMatchObject({
      distanceInches: 4,
      startAnchor: { x: 0.5, y: 0 },
      endAnchor: { x: 4.5, y: 0 },
      sourceModelId: 'a',
      targetModelId: 'b',
    })
    expect(distanceBetween(result!.startAnchor, result!.endAnchor)).toBe(result!.distanceInches)
  })

  it('uses each model actual radius for unequal circular bases', () => {
    const a = model('a', 0, 0, 25.4)
    const b = model('b', 5, 0, 50.8)
    const result = measureBetweenTargets({ models: [a, b], units: [] }, targetModel('a'), targetModel('b'))
    expect(result?.distanceInches).toBe(3.5)
    expect(result?.startAnchor).toEqual({ x: 0.5, y: 0 })
    expect(result?.endAnchor).toEqual({ x: 4, y: 0 })
  })

  it('measures between rotated non-circular footprint edges', () => {
    const ellipse: TabletopModel = {
      ...model('ellipse', 0, 0),
      rotation: Math.PI / 2,
      base: { shape: 'ellipse', widthMm: 50.8, heightMm: 25.4 },
    }
    const rectangle: TabletopModel = {
      ...model('rectangle', 5, 0),
      base: { shape: 'rectangle', widthMm: 50.8, heightMm: 25.4 },
    }
    const result = measureBetweenTargets(
      { models: [ellipse, rectangle], units: [] },
      targetModel(ellipse.id),
      targetModel(rectangle.id),
    )
    expect(result?.distanceInches).toBeCloseTo(3.5)
    expect(result?.startAnchor.x).toBeCloseTo(0.5)
    expect(result?.startAnchor.y).toBeCloseTo(0)
    expect(result?.endAnchor.x).toBeCloseTo(4)
    expect(result?.endAnchor.y).toBeCloseTo(0)
  })

  it('uses rotated footprint anchors across model, unit, and point targets', () => {
    const oval: TabletopModel = {
      ...model('oval', 0, 0, 25.4, 'unit-a'),
      rotation: Math.PI / 2,
      base: { shape: 'ellipse', widthMm: 50.8, heightMm: 25.4 },
    }
    const rectangle: TabletopModel = {
      ...model('rectangle', 4, 0, 25.4, 'unit-b'),
      base: { shape: 'rectangle', widthMm: 50.8, heightMm: 25.4 },
    }
    const hull: TabletopModel = {
      ...model('hull', 10, 0, 25.4, 'unit-b'),
      rotation: Math.PI / 2,
      base: {
        shape: 'polygon',
        verticesMm: [{ x: -25.4, y: -12.7 }, { x: 25.4, y: -12.7 }, { x: 0, y: 25.4 }],
      },
    }
    const state = {
      models: [oval, rectangle, hull],
      units: [unit('unit-a', ['oval']), unit('unit-b', ['rectangle', 'hull'])],
    }

    const modelToUnit = measureBetweenTargets(state, targetModel('oval'), targetUnit('unit-b'))
    expect(modelToUnit).toMatchObject({ sourceModelId: 'oval', targetModelId: 'rectangle' })
    expect(modelToUnit?.distanceInches).toBeCloseTo(2.5)
    expect(distanceBetween(modelToUnit!.startAnchor, modelToUnit!.endAnchor)).toBeCloseTo(modelToUnit!.distanceInches)

    const unitToPoint = measureBetweenTargets(state, targetUnit('unit-b'), targetPoint(12, 0))
    expect(unitToPoint?.sourceModelId).toBe('hull')
    expect(distanceBetween(unitToPoint!.startAnchor, unitToPoint!.endAnchor)).toBeCloseTo(unitToPoint!.distanceInches)
    expect(unitToPoint!.startAnchor).not.toEqual(hull.position)

    const unitToUnit = measureBetweenTargets(state, targetUnit('unit-a'), targetUnit('unit-b'))
    expect(unitToUnit?.startAnchor).toEqual(modelToUnit?.startAnchor)
    expect(unitToUnit?.endAnchor).toEqual(modelToUnit?.endAnchor)
  })

  it('returns coincident anchors for touching, overlapping, and concentric bases', () => {
    const cases = [
      [model('a', 0, 0), model('b', 1, 0)],
      [model('a', 0, 0, 50.8), model('b', 1, 0, 50.8)],
      [model('a', 0, 0), model('b', 0, 0)],
    ] as const
    for (const [a, b] of cases) {
      const result = measureBetweenTargets({ models: [a, b], units: [] }, targetModel('a'), targetModel('b'))
      expect(result?.distanceInches).toBe(0)
      expect(result?.startAnchor).toEqual(result?.endAnchor)
      expect(Number.isFinite(result!.startAnchor.x)).toBe(true)
      expect(Number.isFinite(result!.startAnchor.y)).toBe(true)
    }
  })

  it('measures model-to-point and point-to-model with reversed anchors', () => {
    const a = model('a', 0, 0)
    const state = { models: [a], units: [] }
    const forward = measureBetweenTargets(state, targetModel('a'), targetPoint(3, 0))
    const reverse = measureBetweenTargets(state, targetPoint(3, 0), targetModel('a'))
    expect(forward).toMatchObject({
      distanceInches: 2.5,
      startAnchor: { x: 0.5, y: 0 },
      endAnchor: { x: 3, y: 0 },
      sourceModelId: 'a',
    })
    expect(reverse).toMatchObject({
      distanceInches: 2.5,
      startAnchor: { x: 3, y: 0 },
      endAnchor: { x: 0.5, y: 0 },
      targetModelId: 'a',
    })
  })

  it('returns zero at the point when a point lies inside a base', () => {
    const a = model('a', 2, 2, 50.8)
    const result = measureBetweenTargets(
      { models: [a], units: [] },
      targetModel('a'),
      targetPoint(2.25, 2),
    )
    expect(result?.distanceInches).toBe(0)
    expect(result?.startAnchor).toEqual({ x: 2.25, y: 2 })
    expect(result?.endAnchor).toEqual({ x: 2.25, y: 2 })
  })

  it('measures model-to-unit and unit-to-model in target order', () => {
    const a = model('a', 0, 0, 25.4, 'unit-a')
    const b1 = model('b1', 10, 0, 25.4, 'unit-b')
    const b2 = model('b2', 3, 0, 25.4, 'unit-b')
    const state = { models: [a, b1, b2], units: [unit('unit-a', ['a']), unit('unit-b', ['b1', 'b2'])] }
    const forward = measureBetweenTargets(state, targetModel('a'), targetUnit('unit-b'))
    const reverse = measureBetweenTargets(state, targetUnit('unit-b'), targetModel('a'))
    expect(forward).toMatchObject({ distanceInches: 2, sourceModelId: 'a', targetModelId: 'b2' })
    expect(reverse).toMatchObject({ distanceInches: 2, sourceModelId: 'b2', targetModelId: 'a' })
    expect(forward?.startAnchor).toEqual(reverse?.endAnchor)
    expect(forward?.endAnchor).toEqual(reverse?.startAnchor)
  })

  it('measures a unit to a point and reverses anchors for point to unit', () => {
    const far = model('far', 0, 0, 25.4, 'unit-a')
    const near = model('near', 4, 0, 50.8, 'unit-a')
    const state = { models: [far, near], units: [unit('unit-a', ['far', 'near'])] }
    const forward = measureBetweenTargets(state, targetUnit('unit-a'), targetPoint(6, 0))
    const reverse = measureBetweenTargets(state, targetPoint(6, 0), targetUnit('unit-a'))
    expect(forward).toMatchObject({
      distanceInches: 1,
      startAnchor: { x: 5, y: 0 },
      endAnchor: { x: 6, y: 0 },
      sourceModelId: 'near',
    })
    expect(reverse).toMatchObject({
      distanceInches: 1,
      startAnchor: { x: 6, y: 0 },
      endAnchor: { x: 5, y: 0 },
      targetModelId: 'near',
    })
  })

  it('measures unit to unit using the closest responsible pair', () => {
    const a1 = model('a1', 0, 0, 25.4, 'unit-a')
    const a2 = model('a2', 8, 0, 25.4, 'unit-a')
    const b1 = model('b1', 3, 0, 25.4, 'unit-b')
    const b2 = model('b2', 12, 0, 25.4, 'unit-b')
    const state = {
      models: [a1, a2, b1, b2],
      units: [unit('unit-a', ['a1', 'a2']), unit('unit-b', ['b1', 'b2'])],
    }
    expect(measureBetweenTargets(state, targetUnit('unit-a'), targetUnit('unit-b'))).toMatchObject({
      distanceInches: 2,
      sourceModelId: 'a1',
      targetModelId: 'b1',
    })
  })

  it('treats a one-model unit equivalently to that model', () => {
    const a = model('a', 0, 0, 25.4, 'unit-a')
    const b = model('b', 5, 0, 50.8, 'unit-b')
    const state = { models: [a, b], units: [unit('unit-a', ['a']), unit('unit-b', ['b'])] }
    const modelResult = measureBetweenTargets(state, targetModel('a'), targetModel('b'))
    const unitResult = measureBetweenTargets(state, targetUnit('unit-a'), targetUnit('unit-b'))
    expect(unitResult?.distanceInches).toBe(modelResult?.distanceInches)
    expect(unitResult?.startAnchor).toEqual(modelResult?.startAnchor)
    expect(unitResult?.endAnchor).toEqual(modelResult?.endAnchor)
  })

  it('recomputes from live positions and can switch the closest unit pair', () => {
    const a1 = model('a1', 0, 0, 25.4, 'unit-a')
    const a2 = model('a2', 10, 0, 25.4, 'unit-a')
    const b1 = model('b1', 3, 0, 25.4, 'unit-b')
    const b2 = model('b2', 20, 0, 25.4, 'unit-b')
    const units = [unit('unit-a', ['a1', 'a2']), unit('unit-b', ['b1', 'b2'])]
    const targets = [targetUnit('unit-a'), targetUnit('unit-b')] as const
    const initial = measureBetweenTargets({ models: [a1, a2, b1, b2], units }, ...targets)
    const movedB2 = { ...b2, position: { x: 11.5, y: 0 } }
    const updated = measureBetweenTargets({ models: [a1, a2, b1, movedB2], units }, ...targets)
    expect(initial).toMatchObject({ sourceModelId: 'a1', targetModelId: 'b1', distanceInches: 2 })
    expect(updated).toMatchObject({ sourceModelId: 'a2', targetModelId: 'b2', distanceInches: 0.5 })
  })

  it('returns null for missing models, missing units, and units without resolvable models', () => {
    const state = { models: [model('a', 0, 0)], units: [unit('empty', []), unit('stale', ['missing'])] }
    expect(measureBetweenTargets(state, targetModel('missing'), targetPoint(1, 1))).toBeNull()
    expect(measureBetweenTargets(state, targetUnit('missing'), targetPoint(1, 1))).toBeNull()
    expect(measureBetweenTargets(state, targetUnit('empty'), targetPoint(1, 1))).toBeNull()
    expect(measureBetweenTargets(state, targetUnit('stale'), targetModel('a'))).toBeNull()
  })

  it('does not mutate authoritative models or units', () => {
    const models = [model('a', 0, 0, 25.4, 'unit-a'), model('b', 3, 0, 25.4, 'unit-b')]
    const units = [unit('unit-a', ['a']), unit('unit-b', ['b'])]
    const before = JSON.parse(JSON.stringify({ models, units }))
    measureBetweenTargets({ models, units }, targetUnit('unit-a'), targetUnit('unit-b'))
    expect({ models, units }).toEqual(before)
  })
})
