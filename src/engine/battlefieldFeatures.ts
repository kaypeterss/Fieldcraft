import type { BattlefieldFeature, BattlefieldFeatureObject, Footprint, ObjectiveArea, Pose } from '../domain/types'
import { createPose, transformFootprintPoint } from './geometry/footprints'
import { inchesToMillimeters } from './units'

/** Compose a feature-local pose without caching transformed geometry in state. */
export function featureLocalToWorldPose(featurePose: Pose, localPose: Pose): Pose {
  return createPose(
    transformFootprintPoint(featurePose, localPose.position),
    featurePose.rotation + localPose.rotation,
  )
}

export function featureObjectWorldPose(feature: BattlefieldFeature, object: BattlefieldFeatureObject): Pose {
  return featureLocalToWorldPose(feature.pose, object.localPose)
}

export function featureObjectiveArea(feature: BattlefieldFeature): { footprint: Footprint; pose: Pose } | null {
  const area: ObjectiveArea | undefined = feature.capabilities.objective?.area
  if (!area) return null
  switch (area.type) {
    case 'feature-base': return { footprint: feature.baseArea, pose: feature.pose }
    case 'local-footprint': return { footprint: area.footprint, pose: featureLocalToWorldPose(feature.pose, area.localPose) }
    case 'point-range':
      if (!Number.isFinite(area.rangeInches) || area.rangeInches <= 0) throw new Error('Objective range must be positive and finite')
      return {
        footprint: { shape: 'circle', diameterMm: inchesToMillimeters(area.rangeInches * 2) },
        pose: createPose(transformFootprintPoint(feature.pose, area.localPoint)),
      }
    default: return assertNever(area)
  }
}

function assertNever(value: never): never { throw new Error(`Unsupported objective area: ${JSON.stringify(value)}`) }
