import type { CircularBase, TabletopModel } from '../domain/types'
import {
  circularEdgeDistance,
  closestPointsBetweenCircleAndPoint,
  closestPointsBetweenCircles,
  type ClosestPointsResult,
} from './geometry/circles'
import { distanceBetween } from './geometry/point'
import type { Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { millimetersToInches } from './units'

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

export function baseRadiusInches(base: CircularBase): number {
  return millimetersToInches(base.diameterMm) / 2
}

/** Shortest physical distance between model bases in tabletop inches. */
export function distanceBetweenBases(a: TabletopModel, b: TabletopModel): number {
  return circularEdgeDistance(
    a.position,
    baseRadiusInches(a.base),
    b.position,
    baseRadiusInches(b.base),
  )
}

export function closestPointsBetweenBases(a: TabletopModel, b: TabletopModel): ClosestPointsResult {
  return closestPointsBetweenCircles(
    a.position,
    baseRadiusInches(a.base),
    b.position,
    baseRadiusInches(b.base),
  )
}

/** Shortest distance from a model base to a tabletop point. */
export function distanceFromBaseToPoint(model: TabletopModel, point: Point): number {
  return Math.max(0, distanceBetween(model.position, point) - baseRadiusInches(model.base))
}

export function closestPointsFromBaseToPoint(model: TabletopModel, point: Point): ClosestPointsResult {
  return closestPointsBetweenCircleAndPoint(model.position, baseRadiusInches(model.base), point)
}

export function rangeRadiusForBase(base: CircularBase, range: number): number {
  if (range < 0) throw new RangeError('Range cannot be negative')
  return baseRadiusInches(base) + range
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
  targetBase: CircularBase,
  requiredSeparation: number,
): number {
  if (requiredSeparation < 0) throw new RangeError('Required separation cannot be negative')
  return baseRadiusInches(source.base) + requiredSeparation + baseRadiusInches(targetBase)
}

/** Boundary contact is legal; only centers meaningfully inside the zone violate it. */
export function isTargetCenterWithinExclusionZone(
  source: TabletopModel,
  targetCenter: Point,
  targetBase: CircularBase,
  requiredSeparation: number,
): boolean {
  return distanceBetween(source.position, targetCenter)
    < exclusionRadiusForTargetBase(source, targetBase, requiredSeparation) - GEOMETRY_EPSILON
}
