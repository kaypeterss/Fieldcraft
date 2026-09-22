import { describe, expect, it } from 'vitest'
import type { TabletopModel, Unit } from '../domain/types'
import { evaluateUnitCoherency, isCoherencyResultValid } from './coherency'
import {
  distanceBetweenBases,
  distanceFromBaseToPoint,
  exclusionRadiusForTargetBase,
  isTargetCenterWithinExclusionZone,
  minimumDistanceBetweenUnits,
  modelsWithinRangeOfModel,
  modelsWithinRangeOfUnit,
  rangeRadiusForBase,
} from './spatial'
import { measureBetweenTargets } from '../tools/measurement'

function model(id: string, x: number, y: number, diameterMm = 25.4, unitId = 'unit-a'): TabletopModel {
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

describe('spatial base distances', () => {
  it('returns edge distance for equal circular bases', () => {
    expect(distanceBetweenBases(model('a', 0, 0), model('b', 5, 0))).toBe(4)
  })

  it('handles different base sizes', () => {
    expect(distanceBetweenBases(model('a', 0, 0, 25.4), model('b', 5, 0, 50.8))).toBe(3.5)
  })

  it('clamps touching and overlapping bases to zero', () => {
    expect(distanceBetweenBases(model('a', 0, 0), model('b', 1, 0))).toBe(0)
    expect(distanceBetweenBases(model('a', 0, 0), model('b', 0.5, 0))).toBe(0)
  })

  it('agrees with measurement-tool geometry', () => {
    const a = model('a', 2, 3, 32)
    const b = model('b', 8, 7, 50)
    const measurement = measureBetweenTargets(
      { models: [a, b], units: [] },
      { type: 'model', modelId: a.id },
      { type: 'model', modelId: b.id },
    )
    expect(measurement?.distanceInches).toBe(distanceBetweenBases(a, b))
  })

  it('measures from the base edge to outside, edge, and interior points', () => {
    const source = model('a', 5, 5, 50.8)
    expect(distanceFromBaseToPoint(source, { x: 9, y: 5 })).toBe(3)
    expect(distanceFromBaseToPoint(source, { x: 6, y: 5 })).toBe(0)
    expect(distanceFromBaseToPoint(source, { x: 5.25, y: 5 })).toBe(0)
  })
})

describe('range queries', () => {
  it('derives the effective range radius from base edge plus range', () => {
    expect(rangeRadiusForBase({ shape: 'circle', diameterMm: 25.4 }, 3)).toBe(3.5)
    expect(rangeRadiusForBase({ shape: 'circle', diameterMm: 50.8 }, 3)).toBe(4)
    expect(() => rangeRadiusForBase({ shape: 'circle', diameterMm: 25.4 }, -1)).toThrow(RangeError)
  })

  it('includes the exact boundary and excludes a point beyond tolerance', () => {
    const source = model('source', 0, 0)
    const boundary = model('boundary', 4, 0)
    const outside = model('outside', 4.000001, 0)
    expect(modelsWithinRangeOfModel(source, [boundary, outside], 3).map((entry) => entry.id)).toEqual(['boundary'])
  })

  it('handles different base sizes', () => {
    const source = model('source', 0, 0, 25.4)
    const large = model('large', 5.5, 0, 50.8)
    expect(modelsWithinRangeOfModel(source, [large], 4)).toEqual([large])
  })

  it('excludes the source by default and can include it explicitly', () => {
    const source = model('source', 0, 0)
    expect(modelsWithinRangeOfModel(source, [source], 0)).toEqual([])
    expect(modelsWithinRangeOfModel(source, [source], 0, { includeSource: true })).toEqual([source])
  })

  it('finds candidates near any member of a source unit', () => {
    const sources = [model('a', 0, 0), model('b', 10, 0)]
    const candidates = [model('near-a', 3, 0), model('near-b', 13, 0), model('far', 20, 0)]
    expect(modelsWithinRangeOfUnit(sources, candidates, 2).map((entry) => entry.id)).toEqual(['near-a', 'near-b'])
  })

  it('updates range membership when a source model moves', () => {
    const candidate = model('candidate', 4, 0)
    expect(modelsWithinRangeOfModel(model('source', 0, 0), [candidate], 3)).toEqual([candidate])
    expect(modelsWithinRangeOfModel(model('source', 1, 0), [candidate], 3)).toEqual([candidate])
    expect(modelsWithinRangeOfModel(model('source', -1, 0), [candidate], 3)).toEqual([])
  })

  it('does not return source members unless requested', () => {
    const sources = [model('a', 0, 0), model('b', 1, 0)]
    expect(modelsWithinRangeOfUnit(sources, sources, 0)).toEqual([])
    expect(modelsWithinRangeOfUnit(sources, sources, 0, { includeSource: true })).toEqual(sources)
  })
})

describe('unit distances', () => {
  it('returns the minimum distance and responsible model pair', () => {
    const result = minimumDistanceBetweenUnits(
      [model('a1', 0, 0), model('a2', 10, 0)],
      [model('b1', 20, 0), model('b2', 12, 0)],
    )
    expect(result).toMatchObject({ distance: 1, sourceModelId: 'a2', targetModelId: 'b2' })
    expect(result?.startAnchor).toEqual({ x: 10.5, y: 0 })
    expect(result?.endAnchor).toEqual({ x: 11.5, y: 0 })
  })

  it('handles unequal unit sizes and empty units', () => {
    expect(minimumDistanceBetweenUnits([model('a', 0, 0, 50.8)], [model('b', 5, 0)])?.distance).toBe(3.5)
    expect(minimumDistanceBetweenUnits([], [model('b', 5, 0)])).toBeNull()
  })
})

describe('exclusion geometry', () => {
  it.each([
    [25.4, 25.4, 4],
    [25.4, 32, 4 + (32 - 25.4) / (2 * 25.4)],
    [25.4, 50.8, 4.5],
    [50.8, 25.4, 4.5],
    [50.8, 50.8, 5],
  ])('combines source radius, separation, and target radius for %s/%s mm bases', (sourceDiameter, targetDiameter, expected) => {
    expect(exclusionRadiusForTargetBase(model('source', 0, 0, sourceDiameter), { shape: 'circle', diameterMm: targetDiameter }, 3)).toBeCloseTo(expected, 10)
  })

  it('changes when target size or required separation changes', () => {
    const source = model('source', 0, 0, 25.4)
    const small = exclusionRadiusForTargetBase(source, { shape: 'circle', diameterMm: 25.4 }, 3)
    const large = exclusionRadiusForTargetBase(source, { shape: 'circle', diameterMm: 50.8 }, 3)
    expect(large).toBeGreaterThan(small)
    expect(exclusionRadiusForTargetBase(source, { shape: 'circle', diameterMm: 25.4 }, 4)).toBe(small + 1)
  })

  it('classifies boundary contact as legal and inside contact as violating', () => {
    const source = model('source', 0, 0, 25.4)
    const targetBase = { shape: 'circle' as const, diameterMm: 32 }
    const radius = exclusionRadiusForTargetBase(source, targetBase, 3)
    expect(isTargetCenterWithinExclusionZone(source, { x: radius, y: 0 }, targetBase, 3)).toBe(false)
    expect(isTargetCenterWithinExclusionZone(source, { x: radius - 0.001, y: 0 }, targetBase, 3)).toBe(true)
    expect(isTargetCenterWithinExclusionZone(source, { x: radius + 0.001, y: 0 }, targetBase, 3)).toBe(false)
  })

  it('rejects a negative required separation', () => {
    expect(() => exclusionRadiusForTargetBase(model('source', 0, 0), { shape: 'circle', diameterMm: 25 }, -1)).toThrow(RangeError)
  })
})

describe('coherency evaluation', () => {
  it('accepts two models within policy distance and rejects two outside it', () => {
    const sourceUnit = unit('unit-a', ['a', 'b'])
    expect(evaluateUnitCoherency(sourceUnit, [model('a', 0, 0), model('b', 2, 0)], { distance: 1, requiredNeighbors: 1 }).coherent).toBe(true)
    expect(evaluateUnitCoherency(sourceUnit, [model('a', 0, 0), model('b', 3, 0)], { distance: 1, requiredNeighbors: 1 }).coherent).toBe(false)
  })

  it('evaluates a coherent multi-model chain and flags a separated model', () => {
    const models = [model('a', 0, 0), model('b', 2, 0), model('c', 4, 0), model('d', 10, 0)]
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, { distance: 1, requiredNeighbors: 1 })
    expect(result.models.map((entry) => entry.neighborCount)).toEqual([1, 2, 1, 0])
    expect(result.models.find((entry) => entry.modelId === 'd')?.valid).toBe(false)
  })

  it('reports neighbor counts and validity using base-edge range', () => {
    const models = [model('a', 0, 0), model('b', 2, 0), model('c', 10, 0)]
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, { distance: 1, requiredNeighbors: 1 })
    expect(result.coherent).toBe(false)
    expect(result.models).toEqual([
      { modelId: 'a', neighborIds: ['b'], neighborCount: 1, valid: true },
      { modelId: 'b', neighborIds: ['a'], neighborCount: 1, valid: true },
      { modelId: 'c', neighborIds: [], neighborCount: 0, valid: false },
    ])
  })

  it('supports policies requiring multiple local neighbors', () => {
    const models = [model('a', 0, 0), model('b', 1.5, 0), model('c', 0.75, 1.25)]
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, { distance: 1, requiredNeighbors: 2 })
    expect(result.coherent).toBe(true)
    expect(result.models.every((entry) => entry.neighborCount === 2)).toBe(true)
  })

  it('distinguishes zero, one, and two-neighbor models for a two-neighbor policy', () => {
    const models = [model('zero', -10, 0), model('one', 0, 0), model('two-a', 2, 0), model('two-b', 2, 2)]
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, { distance: 1, requiredNeighbors: 2 })
    expect(result.models.map((entry) => [entry.modelId, entry.neighborCount, entry.valid])).toEqual([
      ['zero', 0, false], ['one', 1, false], ['two-a', 2, true], ['two-b', 1, false],
    ])
  })

  it('uses edge distance, supports unequal bases, and includes the exact boundary', () => {
    const unequal = [model('small', 0, 0, 25.4), model('large', 5.5, 0, 50.8)]
    const unitValue = unit('unit-a', ['small', 'large'])
    expect(evaluateUnitCoherency(unitValue, unequal, { distance: 4, requiredNeighbors: 1 }).coherent).toBe(true)
    const boundary = [model('a', 0, 0), model('b', 4, 0)]
    expect(evaluateUnitCoherency(unit('unit-a', ['a', 'b']), boundary, { distance: 3, requiredNeighbors: 1 }).coherent).toBe(true)
  })

  it('does not mutate authoritative models or units', () => {
    const models = [model('a', 0, 0), model('b', 2, 0)]
    const unitValue = unit('unit-a', ['a', 'b'])
    const beforeModels = JSON.parse(JSON.stringify(models))
    const beforeUnit = JSON.parse(JSON.stringify(unitValue))
    evaluateUnitCoherency(unitValue, models, { distance: 1, requiredNeighbors: 1 })
    expect(models).toEqual(beforeModels)
    expect(unitValue).toEqual(beforeUnit)
  })

  it('rejects two disconnected locally valid groups when connectedness is required', () => {
    const models = [
      model('a', 0, 0), model('b', 1.5, 0),
      model('c', 10, 0), model('d', 11.5, 0),
    ]
    const policy = { distance: 1, requiredNeighbors: 1, requireConnected: true }
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, policy)
    expect(result.neighborRequirementsSatisfied).toBe(true)
    expect(result.connected).toBe(false)
    expect(result.componentCount).toBe(2)
    expect(result.coherent).toBe(false)
    expect(isCoherencyResultValid(result, policy)).toBe(false)
  })

  it('reports a connected locally valid unit as one coherent component', () => {
    const models = ['a', 'b', 'c', 'd'].map((id, index) => model(id, index * 1.5, 0))
    const policy = { distance: 1, requiredNeighbors: 1, requireConnected: true }
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, policy)
    expect(result.neighborRequirementsSatisfied).toBe(true)
    expect(result.connected).toBe(true)
    expect(result.componentCount).toBe(1)
    expect(result.components).toEqual([['a', 'b', 'c', 'd']])
    expect(result.coherent).toBe(true)
  })

  it('rejects the exact four-model plus six-model disconnected split', () => {
    const group = (prefix: string, originX: number, count: number) => Array.from({ length: count }, (_, index) => (
      model(`${prefix}-${index}`, originX + (index % 3) * 1.5, Math.floor(index / 3) * 1.5)
    ))
    const models = [...group('left', 0, 4), ...group('right', 20, 6)]
    const policy = { distance: 1, requiredNeighbors: 1, requireConnected: true }
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, policy)
    expect(result.neighborRequirementsSatisfied).toBe(true)
    expect(result.connected).toBe(false)
    expect(result.componentCount).toBe(2)
    expect(result.components.map((component) => component.length)).toEqual([4, 6])
    expect(result.coherent).toBe(false)
  })

  it('rejects three disconnected locally valid components', () => {
    const models = [0, 10, 20].flatMap((origin, groupIndex) => [
      model(`${groupIndex}-a`, origin, 0),
      model(`${groupIndex}-b`, origin + 1.5, 0),
    ])
    const result = evaluateUnitCoherency(
      unit('unit-a', models.map((entry) => entry.id)),
      models,
      { distance: 1, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.neighborRequirementsSatisfied).toBe(true)
    expect(result.componentCount).toBe(3)
    expect(result.coherent).toBe(false)
  })

  it('becomes connected after a valid coherency chain reconnects two groups', () => {
    const models = ['a', 'b', 'bridge-a', 'bridge-b', 'c', 'd'].map((id, index) => model(id, index * 1.5, 0))
    const result = evaluateUnitCoherency(
      unit('unit-a', models.map((entry) => entry.id)),
      models,
      { distance: 1, requiredNeighbors: 1, requireConnected: true },
    )
    expect(result.connected).toBe(true)
    expect(result.componentCount).toBe(1)
    expect(result.coherent).toBe(true)
  })

  it('fails local requirements even when the graph is connected', () => {
    const models = [model('a', 0, 0), model('b', 1.5, 0), model('c', 3, 0)]
    const result = evaluateUnitCoherency(
      unit('unit-a', models.map((entry) => entry.id)),
      models,
      { distance: 1, requiredNeighbors: 2, requireConnected: true },
    )
    expect(result.connected).toBe(true)
    expect(result.neighborRequirementsSatisfied).toBe(false)
    expect(result.coherent).toBe(false)
  })

  it('allows disconnected components when the policy does not require connectedness', () => {
    const models = [
      model('a', 0, 0), model('b', 1.5, 0),
      model('c', 10, 0), model('d', 11.5, 0),
    ]
    const policy = { distance: 1, requiredNeighbors: 1, requireConnected: false }
    const result = evaluateUnitCoherency(unit('unit-a', models.map((entry) => entry.id)), models, policy)
    expect(result.neighborRequirementsSatisfied).toBe(true)
    expect(result.connected).toBe(false)
    expect(result.componentCount).toBe(2)
    expect(result.coherent).toBe(true)
    expect(isCoherencyResultValid(result, policy)).toBe(true)
  })

  it('updates from current positions without storing stale results', () => {
    const a = model('a', 0, 0)
    const b = model('b', 2, 0)
    const sourceUnit = unit('unit-a', ['a', 'b'])
    expect(evaluateUnitCoherency(sourceUnit, [a, b], { distance: 1, requiredNeighbors: 1 }).coherent).toBe(true)
    expect(evaluateUnitCoherency(sourceUnit, [a, { ...b, position: { x: 10, y: 0 } }], { distance: 1, requiredNeighbors: 1 }).coherent).toBe(false)
  })
})
