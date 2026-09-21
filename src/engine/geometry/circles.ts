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
