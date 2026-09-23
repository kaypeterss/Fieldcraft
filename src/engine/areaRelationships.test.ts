import { describe, expect, it } from 'vitest'
import type { BattlefieldArea } from './areaRelationships'
import type { TabletopModel } from '../domain/types'
import { battlefieldFeatureDemoGameState } from '../game/battlefieldFeatureDemo'
import { evaluateUnitCoherency } from './coherency'
import { featureObjectiveArea } from './battlefieldFeatures'
import { featureBaseArea, modelAreaRelationship, objectiveArea, unitAreaSummary } from './areaRelationships'
import { footprintInsideBattlefield, footprintsOverlap, poseForModel } from './geometry/footprints'
import { terrainDestinationLegal, terrainMotionObstacles, terrainSurfaces } from './terrainPolicy'

const circleArea: BattlefieldArea = {
  footprint: { shape: 'circle', diameterMm: 50.8 },
  pose: { position: { x: 0, y: 0 }, rotation: 0 },
}
const model = (id: string, x: number, y: number, base: TabletopModel['base'] = { shape: 'circle', diameterMm: 25.4 }): TabletopModel => ({
  id, unitId: 'unit', ownerId: 'player-1', position: { x, y }, rotation: 0,
  base, canPassOverModels: false,
})

describe('generic area relationships', () => {
  it('keeps touching/intersecting, wholly within, and center within independent', () => {
    const outside = modelAreaRelationship(model('outside', 1.6, 0), circleArea)
    const touching = modelAreaRelationship(model('touching', 1.5, 0), circleArea)
    const center = modelAreaRelationship(model('center', 0.8, 0), circleArea)
    const within = modelAreaRelationship(model('within', 0, 0), circleArea)
    expect(outside).toMatchObject({ placement: 'outside', intersects: false, whollyWithin: false, centerWithin: false })
    expect(touching).toMatchObject({ placement: 'intersecting', intersects: true, whollyWithin: false, centerWithin: false })
    expect(center).toMatchObject({ placement: 'intersecting', intersects: true, whollyWithin: false, centerWithin: true })
    expect(within).toMatchObject({ placement: 'wholly-within', intersects: true, whollyWithin: true, centerWithin: true })
    expect(outside.distanceInches).toBeCloseTo(0.1)
    expect(touching.distanceInches).toBe(0)
  })

  it('counts each model footprint and center without choosing a game rule', () => {
    const models = [model('outside', 1.6, 0), model('touching', 1.5, 0), model('center', 0.8, 0), model('within', 0, 0)]
    expect(unitAreaSummary({ id: 'unit', ownerId: 'player-1', definitionId: 'test', modelIds: models.map((entry) => entry.id) }, models, circleArea))
      .toMatchObject({ modelCount: 4, intersectingCount: 3, whollyWithinCount: 1, centerWithinCount: 2, distanceInches: 0 })
  })

  it('uses the exact shared irregular base for terrain and objective geometry', () => {
    const feature = battlefieldFeatureDemoGameState.battlefieldFeatures!.find((entry) => entry.id === 'demo-combined')!
    expect(objectiveArea(feature)).toEqual(featureBaseArea(feature))
    expect(featureObjectiveArea(feature)?.footprint).toBe(feature.baseArea)
    const unit = battlefieldFeatureDemoGameState.units.find((entry) => entry.id === 'qa-objective-unit')!
    const counts = unitAreaSummary(unit, battlefieldFeatureDemoGameState.models, objectiveArea(feature)!)
    expect(counts.modelCount).toBe(10)
    expect(counts.intersectingCount).toBeGreaterThan(counts.whollyWithinCount)
    expect(counts.centerWithinCount).toBeGreaterThan(counts.whollyWithinCount)
  })

  it('rotated oval footprint, not its center, changes the relationship', () => {
    const area: BattlefieldArea = { footprint: { shape: 'rectangle', widthMm: 101.6, heightMm: 50.8 },
      pose: { position: { x: 0, y: 0 }, rotation: Math.PI / 6 } }
    const oval = model('oval', 0, 0, { shape: 'ellipse', widthMm: 75, heightMm: 30 })
    const aligned = modelAreaRelationship({ ...oval, rotation: Math.PI / 6 }, area)
    const transverse = modelAreaRelationship({ ...oval, rotation: Math.PI / 6 + Math.PI / 2 }, area)
    expect(aligned.whollyWithin).toBe(true)
    expect(transverse.whollyWithin).toBe(false)
    expect(transverse.centerWithin).toBe(true)
  })

  it('supports rotated circle, oval, rectangle and convex hull against supported area shapes', () => {
    const shapes: TabletopModel['base'][] = [
      { shape: 'circle', diameterMm: 20 },
      { shape: 'ellipse', widthMm: 26, heightMm: 14 },
      { shape: 'rectangle', widthMm: 22, heightMm: 15 },
      { shape: 'polygon', verticesMm: [{ x: -12, y: -8 }, { x: 11, y: -9 }, { x: 13, y: 6 }, { x: -9, y: 10 }] },
    ]
    const areas: BattlefieldArea[] = [
      { footprint: { shape: 'ellipse', widthMm: 200, heightMm: 120 }, pose: { position: { x: 5, y: 5 }, rotation: Math.PI / 5 } },
      { footprint: { shape: 'rectangle', widthMm: 200, heightMm: 120 }, pose: { position: { x: 5, y: 5 }, rotation: Math.PI / 5 } },
      { footprint: { shape: 'polygon', verticesMm: [{ x: -100, y: -60 }, { x: 100, y: -60 }, { x: 100, y: 60 }, { x: -100, y: 60 }] },
        pose: { position: { x: 5, y: 5 }, rotation: Math.PI / 5 } },
    ]
    for (const area of areas) for (const shape of shapes) {
      expect(modelAreaRelationship({ ...model('inside', 5, 5, shape), rotation: Math.PI / 3 }, area).whollyWithin).toBe(true)
      expect(modelAreaRelationship({ ...model('outside', 15, 5, shape), rotation: Math.PI / 3 }, area).placement).toBe('outside')
    }
  })

  it('resolves point plus range to a real circular area and leaves objective-only features nonblocking', () => {
    const feature = battlefieldFeatureDemoGameState.battlefieldFeatures!.find((entry) => entry.id === 'demo-point-objective')!
    const area = objectiveArea(feature)!
    expect(area.footprint).toEqual({ shape: 'circle', diameterMm: 127 })
    expect(area.pose.position).toEqual(feature.pose.position)
    const shifted = objectiveArea({ ...feature, pose: { position: { x: 10, y: 10 }, rotation: Math.PI / 2 },
      capabilities: { objective: { type: 'objective', area: {
        type: 'point-range', localPoint: { x: 2, y: 0 }, rangeInches: 1,
      } } } })!
    expect(shifted.pose.position.x).toBeCloseTo(10)
    expect(shifted.pose.position.y).toBeCloseTo(12)
    expect(modelAreaRelationship(model('near', 28, 38), area).whollyWithin).toBe(true)
    expect(modelAreaRelationship(model('far', 31, 38), area).intersects).toBe(false)
    expect(terrainSurfaces([feature])).toEqual([])
    const crossing = model('crossing', 27, 38)
    expect(terrainMotionObstacles(crossing, poseForModel(crossing), [feature], battlefieldFeatureDemoGameState.terrainPolicy)).toEqual([])
    expect(terrainDestinationLegal(crossing, poseForModel(crossing), [feature], battlefieldFeatureDemoGameState.terrainPolicy)).toBe(true)
  })

  it('keeps the ten-model QA formation legal, non-overlapping and coherent', () => {
    const state = battlefieldFeatureDemoGameState
    const unit = state.units.find((entry) => entry.id === 'qa-objective-unit')!
    const models = state.models.filter((entry) => unit.modelIds.includes(entry.id))
    for (const moving of models) {
      expect(footprintInsideBattlefield(moving.base, poseForModel(moving), state.battlefield)).toBe(true)
      expect(terrainDestinationLegal(moving, poseForModel(moving), state.battlefieldFeatures, state.terrainPolicy),
        `${moving.id} must not start on a blocking terrain surface`).toBe(true)
      for (const other of state.models) {
        if (other.id === moving.id) continue
        expect(footprintsOverlap(moving.base, poseForModel(moving), other.base, poseForModel(other)),
          `${moving.id} overlaps ${other.id}`).toBe(false)
      }
    }
    expect(evaluateUnitCoherency(unit, state.models, { distance: 1, requiredNeighbors: 1, requireConnected: true }).coherent).toBe(true)
  })
})
