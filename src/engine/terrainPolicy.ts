import type { BattlefieldFeature, Footprint, Pose, PoseTrajectory, TabletopModel, TerrainPermissions, TerrainPolicyConfig } from '../domain/types'
import { featureObjectWorldPose } from './battlefieldFeatures'
import { modelAreaRelationship } from './areaRelationships'
import { footprintsOverlap, sweepFootprintTranslation } from './geometry/footprints'
import { distanceBetween } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export interface TerrainSurface {
  featureId: string
  objectId?: string
  name: string
  footprint: Footprint
  pose: Pose
}

/** Only Terrain-capable features contribute movement surfaces; Objective alone does not. */
export function terrainSurfaces(features: ReadonlyArray<BattlefieldFeature> = []): TerrainSurface[] {
  return features.flatMap((feature) => feature.capabilities.terrain ? [
    { featureId: feature.id, name: feature.name, footprint: feature.baseArea, pose: feature.pose },
    ...feature.objects.map((object) => ({
      featureId: feature.id, objectId: object.id, name: object.name,
      footprint: object.footprint, pose: featureObjectWorldPose(feature, object),
    })),
  ] : [])
}

export function terrainPermissionsFor(
  modelId: string,
  surface: TerrainSurface,
  policy: TerrainPolicyConfig,
): TerrainPermissions {
  const matching = policy.rules.filter((rule) => rule.featureId === surface.featureId
    && rule.objectId === surface.objectId
    && (rule.modelId === undefined || rule.modelId === modelId))
  return matching.find((rule) => rule.modelId === modelId)?.permissions
    ?? matching.find((rule) => rule.modelId === undefined)?.permissions
    ?? (surface.objectId === undefined ? policy.defaultBase : policy.defaultObject)
}

/** Ephemeral stationary geometry adapter for the existing exact footprint algorithms. */
export function terrainObstacleModels(
  model: TabletopModel,
  features: ReadonlyArray<BattlefieldFeature> | undefined,
  policy: TerrainPolicyConfig | undefined,
  purpose: 'cross' | 'finish',
): TabletopModel[] {
  if (!policy) return []
  return terrainSurfaces(features).filter((surface) => {
    const permissions = terrainPermissionsFor(model.id, surface, policy)
    return purpose === 'cross' ? !permissions.canCross : !(permissions.canEnter && permissions.canFinish)
  }).map((surface) => ({
    id: `terrain:${surface.featureId}:${surface.objectId ?? 'base'}`,
    unitId: 'terrain', ownerId: 'terrain',
    base: surface.footprint, position: { ...surface.pose.position }, rotation: surface.pose.rotation,
    canPassOverModels: false,
  }))
}

/** Surface contacts needed for one proposed translation, including finish-only bans. */
export function terrainMotionObstacles(
  model: TabletopModel,
  destinationPose: Pose,
  features: ReadonlyArray<BattlefieldFeature> | undefined,
  policy: TerrainPolicyConfig | undefined,
): TabletopModel[] {
  if (!policy) return []
  return terrainSurfaces(features).filter((surface) => {
    const permissions = terrainPermissionsFor(model.id, surface, policy)
    const endingInside = footprintsOverlap(model.base, destinationPose, surface.footprint, surface.pose)
    return endingInside
      ? !(permissions.canEnter && permissions.canFinish)
      : !permissions.canCross
  }).map((surface) => ({
    id: `terrain:${surface.featureId}:${surface.objectId ?? 'base'}`,
    unitId: 'terrain', ownerId: 'terrain', base: surface.footprint,
    position: { ...surface.pose.position }, rotation: surface.pose.rotation,
    canPassOverModels: false,
  }))
}

export function terrainDestinationLegal(
  model: TabletopModel,
  pose: Pose,
  features: ReadonlyArray<BattlefieldFeature> | undefined,
  policy: TerrainPolicyConfig | undefined,
): boolean {
  if (!policy) return true
  return terrainSurfaces(features).every((surface) => {
    if (!footprintsOverlap(model.base, pose, surface.footprint, surface.pose)) return true
    const permissions = terrainPermissionsFor(model.id, surface, policy)
    return permissions.canEnter && permissions.canFinish
  })
}

