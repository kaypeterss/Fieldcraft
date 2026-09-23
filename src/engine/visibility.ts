import type { BattlefieldFeature, Footprint, Pose, TabletopModel } from '../domain/types'
import { featureObjectWorldPose } from './battlefieldFeatures'
import {
  closestPointsBetweenFootprints,
  footprintIntersectsSegment,
  footprintIntersectsSightCone,
  footprintOffsetOutline,
  footprintSupportPoint,
  poseForModel,
} from './geometry/footprints'
import { distanceBetween, type Point } from './geometry/point'

export type VisibilityMode = 'any-to-any' | 'any-to-all'
export type VisibilityPolicy = 'base-blocks' | 'objects-block' | 'nothing-blocks'

export interface VisibilityBaseCrossing {
  featureId: string
  featureName: string
}

export interface VisibilityObjectCrossing extends VisibilityBaseCrossing {
  objectId: string
  objectName: string
}

export interface VisibilityRelationship {
  startAnchor: Point
  endAnchor: Point
  distance: number
  basesCrossed: VisibilityBaseCrossing[]
  objectsCrossed: VisibilityObjectCrossing[]
}

export interface VisibilityViewpoint {
  viewerPoint: Point
  basesCrossed: VisibilityBaseCrossing[]
  objectsCrossed: VisibilityObjectCrossing[]
  displayRelationships: VisibilityRelationship[]
}

/** Policy-free, bounded footprint visibility facts for both supported modes. */
export interface VisibilityGeometryResult {
  viewerId: string
  targetId: string
  distance: number
  anyToAny: VisibilityRelationship[]
  anyToAll: VisibilityViewpoint[]
}

export interface VisibilityDisplaySegment {
  startAnchor: Point
  endAnchor: Point
  blocked: boolean
}

export interface VisibilityAnalysis {
  viewerId: string
  targetId: string
  distance: number
  mode: VisibilityMode
  policy: VisibilityPolicy
  visible: boolean
  basesCrossed: VisibilityBaseCrossing[]
  objectsCrossed: VisibilityObjectCrossing[]
  segments: VisibilityDisplaySegment[]
}

const SIGHT_BOUNDARY_SAMPLES = 16
const MAX_ALL_DISPLAY_SEGMENTS = 3

/**
 * Builds deterministic visibility witnesses from the actual rotated convex
 * footprints. Any-to-any uses a bounded set of support/tangent candidates.
 * Any-to-all tests the exact convex sight cone from each candidate viewpoint
 * to the complete target footprint.
 */
export function visibilityBetweenModels(
  viewer: TabletopModel,
  target: TabletopModel,
  features: readonly BattlefieldFeature[] = [],
): VisibilityGeometryResult {
  const viewerPose = poseForModel(viewer)
  const targetPose = poseForModel(target)
  const closest = closestPointsBetweenFootprints(viewer.base, viewerPose, target.base, targetPose)
  const viewerPoints = sightPoints(viewer.base, viewerPose, target.position)
  const targetPoints = sightPoints(target.base, targetPose, viewer.position)
  const anyToAny: VisibilityRelationship[] = []

  for (const start of viewerPoints) {
    for (const end of targetPoints) anyToAny.push(segmentRelationship(start, end, features))
  }

  const displayTargets = targetDisplayPoints(target.base, targetPose, viewer.position)
  const anyToAll = viewerPoints.map((viewerPoint): VisibilityViewpoint => ({
    viewerPoint,
    ...coneCrossings(viewerPoint, target.base, targetPose, features),
    displayRelationships: displayTargets.map((point) => segmentRelationship(viewerPoint, point, features)),
  }))

  return {
    viewerId: viewer.id,
    targetId: target.id,
    distance: closest.distance,
    anyToAny,
    anyToAll,
  }
}

/** Terrain policy and visibility meaning remain independent interpretations. */
export function interpretVisibility(
  geometry: VisibilityGeometryResult,
  policy: VisibilityPolicy,
  mode: VisibilityMode = 'any-to-any',
): VisibilityAnalysis {
  if (mode === 'any-to-any') {
    const chosen = chooseRelationship(geometry.anyToAny, policy)
    const blocked = chosen ? relationshipBlocked(chosen, policy) : true
    return {
      viewerId: geometry.viewerId,
      targetId: geometry.targetId,
      distance: geometry.distance,
      mode,
      policy,
      visible: !blocked,
      basesCrossed: chosen?.basesCrossed ?? [],
      objectsCrossed: chosen?.objectsCrossed ?? [],
      segments: chosen ? [{ startAnchor: chosen.startAnchor, endAnchor: chosen.endAnchor, blocked }] : [],
    }
  }

  const chosen = chooseViewpoint(geometry.anyToAll, policy)
  const blocked = chosen ? relationshipBlocked(chosen, policy) : true
  const display = chosen?.displayRelationships
    .slice()
    .sort((a, b) => blocked
      ? Number(relationshipBlocked(b, policy)) - Number(relationshipBlocked(a, policy))
      : Number(relationshipBlocked(a, policy)) - Number(relationshipBlocked(b, policy)))
    .slice(0, MAX_ALL_DISPLAY_SEGMENTS) ?? []
  return {
    viewerId: geometry.viewerId,
    targetId: geometry.targetId,
    distance: geometry.distance,
    mode,
    policy,
    visible: !blocked,
    basesCrossed: chosen?.basesCrossed ?? [],
    objectsCrossed: chosen?.objectsCrossed ?? [],
    segments: display.map((relationship) => ({
      startAnchor: relationship.startAnchor,
      endAnchor: relationship.endAnchor,
      blocked: relationshipBlocked(relationship, policy),
    })),
  }
}

export function visibilityModeLabel(mode: VisibilityMode): string {
  return mode === 'any-to-any' ? 'Any → Any' : 'Any → All'
}

