import { describe, expect, it } from 'vitest'
import type { BattlefieldFeature, TabletopModel } from '../domain/types'
import { interpretVisibility, visibilityBetweenModels } from './visibility'

function model(
  id: string,
  x: number,
  y: number,
  base: TabletopModel['base'] = { shape: 'circle', diameterMm: 25.4 },
  rotation = 0,
): TabletopModel {
  return { id, unitId: `${id}-unit`, ownerId: 'player', position: { x, y }, rotation, base, canPassOverModels: false }
}

function terrainWithWall(wallHeightInches: number, wallY = 0): BattlefieldFeature {
  return {
    id: 'ruin', name: 'Irregular Ruin', pose: { position: { x: 5, y: 0 }, rotation: 0 },
    baseArea: { shape: 'rectangle', widthMm: 101.6, heightMm: 101.6 },
    capabilities: { terrain: { type: 'terrain' } },
    objects: [{
      id: 'wall', name: 'Wall',
      footprint: { shape: 'rectangle', widthMm: 12.7, heightMm: wallHeightInches * 25.4 },
      localPose: { position: { x: 0, y: wallY }, rotation: 0 },
    }],
  }
}

describe('footprint-aware visibility', () => {
  it('finds a clear Any→Any relationship when a wall hides only part of the target', () => {
    const viewer = model('viewer', 0, 0)
    const target = model('target', 10, 0, { shape: 'rectangle', widthMm: 50.8, heightMm: 101.6 })
    const geometry = visibilityBetweenModels(viewer, target, [terrainWithWall(2)])
    const analysis = interpretVisibility(geometry, 'objects-block', 'any-to-any')

    expect(analysis.visible).toBe(true)
    expect(analysis.segments).toHaveLength(1)
    expect(analysis.segments[0].blocked).toBe(false)
  })

  it('fails Any→All for the same partially hidden target', () => {
    const viewer = model('viewer', 0, 0)
    const target = model('target', 10, 0, { shape: 'rectangle', widthMm: 50.8, heightMm: 101.6 })
    const geometry = visibilityBetweenModels(viewer, target, [terrainWithWall(2)])
    const analysis = interpretVisibility(geometry, 'objects-block', 'any-to-all')

    expect(analysis.visible).toBe(false)
    expect(analysis.objectsCrossed.map((entry) => entry.objectId)).toContain('wall')
    expect(analysis.segments.length).toBeGreaterThan(1)
  })

  it('uses actual rotated non-circular silhouettes rather than a bounding proxy', () => {
    const viewer = model('viewer', 0, 0)
    const ellipse = { shape: 'ellipse' as const, widthMm: 101.6, heightMm: 25.4 }
    const wall = terrainWithWall(1.5)
    const horizontal = interpretVisibility(
      visibilityBetweenModels(viewer, model('target', 10, 0, ellipse, 0), [wall]),
      'objects-block',
      'any-to-any',
    )
    const vertical = interpretVisibility(
      visibilityBetweenModels(viewer, model('target', 10, 0, ellipse, Math.PI / 2), [wall]),
      'objects-block',
      'any-to-any',
    )

    expect(horizontal.visible).toBe(false)
    expect(vertical.visible).toBe(true)
  })

  it('keeps terrain geometry facts separate from mode and policy interpretation', () => {
    const geometry = visibilityBetweenModels(
      model('viewer', 0, 0),
      model('target', 10, 0),
      [terrainWithWall(2, 10)],
    )
    const baseBlocks = interpretVisibility(geometry, 'base-blocks', 'any-to-any')
    const objectsBlock = interpretVisibility(geometry, 'objects-block', 'any-to-any')
    const nothingBlocks = interpretVisibility(geometry, 'nothing-blocks', 'any-to-all')

    expect(baseBlocks.visible).toBe(false)
    expect(objectsBlock.visible).toBe(true)
    expect(nothingBlocks.visible).toBe(true)
    expect(geometry.anyToAny.length).toBeGreaterThan(1)
    expect(geometry.anyToAll.length).toBeGreaterThan(1)
  })
})
