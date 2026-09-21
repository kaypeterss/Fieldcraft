import type { Battlefield, TabletopModel } from '../../domain/types'
import type { Point } from './point'
import { GEOMETRY_EPSILON } from './tolerance'
import { millimetersToInches } from '../units'

export function isPointInsideBattlefield(point: Point, battlefield: Battlefield): boolean {
  return point.x >= 0 && point.x <= battlefield.width && point.y >= 0 && point.y <= battlefield.height
}

export interface RectangleBounds { left: number; top: number; right: number; bottom: number }

export function circleIntersectsRectangle(center: Point, radius: number, rectangle: RectangleBounds): boolean {
  const closestX = Math.max(rectangle.left, Math.min(center.x, rectangle.right))
  const closestY = Math.max(rectangle.top, Math.min(center.y, rectangle.bottom))
  const dx = center.x - closestX
  const dy = center.y - closestY
  return dx * dx + dy * dy <= radius * radius
}

export function clampModelPosition(
  position: Point,
  model: Pick<TabletopModel, 'base'>,
  battlefield: Battlefield,
): Point {
  const radius = millimetersToInches(model.base.diameterMm) / 2
  return {
    x: Math.min(battlefield.width - radius, Math.max(radius, position.x)),
    y: Math.min(battlefield.height - radius, Math.max(radius, position.y)),
  }
}

export function isModelPositionInsideBattlefield(
  position: Point,
  model: Pick<TabletopModel, 'base'>,
  battlefield: Battlefield,
): boolean {
  const radius = millimetersToInches(model.base.diameterMm) / 2
  return position.x >= radius - GEOMETRY_EPSILON
    && position.x <= battlefield.width - radius + GEOMETRY_EPSILON
    && position.y >= radius - GEOMETRY_EPSILON
    && position.y <= battlefield.height - radius + GEOMETRY_EPSILON
}

export function clampGroupDelta(
  requestedDelta: Point,
  models: ReadonlyArray<Pick<TabletopModel, 'position' | 'base'>>,
  battlefield: Battlefield,
): Point {
  if (models.length === 0) return { x: 0, y: 0 }

  let minDx = Number.NEGATIVE_INFINITY
  let maxDx = Number.POSITIVE_INFINITY
  let minDy = Number.NEGATIVE_INFINITY
  let maxDy = Number.POSITIVE_INFINITY

  for (const model of models) {
    const radius = millimetersToInches(model.base.diameterMm) / 2
    minDx = Math.max(minDx, radius - model.position.x)
    maxDx = Math.min(maxDx, battlefield.width - radius - model.position.x)
    minDy = Math.max(minDy, radius - model.position.y)
    maxDy = Math.min(maxDy, battlefield.height - radius - model.position.y)
  }

  return {
    x: Math.min(maxDx, Math.max(minDx, requestedDelta.x)),
    y: Math.min(maxDy, Math.max(minDy, requestedDelta.y)),
  }
}