export function terrainRelationships(
  model: TabletopModel,
  features: ReadonlyArray<BattlefieldFeature> | undefined,
  policy: TerrainPolicyConfig | undefined,
) {
  if (!policy) return []
  return terrainSurfaces(features).flatMap((surface) => {
    const relationship = modelAreaRelationship(model, { footprint: surface.footprint, pose: surface.pose })
    return relationship.intersects ? [{
      featureId: surface.featureId, objectId: surface.objectId,
      name: surface.name, permissions: terrainPermissionsFor(model.id, surface, policy),
    }] : []
  })
}

export interface EffectiveTerrainFeaturePermissions {
  featureId: string
  featureName: string
  surfaces: Array<{ objectId?: string; name: string; permissions: TerrainPermissions }>
}

/** Effective policy for one model and only the explicitly relevant features. */
export function effectiveTerrainPermissions(
  modelId: string,
  features: ReadonlyArray<BattlefieldFeature> | undefined,
  policy: TerrainPolicyConfig | undefined,
  relevantFeatureIds: ReadonlySet<string>,
): EffectiveTerrainFeaturePermissions[] {
  if (!policy || relevantFeatureIds.size === 0) return []
  const surfaces = terrainSurfaces(features)
  return (features ?? []).filter((feature) => feature.capabilities.terrain
    && relevantFeatureIds.has(feature.id)).map((feature) => ({
    featureId: feature.id,
    featureName: feature.name,
    surfaces: surfaces.filter((surface) => surface.featureId === feature.id).map((surface) => ({
      objectId: surface.objectId,
      name: surface.objectId ? surface.name : 'Base',
      permissions: terrainPermissionsFor(modelId, surface, policy),
    })),
  }))
}

export interface TerrainMovementInteraction {
  featureId: string
  objectId?: string
  name: string
  permissions: TerrainPermissions
  startedInside: boolean
  entered: boolean
  crossed: boolean
  contacted: boolean
}

/** Derived only for an active movement session; history needs no new terrain event stream. */
export function movementTerrainInteractions(
  model: TabletopModel,
  trajectory: PoseTrajectory,
  features: ReadonlyArray<BattlefieldFeature> | undefined,
  policy: TerrainPolicyConfig | undefined,
): TerrainMovementInteraction[] {
  if (!policy) return []
  return terrainSurfaces(features).flatMap((surface) => {
    const permissions = terrainPermissionsFor(model.id, surface, policy)
    const overlaps = (pose: Pose) => footprintsOverlap(model.base, pose, surface.footprint, surface.pose)
    const startedInside = overlaps(trajectory.startPose)
    let entered = false
    let crossed = false
    let contacted = false
    let previous = trajectory.startPose
    for (const segment of trajectory.segments) {
      const next = segment.endPose
      const wasInside = overlaps(previous)
      const isInside = overlaps(next)
      if (!wasInside && isInside) entered = true
      if (wasInside && !isInside) crossed = true
      const length = distanceBetween(previous.position, next.position)
      if (!wasInside && !isInside && length > GEOMETRY_EPSILON
        && Math.abs(segment.angularDelta) <= GEOMETRY_EPSILON) {
        const translation = { x: next.position.x - previous.position.x,
          y: next.position.y - previous.position.y }
        const contact = sweepFootprintTranslation(
          model.base, previous, translation, surface.footprint, surface.pose,
        )
        if (contact) {
          const after = Math.min(1, contact.fraction + Math.min(0.001, 0.01 / length))
          const afterPose = { position: {
            x: previous.position.x + translation.x * after,
            y: previous.position.y + translation.y * after,
          }, rotation: previous.rotation }
          if (permissions.canCross && overlaps(afterPose)) crossed = true
          else contacted = true
        }
      }
      previous = next
    }
    return startedInside || entered || crossed || contacted
      ? [{ featureId: surface.featureId, objectId: surface.objectId, name: surface.name,
        permissions, startedInside, entered, crossed, contacted }]
      : []
  })
}
