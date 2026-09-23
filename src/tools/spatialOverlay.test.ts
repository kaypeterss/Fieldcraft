import { describe, expect, it } from 'vitest'
import type { TabletopModel } from '../domain/types'
import { exclusionTargetForModel } from './spatialOverlay'

function model(id: string, base: TabletopModel['base'], rotation: number): TabletopModel {
  return {
    id,
    unitId: 'unit',
    ownerId: 'player',
    position: { x: 0, y: 0 },
    rotation,
    base,
    canPassOverModels: false,
  }
}

describe('Spatial Exclusion targets', () => {
  it('uses each selected model footprint and orientation independently', () => {
    const circle = model('circle', { shape: 'circle', diameterMm: 32 }, 0)
    const oval = model('oval', { shape: 'ellipse', widthMm: 75, heightMm: 42 }, Math.PI / 3)

    expect(exclusionTargetForModel(circle)).toEqual({ footprint: circle.base, rotation: 0 })
    expect(exclusionTargetForModel(oval)).toEqual({ footprint: oval.base, rotation: Math.PI / 3 })
    expect(exclusionTargetForModel(circle).footprint).not.toEqual(exclusionTargetForModel(oval).footprint)
  })
})
