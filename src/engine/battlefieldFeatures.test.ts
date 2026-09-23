import { describe, expect, it } from 'vitest'
import type { BattlefieldFeature } from '../domain/types'
import { battlefieldFeatureDemoFeatures, battlefieldFeatureDemoGameState } from '../game/battlefieldFeatureDemo'
import { featureLocalToWorldPose, featureObjectWorldPose, featureObjectiveArea } from './battlefieldFeatures'
import { footprintInsideBattlefield, validateFootprint } from './geometry/footprints'

describe('BattlefieldFeature foundation', () => {
  it('keeps feature, capability, and child data JSON-safe', () => {
    const cloned = structuredClone(battlefieldFeatureDemoGameState)
    expect(JSON.parse(JSON.stringify(cloned))).toEqual(battlefieldFeatureDemoGameState)
    expect(cloned.battlefieldFeatures).toEqual(battlefieldFeatureDemoFeatures)
    for (const feature of cloned.battlefieldFeatures ?? []) {
      validateFootprint(feature.baseArea)
      feature.objects.forEach((object) => validateFootprint(object.footprint))
    }
  })

  it('composes child-local position and rotation with the parent pose', () => {
    const parent = { position: { x: 10, y: 20 }, rotation: Math.PI / 2 }
    const local = { position: { x: 2, y: 1 }, rotation: Math.PI * 1.75 }
    const world = featureLocalToWorldPose(parent, local)
    expect(world.position.x).toBeCloseTo(9)
    expect(world.position.y).toBeCloseTo(22)
    expect(world.rotation).toBeCloseTo(Math.PI / 4)
    const feature = battlefieldFeatureDemoFeatures[0]
    expect(featureObjectWorldPose(feature, feature.objects[0])).toEqual(
      featureLocalToWorldPose(feature.pose, feature.objects[0].localPose),
    )
  })

  it('lets Terrain and Objective share the same irregular base exactly', () => {
    const feature = battlefieldFeatureDemoFeatures.find((item) => item.id === 'demo-combined')!
    expect(feature.baseArea.shape).toBe('polygon')
    expect(feature.capabilities.terrain).toBeDefined()
    expect(feature.capabilities.objective).toBeDefined()
    expect(featureObjectiveArea(feature)).toEqual({ footprint: feature.baseArea, pose: feature.pose })
  })

  it('supports a distinct objective footprint in parent-local coordinates', () => {
    const feature: BattlefieldFeature = {
      ...battlefieldFeatureDemoFeatures[0],
      capabilities: { objective: { type: 'objective', area: {
        type: 'local-footprint', footprint: { shape: 'ellipse', widthMm: 90, heightMm: 45 },
        localPose: { position: { x: 1, y: 0 }, rotation: Math.PI / 3 },
      } } },
    }
    expect(featureObjectiveArea(feature)).toEqual({
      footprint: feature.capabilities.objective?.area.type === 'local-footprint'
        ? feature.capabilities.objective.area.footprint : undefined,
      pose: featureLocalToWorldPose(feature.pose, { position: { x: 1, y: 0 }, rotation: Math.PI / 3 }),
    })
  })

  it('starts every demo base and child footprint inside the battlefield', () => {
    for (const feature of battlefieldFeatureDemoFeatures) {
      expect(footprintInsideBattlefield(feature.baseArea, feature.pose, battlefieldFeatureDemoGameState.battlefield)).toBe(true)
      const objective = featureObjectiveArea(feature)
      if (objective) expect(footprintInsideBattlefield(objective.footprint, objective.pose,
        battlefieldFeatureDemoGameState.battlefield)).toBe(true)
      for (const object of feature.objects) {
        expect(footprintInsideBattlefield(
          object.footprint, featureObjectWorldPose(feature, object), battlefieldFeatureDemoGameState.battlefield,
        )).toBe(true)
      }
    }
  })
})
