import { describe, expect, it } from 'vitest'
import type { TabletopModel, Unit } from '../domain/types'
import { evaluateUnitCoherency, isCoherencyResultValid } from './coherency'
import {
  distanceBetweenBases,
  distanceFromBaseToPoint,
  exclusionOutlineForTargetFootprint,
  exclusionRadiusForTargetBase,
  isTargetCenterWithinExclusionZone,
  isPointWithinModelRangeArea,
  minimumDistanceBetweenUnits,
  modelsWithinRangeOfModel,
  modelsWithinRangeOfUnit,
  rangeRadiusForBase,
  rangeOutlineForModel,
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

  it('uses actual rotated geometry for distance, range, and coherency', () => {
    const source: TabletopModel = {
      ...model('oval', 0, 0, 25.4, 'shapes'),
      rotation: Math.PI / 2,
      base: { shape: 'ellipse', widthMm: 50.8, heightMm: 25.4 },
    }
    const target: TabletopModel = {
      ...model('rect', 3.5, 0, 25.4, 'shapes'),
      base: { shape: 'rectangle', widthMm: 50.8, heightMm: 25.4 },
    }
    expect(distanceBetweenBases(source, target)).toBeCloseTo(2)
    expect(modelsWithinRangeOfModel(source, [target], 2)).toEqual([target])
    expect(evaluateUnitCoherency(
      unit('shapes', [source.id, target.id]),
      [source, target],
      { distance: 2, requiredNeighbors: 1 },
    ).coherent).toBe(true)
  })

  it('measures from the base edge to outside, edge, and interior points', () => {
    const source = model('a', 5, 5, 50.8)
    expect(distanceFromBaseToPoint(source, { x: 9, y: 5 })).toBe(3)
    expect(distanceFromBaseToPoint(source, { x: 6, y: 5 })).toBe(0)
    expect(distanceFromBaseToPoint(source, { x: 5.25, y: 5 })).toBe(0)
  })
})

describe('live spatial overlays', () => {
  it('re-derives Range, Exclusion, and Coherency from the current translated and rotated poses', () => {
    const before: TabletopModel = {
      ...model('oval', 5, 5, 25.4, 'shapes'),
      base: { shape: 'ellipse', widthMm: 76.2, heightMm: 25.4 },
    }
    const after: TabletopModel = {
      ...before,
      position: { x: 6, y: 5.5 },
      rotation: Math.PI / 2,
    }
    const neighbor = model('neighbor', 9, 5, 25.4, 'shapes')
    const shapes = unit('shapes', [before.id, neighbor.id])
    const target = { shape: 'rectangle' as const, widthMm: 50.8, heightMm: 25.4 }

    expect(rangeOutlineForModel(after, 3)).not.toEqual(rangeOutlineForModel(before, 3))
    expect(exclusionOutlineForTargetFootprint(after, target, Math.PI / 4, 2))
      .not.toEqual(exclusionOutlineForTargetFootprint(before, target, Math.PI / 4, 2))
    expect(evaluateUnitCoherency(shapes, [after, neighbor], {
      distance: 10, requiredNeighbors: 1,
    }).links).not.toEqual(evaluateUnitCoherency(shapes, [before, neighbor], {
      distance: 10, requiredNeighbors: 1,
    }).links)
  })
})

describe('range queries', () => {
  it('derives the effective range radius from base edge plus range', () => {
    expect(rangeRadiusForBase({ shape: 'circle', diameterMm: 25.4 }, 3)).toBe(3.5)
    expect(rangeRadiusForBase({ shape: 'circle', diameterMm: 50.8 }, 3)).toBe(4)
    expect(() => rangeRadiusForBase({ shape: 'circle', diameterMm: 25.4 }, -1)).toThrow(RangeError)
  })

  it('keeps rotated footprint membership and the rendered range outline aligned', () => {
    const source: TabletopModel = {
      ...model('source', 5, 5),
      rotation: Math.PI / 4,
      base: { shape: 'rectangle', widthMm: 50.8, heightMm: 25.4 },
    }
    const outline = rangeOutlineForModel(source, 2, 128)
    expect(outline).toHaveLength(128)
    expect(outline.every((point) => isPointWithinModelRangeArea(source, point, 2))).toBe(true)
    expect(isPointWithinModelRangeArea(source, { x: 5, y: 5 }, 2)).toBe(true)
    expect(isPointWithinModelRangeArea(source, { x: 20, y: 5 }, 2)).toBe(false)
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

  it('uses both actual footprints and the target orientation', () => {
    const source: TabletopModel = {
      ...model('source', 5, 5),
      rotation: Math.PI / 4,
      base: { shape: 'rectangle', widthMm: 76.2, heightMm: 25.4 },
    }
    const target = { shape: 'ellipse' as const, widthMm: 76.2, heightMm: 25.4 }
    const horizontal = exclusionOutlineForTargetFootprint(source, target, 0, 1, 128)
    const vertical = exclusionOutlineForTargetFootprint(source, target, Math.PI / 2, 1, 128)
    expect(Math.max(...horizontal.map((point) => point.x))).toBeGreaterThan(
      Math.max(...vertical.map((point) => point.x)),
    )
    const horizontalBoundary = horizontal[0]
    expect(isTargetCenterWithinExclusionZone(source, horizontalBoundary, target, 1, 0)).toBe(false)
    expect(isTargetCenterWithinExclusionZone(
      source,
      { x: horizontalBoundary.x - 0.01, y: horizontalBoundary.y },
      target,
      1,
      0,
    )).toBe(true)
  })

  it('retains circular target-center exclusion parity', () => {
    const source = model('source', 2, 3, 25.4)
    const target = { shape: 'circle' as const, diameterMm: 50.8 }
    const radius = exclusionRadiusForTargetBase(source, target, 3)
    const outline = exclusionOutlineForTargetFootprint(source, target, 0, 3, 64)
    expect(outline[0]).toEqual({ x: source.position.x + radius, y: source.position.y })
    expect(isTargetCenterWithinExclusionZone(source, { x: source.position.x + radius, y: 3 }, target, 3)).toBe(false)
  })
})

describe('coherency evaluation', () => {
  it('stores actual rotated footprint-edge anchors for visualization links', () => {
    const source: TabletopModel = {
      ...model('oval', 0, 0, 25.4, 'shapes'),
      rotation: Math.PI / 2,
      base: { shape: 'ellipse', widthMm: 50.8, heightMm: 25.4 },
    }
    const target: TabletopModel = {
      ...model('rectangle', 3.5, 0, 25.4, 'shapes'),
      base: { shape: 'rectangle', widthMm: 50.8, heightMm: 25.4 },
    }
    const result = evaluateUnitCoherency(
      unit('shapes', [source.id, target.id]),
      [source, target],
      { distance: 2, requiredNeighbors: 1 },
    )
    expect(result.links[0].distance).toBeCloseTo(2)
    expect(result.links[0].startAnchor.x).toBeCloseTo(0.5)
    expect(result.links[0].startAnchor.y).toBeCloseTo(0)
    expect(result.links[0].endAnchor.x).toBeCloseTo(2.5)
    expect(result.links[0].endAnchor.y).toBeCloseTo(0)
  })

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
