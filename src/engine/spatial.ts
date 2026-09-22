import type { Footprint, TabletopModel } from '../domain/types'
import type { ClosestPointsResult } from './geometry/circles'
import {
  circleFootprintRadiusInches,
  closestPointsBetweenFootprints,
  closestPointsFromFootprintToPoint,
  footprintExclusionOutline,
  footprintOffsetOutline,
  footprintsOverlap,
  pointWithinFootprintOffset,
  poseForModel,
} from './geometry/footprints'
import type { Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export interface RangeQueryOptions {
  includeSource?: boolean
}

export interface UnitDistanceResult {
  distance: number
  sourceModelId: string
  targetModelId: string
  startAnchor: Point
  endAnchor: Point
}

export interface UnitPointDistanceResult {
  distance: number
  modelId: string
  modelAnchor: Point
  pointAnchor: Point
}

export function baseRadiusInches(base: Footprint): number {
  return circleFootprintRadiusInches(base)
}

/** Shortest physical distance between model bases in tabletop inches. */
export function distanceBetweenBases(a: TabletopModel, b: TabletopModel): number {
  return closestPointsBetweenBases(a, b).distance
}

export function closestPointsBetweenBases(a: TabletopModel, b: TabletopModel): ClosestPointsResult {
  return closestPointsBetweenFootprints(a.base, poseForModel(a), b.base, poseForModel(b))
}

/** Shortest distance from a model base to a tabletop point. */
export function distanceFromBaseToPoint(model: TabletopModel, point: Point): number {
  return closestPointsFromBaseToPoint(model, point).distance
}

export function closestPointsFromBaseToPoint(model: TabletopModel, point: Point): ClosestPointsResult {
  return closestPointsFromFootprintToPoint(model.base, poseForModel(model), point)
}

export function rangeRadiusForBase(base: Footprint, range: number): number {
  if (range < 0) throw new RangeError('Range cannot be negative')
  return baseRadiusInches(base) + range
}

/** Rendering outline for every point within range of the model's actual footprint. */
export function rangeOutlineForModel(
  model: TabletopModel,
  range: number,
  segmentCount?: number,
): Point[] {
  return footprintOffsetOutline(model.base, poseForModel(model), range, segmentCount)
}

/** Exact membership counterpart to rangeOutlineForModel. */
export function isPointWithinModelRangeArea(
  model: TabletopModel,
  point: Point,
  range: number,
): boolean {
  return pointWithinFootprintOffset(model.base, poseForModel(model), point, range)
}

export function isDistanceWithinRange(distance: number, range: number): boolean {
  return range >= 0 && distance <= range + GEOMETRY_EPSILON
}

export function modelsWithinRangeOfModel(
  source: TabletopModel,
  candidates: ReadonlyArray<TabletopModel>,
  range: number,
  options: RangeQueryOptions = {},
): TabletopModel[] {
  return candidates.filter((candidate) => (
    (options.includeSource || candidate.id !== source.id)
    && isDistanceWithinRange(distanceBetweenBases(source, candidate), range)
  ))
}

export function modelsWithinRangeOfUnit(
  sourceModels: ReadonlyArray<TabletopModel>,
  candidates: ReadonlyArray<TabletopModel>,
  range: number,
  options: RangeQueryOptions = {},
): TabletopModel[] {
  const sourceIds = new Set(sourceModels.map((model) => model.id))
  return candidates.filter((candidate) => (
    (options.includeSource || !sourceIds.has(candidate.id))
    && sourceModels.some((source) => isDistanceWithinRange(distanceBetweenBases(source, candidate), range))
  ))
}

/** Returns null when either unit has no models. */
export function minimumDistanceBetweenUnits(
  sourceModels: ReadonlyArray<TabletopModel>,
  targetModels: ReadonlyArray<TabletopModel>,
): UnitDistanceResult | null {
  let closest: UnitDistanceResult | null = null
  for (const source of sourceModels) {
    for (const target of targetModels) {
      const closestPoints = closestPointsBetweenBases(source, target)
      const distance = closestPoints.distance
      if (!closest || distance < closest.distance) {
        closest = {
          distance,
          sourceModelId: source.id,
          targetModelId: target.id,
          startAnchor: closestPoints.startAnchor,
          endAnchor: closestPoints.endAnchor,
        }
      }
    }
  }
  return closest
}

/** Returns null when the unit has no models. */
export function minimumDistanceFromUnitToPoint(
  models: ReadonlyArray<TabletopModel>,
  point: Point,
): UnitPointDistanceResult | null {
  let closest: UnitPointDistanceResult | null = null
  for (const model of models) {
    const closestPoints = closestPointsFromBaseToPoint(model, point)
    if (!closest || closestPoints.distance < closest.distance) {
      closest = {
        distance: closestPoints.distance,
        modelId: model.id,
        modelAnchor: closestPoints.startAnchor,
        pointAnchor: closestPoints.endAnchor,
      }
    }
  }
  return closest
}

/**
 * Radius around a source center in which a target base center would fail the
 * requested base-edge separation. This is geometry only; it enforces no rule.
 */
export function exclusionRadiusForTargetBase(
  source: TabletopModel,
  targetBase: Footprint,
  requiredSeparation: number,
): number {
  if (requiredSeparation < 0) throw new RangeError('Required separation cannot be negative')
  return baseRadiusInches(source.base) + requiredSeparation + baseRadiusInches(targetBase)
}

/**
 * Rendering outline for target origins that violate the required edge gap at
 * one fixed target orientation.
 */
export function exclusionOutlineForTargetFootprint(
  source: TabletopModel,
  targetFootprint: Footprint,
  targetRotation: number,
  requiredSeparation: number,
  segmentCount?: number,
): Point[] {
  return footprintExclusionOutline(
    source.base,
    poseForModel(source),
    targetFootprint,
    targetRotation,
    requiredSeparation,
    segmentCount,
  )
}

/** Boundary contact is legal; only centers meaningfully inside the zone violate it. */
export function isTargetCenterWithinExclusionZone(
  source: TabletopModel,
  targetCenter: Point,
  targetBase: Footprint,
  requiredSeparation: number,
  targetRotation = 0,
): boolean {
  if (requiredSeparation < 0) throw new RangeError('Required separation cannot be negative')
  const targetPose = { position: targetCenter, rotation: targetRotation }
  if (footprintsOverlap(source.base, poseForModel(source), targetBase, targetPose)) return true
  return closestPointsBetweenFootprints(
    source.base,
    poseForModel(source),
    targetBase,
    targetPose,
  ).distance < requiredSeparation - GEOMETRY_EPSILON
}