export function visibilityPolicyLabel(policy: VisibilityPolicy): string {
  switch (policy) {
    case 'base-blocks': return 'Base Blocks'
    case 'objects-block': return 'Objects Block'
    case 'nothing-blocks': return 'Nothing Blocks'
  }
}

function sightPoints(footprint: Footprint, pose: Pose, otherCenter: Point): Point[] {
  const toward = { x: otherCenter.x - pose.position.x, y: otherCenter.y - pose.position.y }
  const perpendicular = { x: -toward.y, y: toward.x }
  return uniquePoints([
    { ...pose.position },
    footprintSupportPoint(footprint, pose, toward),
    footprintSupportPoint(footprint, pose, { x: -toward.x, y: -toward.y }),
    footprintSupportPoint(footprint, pose, perpendicular),
    footprintSupportPoint(footprint, pose, { x: -perpendicular.x, y: -perpendicular.y }),
    ...footprintOffsetOutline(footprint, pose, 0, SIGHT_BOUNDARY_SAMPLES),
  ])
}

function targetDisplayPoints(footprint: Footprint, pose: Pose, viewerCenter: Point): Point[] {
  const towardViewer = { x: viewerCenter.x - pose.position.x, y: viewerCenter.y - pose.position.y }
  const perpendicular = { x: -towardViewer.y, y: towardViewer.x }
  return uniquePoints([
    footprintSupportPoint(footprint, pose, towardViewer),
    footprintSupportPoint(footprint, pose, perpendicular),
    footprintSupportPoint(footprint, pose, { x: -perpendicular.x, y: -perpendicular.y }),
    ...footprintOffsetOutline(footprint, pose, 0, 16),
  ])
}

function segmentRelationship(
  startAnchor: Point,
  endAnchor: Point,
  features: readonly BattlefieldFeature[],
): VisibilityRelationship {
  return {
    startAnchor: { ...startAnchor },
    endAnchor: { ...endAnchor },
    distance: distanceBetween(startAnchor, endAnchor),
    ...segmentCrossings(startAnchor, endAnchor, features),
  }
}

function segmentCrossings(
  start: Point,
  end: Point,
  features: readonly BattlefieldFeature[],
): Pick<VisibilityRelationship, 'basesCrossed' | 'objectsCrossed'> {
  const basesCrossed: VisibilityBaseCrossing[] = []
  const objectsCrossed: VisibilityObjectCrossing[] = []
  for (const feature of features) {
    if (!feature.capabilities.terrain) continue
    if (footprintIntersectsSegment(feature.baseArea, feature.pose, start, end)) {
      basesCrossed.push({ featureId: feature.id, featureName: feature.name })
    }
    for (const object of feature.objects) {
      if (footprintIntersectsSegment(object.footprint, featureObjectWorldPose(feature, object), start, end)) {
        objectsCrossed.push({
          featureId: feature.id,
          featureName: feature.name,
          objectId: object.id,
          objectName: object.name,
        })
      }
    }
  }
  return { basesCrossed, objectsCrossed }
}

function coneCrossings(
  viewpoint: Point,
  targetFootprint: Footprint,
  targetPose: Pose,
  features: readonly BattlefieldFeature[],
): Pick<VisibilityRelationship, 'basesCrossed' | 'objectsCrossed'> {
  const basesCrossed: VisibilityBaseCrossing[] = []
  const objectsCrossed: VisibilityObjectCrossing[] = []
  for (const feature of features) {
    if (!feature.capabilities.terrain) continue
    if (footprintIntersectsSightCone(feature.baseArea, feature.pose, viewpoint, targetFootprint, targetPose)) {
      basesCrossed.push({ featureId: feature.id, featureName: feature.name })
    }
    for (const object of feature.objects) {
      if (footprintIntersectsSightCone(
        object.footprint,
        featureObjectWorldPose(feature, object),
        viewpoint,
        targetFootprint,
        targetPose,
      )) {
        objectsCrossed.push({
          featureId: feature.id,
          featureName: feature.name,
          objectId: object.id,
          objectName: object.name,
        })
      }
    }
  }
  return { basesCrossed, objectsCrossed }
}

function chooseRelationship(
  relationships: readonly VisibilityRelationship[],
  policy: VisibilityPolicy,
): VisibilityRelationship | undefined {
  return relationships.find((relationship) => !relationshipBlocked(relationship, policy))
    ?? relationships.slice().sort((a, b) => relationshipRank(a, policy) - relationshipRank(b, policy))[0]
}

function chooseViewpoint(
  viewpoints: readonly VisibilityViewpoint[],
  policy: VisibilityPolicy,
): VisibilityViewpoint | undefined {
  return viewpoints.find((viewpoint) => !relationshipBlocked(viewpoint, policy))
    ?? viewpoints.slice().sort((a, b) => relationshipRank(a, policy) - relationshipRank(b, policy))[0]
}

function relationshipBlocked(
  relationship: Pick<VisibilityRelationship, 'basesCrossed' | 'objectsCrossed'>,
  policy: VisibilityPolicy,
): boolean {
  if (policy === 'base-blocks') return relationship.basesCrossed.length > 0
  if (policy === 'objects-block') return relationship.objectsCrossed.length > 0
  return false
}

function relationshipRank(
  relationship: Pick<VisibilityRelationship, 'basesCrossed' | 'objectsCrossed'>,
  policy: VisibilityPolicy,
): number {
  if (policy === 'base-blocks') return relationship.basesCrossed.length
  if (policy === 'objects-block') return relationship.objectsCrossed.length
  return 0
}

function uniquePoints(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (!result.some((candidate) => distanceBetween(candidate, point) <= 1e-8)) result.push(point)
  }
  return result
}
