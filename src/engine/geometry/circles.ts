import type { Point } from './point'
import { distanceBetween } from './point'
import type { TabletopModel } from '../../domain/types'
import { millimetersToInches } from '../units'
import { GEOMETRY_EPSILON } from './tolerance'

export function circularEdgeDistance(
  centerA: Point,
  radiusA: number,
  centerB: Point,
  radiusB: number,
): number {
  return Math.max(0, distanceBetween(centerA, centerB) - radiusA - radiusB)
}

export interface ClosestPointsResult {
  distance: number
  startAnchor: Point
  endAnchor: Point
}

export function closestPointsBetweenCircles(
  centerA: Point,
  radiusA: number,
  centerB: Point,
  radiusB: number,
): ClosestPointsResult {
  const dx = centerB.x - centerA.x
  const dy = centerB.y - centerA.y
  const centerDistance = Math.hypot(dx, dy)
  const direction = centerDistance <= GEOMETRY_EPSILON
    ? { x: 1, y: 0 }
    : { x: dx / centerDistance, y: dy / centerDistance }
  const distance = Math.max(0, centerDistance - radiusA - radiusB)

  if (distance > 0 || centerDistance >= radiusA + radiusB) {
    return {
      distance,
      startAnchor: {
        x: centerA.x + direction.x * radiusA,
        y: centerA.y + direction.y * radiusA,
      },
      endAnchor: {
        x: centerB.x - direction.x * radiusB,
        y: centerB.y - direction.y * radiusB,
      },
    }
  }

  const sharedStart = Math.max(-radiusA, centerDistance - radiusB)
  const sharedEnd = Math.min(radiusA, centerDistance + radiusB)
  const sharedOffset = (sharedStart + sharedEnd) / 2
  const shared = {
    x: centerA.x + direction.x * sharedOffset,
    y: centerA.y + direction.y * sharedOffset,
  }
  return { distance: 0, startAnchor: shared, endAnchor: { ...shared } }
}

export function closestPointsBetweenCircleAndPoint(
  center: Point,
  radius: number,
  point: Point,
): ClosestPointsResult {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const centerDistance = Math.hypot(dx, dy)
  if (centerDistance <= radius) {
    return { distance: 0, startAnchor: { ...point }, endAnchor: { ...point } }
  }
  const direction = { x: dx / centerDistance, y: dy / centerDistance }
  return {
    distance: centerDistance - radius,
    startAnchor: {
      x: center.x + direction.x * radius,
      y: center.y + direction.y * radius,
    },
    endAnchor: { ...point },
  }
}

export function circlesOverlap(
  centerA: Point,
  radiusA: number,
  centerB: Point,
  radiusB: number,
): boolean {
  return distanceBetween(centerA, centerB) < radiusA + radiusB - GEOMETRY_EPSILON
}

/** Returns the first interior intersection fraction along a center segment, or null. */
export function firstCirclePathCollisionT(
  start: Point,
  end: Point,
  obstacleCenter: Point,
  expandedRadius: number,
): number | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const a = dx * dx + dy * dy
  if (a === 0) return null

  const fx = start.x - obstacleCenter.x
  const fy = start.y - obstacleCenter.y
  const startDistance = Math.hypot(fx, fy)
  const startDelta = startDistance - expandedRadius
  const radialMotion = startDistance <= GEOMETRY_EPSILON
    ? 0
    : (fx * dx + fy * dy) / startDistance

  // Contact and tiny imported/synchronization overlaps are directional. A
  // move inward is blocked; a move away or tangent is allowed to escape.
  if (startDelta <= GEOMETRY_EPSILON) return radialMotion < -GEOMETRY_EPSILON ? 0 : null

  const c = fx * fx + fy * fy - expandedRadius * expandedRadius
  const b = 2 * (fx * dx + fy * dy)

  const discriminant = b * b - 4 * a * c
  if (discriminant <= 0) return null // tangent contact does not overlap

  const root = Math.sqrt(discriminant)
  const entry = (-b - root) / (2 * a)
  const exit = (-b + root) / (2 * a)
  return entry < 1 && exit > 0 ? Math.max(0, entry) : null
}

export function isGroupPlacementValid(
  allModels: ReadonlyArray<TabletopModel>,
  proposedPositions: ReadonlyMap<string, Point>,
): boolean {
  const movingIds = new Set(proposedPositions.keys())
  const movingModels = allModels.filter((model) => movingIds.has(model.id))

  for (const movingModel of movingModels) {
    const movingPosition = proposedPositions.get(movingModel.id) ?? movingModel.position
    const movingRadius = millimetersToInches(movingModel.base.diameterMm) / 2
    for (const otherModel of allModels) {
      if (movingIds.has(otherModel.id)) continue
      const otherRadius = millimetersToInches(otherModel.base.diameterMm) / 2
      if (circlesOverlap(movingPosition, movingRadius, otherModel.position, otherRadius)) return false
    }
  }
  return true
}
