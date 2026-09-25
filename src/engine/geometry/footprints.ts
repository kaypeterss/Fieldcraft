import type {
  Battlefield,
  Footprint,
  PolygonFootprint,
  Pose,
  TabletopModel,
} from '../../domain/types'
import { millimetersToInches } from '../units'
import {
  circlesOverlap,
  closestPointsBetweenCircleAndPoint,
  closestPointsBetweenCircles,
  type ClosestPointsResult,
  type RectangleBounds,
} from './circles'
import { distanceBetween, type Point } from './point'
import { GEOMETRY_EPSILON } from './tolerance'

export type FootprintBounds = RectangleBounds

export interface FootprintSweepContact {
  /** Earliest safe fraction of the requested translation, in [0, 1). */
  fraction: number
  /** Separating normal pointing from the obstacle toward the moving footprint. */
  normal: Point
}

const GJK_MAX_ITERATIONS = 64
const POLYGON_EPSILON_MM = 1e-7
const SWEEP_MAX_ITERATIONS = 48
const SWEEP_DISTANCE_TOLERANCE = 1e-8

export class InvalidFootprintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFootprintError'
  }
}

export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) throw new RangeError('Rotation must be finite')
  const fullTurn = Math.PI * 2
  const normalized = ((rotation % fullTurn) + fullTurn) % fullTurn
  return Object.is(normalized, -0) ? 0 : normalized
}

export function createPose(position: Point, rotation = 0): Pose {
  assertFinitePoint(position, 'Pose position')
  return { position: { ...position }, rotation: normalizeRotation(rotation) }
}

export function poseForModel(
  model: Pick<TabletopModel, 'position' | 'rotation'>,
  position: Point = model.position,
): Pose {
  return createPose(position, model.rotation)
}

/** Positive angles rotate clockwise because tabletop +Y points down. */
export function transformFootprintPoint(pose: Pose, localPoint: Point): Point {
  const rotation = normalizeRotation(pose.rotation)
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return {
    x: pose.position.x + localPoint.x * cosine - localPoint.y * sine,
    y: pose.position.y + localPoint.x * sine + localPoint.y * cosine,
  }
}

/** Builds the canonical, convex polygon representation accepted by the engine. */
export function createPolygonFootprint(verticesMm: readonly Point[]): PolygonFootprint {
  const vertices = verticesMm.map((vertex) => ({ ...vertex }))
  if (vertices.length > 1 && pointsEqual(vertices[0], vertices[vertices.length - 1], POLYGON_EPSILON_MM)) {
    vertices.pop()
  }

  validatePolygonVertices(vertices)
  if (signedPolygonArea(vertices) < 0) vertices.reverse()
  return { shape: 'polygon', verticesMm: vertices }
}

/** Validates serialized footprint data without adding runtime state or caches. */
export function validateFootprint(footprint: Footprint): void {
  switch (footprint.shape) {
    case 'circle':
      assertPositiveFinite(footprint.diameterMm, 'Circle diameter')
      return
    case 'ellipse':
    case 'rectangle':
      assertPositiveFinite(footprint.widthMm, `${capitalize(footprint.shape)} width`)
      assertPositiveFinite(footprint.heightMm, `${capitalize(footprint.shape)} height`)
      return
    case 'polygon':
      validatePolygonVertices(footprint.verticesMm)
      if (signedPolygonArea(footprint.verticesMm) < 0) {
        throw new InvalidFootprintError('Polygon vertices must use canonical clockwise tabletop winding')
      }
      return
    default:
      return assertNever(footprint)
  }
}

export function circleFootprintRadiusInches(footprint: Footprint): number {
  if (footprint.shape !== 'circle') {
    throw new InvalidFootprintError(`A circular footprint is required, received ${footprint.shape}`)
  }
  validateFootprint(footprint)
  return millimetersToInches(footprint.diameterMm) / 2
}

/**
 * Exact maximum distance from the pose origin to any point on the footprint.
 * This is a geometry fact used by conservative sweeps and movement policies.
 */
export function footprintCircumradiusInches(footprint: Footprint): number {
  validateFootprint(footprint)
  switch (footprint.shape) {
    case 'circle':
      return millimetersToInches(footprint.diameterMm) / 2
    case 'ellipse':
      return millimetersToInches(Math.max(footprint.widthMm, footprint.heightMm)) / 2
    case 'rectangle':
      return Math.hypot(
        millimetersToInches(footprint.widthMm) / 2,
        millimetersToInches(footprint.heightMm) / 2,
      )
    case 'polygon':
      return Math.max(...footprint.verticesMm.map((vertex) => Math.hypot(
        millimetersToInches(vertex.x),
        millimetersToInches(vertex.y),
      )))
    default:
      return assertNever(footprint)
  }
}

export function footprintBounds(footprint: Footprint, pose: Pose): FootprintBounds {
  const shape = createSupportShape(footprint, pose)
  const left = shape.support({ x: -1, y: 0 }).x
  const right = shape.support({ x: 1, y: 0 }).x
  const top = shape.support({ x: 0, y: -1 }).y
  const bottom = shape.support({ x: 0, y: 1 }).y
  return { left, top, right, bottom }
}

export function footprintContainsPoint(footprint: Footprint, pose: Pose, point: Point): boolean {
  assertFinitePoint(point, 'Point')
  const result = closestBetweenShapes(
    createSupportShape(footprint, pose),
    createPointShape(point),
  )
  return result.distance <= GEOMETRY_EPSILON
}

export function footprintIntersectsRectangle(
  footprint: Footprint,
  pose: Pose,
  rectangle: RectangleBounds,
): boolean {
  validateRectangleBounds(rectangle)
  const rectangleShape = createVertexShape([
    { x: rectangle.left, y: rectangle.top },
    { x: rectangle.right, y: rectangle.top },
    { x: rectangle.right, y: rectangle.bottom },
    { x: rectangle.left, y: rectangle.bottom },
  ])
  return closestBetweenShapes(createSupportShape(footprint, pose), rectangleShape).distance
    <= GEOMETRY_EPSILON
}

/** Exact intersection between a finite tabletop segment and a convex footprint. */
export function footprintIntersectsSegment(
  footprint: Footprint,
  pose: Pose,
  start: Point,
  end: Point,
): boolean {
  assertFinitePoint(start, 'Segment start')
  assertFinitePoint(end, 'Segment end')
  return closestBetweenShapes(
    createSupportShape(footprint, pose),
    createVertexShape([start, end]),
  ).distance <= GEOMETRY_EPSILON
}

/**
 * Exact intersection between a convex footprint and the complete sight region
 * from one viewpoint to a convex target footprint. The sight region is the
 * convex hull of the viewpoint and target, represented directly by support
 * mapping rather than a bounding shape or sampled target boundary.
 */
export function footprintIntersectsSightCone(
  footprint: Footprint,
  pose: Pose,
  viewpoint: Point,
  targetFootprint: Footprint,
  targetPose: Pose,
): boolean {
  assertFinitePoint(viewpoint, 'Sight viewpoint')
  const target = createSupportShape(targetFootprint, targetPose)
  const cone: SupportShape = {
    center: scale(add(viewpoint, target.center), 0.5),
    support: (direction) => {
      const targetPoint = target.support(direction)
      return dot(viewpoint, direction) > dot(targetPoint, direction)
        ? { ...viewpoint }
        : targetPoint
    },
  }
  return closestBetweenShapes(createSupportShape(footprint, pose), cone).distance
    <= GEOMETRY_EPSILON
}

export function closestPointsBetweenFootprints(
  footprintA: Footprint,
  poseA: Pose,
  footprintB: Footprint,
  poseB: Pose,
): ClosestPointsResult {
  // Preserve the long-proven circle path bit-for-bit for M6.0/M6.1 parity.
  if (footprintA.shape === 'circle' && footprintB.shape === 'circle') {
    return closestPointsBetweenCircles(
      poseA.position,
      circleFootprintRadiusInches(footprintA),
      poseB.position,
      circleFootprintRadiusInches(footprintB),
    )
  }

  const closest = closestBetweenShapes(
    createSupportShape(footprintA, poseA),
    createSupportShape(footprintB, poseB),
  )
  return {
    distance: closest.distance,
    startAnchor: closest.startAnchor,
    endAnchor: closest.endAnchor,
  }
}

export function closestPointsFromFootprintToPoint(
  footprint: Footprint,
  pose: Pose,
  point: Point,
): ClosestPointsResult {
  assertFinitePoint(point, 'Point')
  if (footprint.shape === 'circle') {
    return closestPointsBetweenCircleAndPoint(
      pose.position,
      circleFootprintRadiusInches(footprint),
      point,
    )
  }
  const closest = closestBetweenShapes(createSupportShape(footprint, pose), createPointShape(point))
  return {
    distance: closest.distance,
    startAnchor: closest.startAnchor,
    endAnchor: closest.endAnchor,
  }
}

/** Strict overlap: external tangency remains a legal, non-overlapping contact. */
export function footprintsOverlap(
  footprintA: Footprint,
  poseA: Pose,
  footprintB: Footprint,
  poseB: Pose,
): boolean {
  if (footprintA.shape === 'circle' && footprintB.shape === 'circle') {
    return circlesOverlap(
      poseA.position,
      circleFootprintRadiusInches(footprintA),
      poseB.position,
      circleFootprintRadiusInches(footprintB),
    )
  }
  if (isSmoothFootprint(footprintA) && isFlatFootprint(footprintB)) {
    return smoothPolygonOverlap(footprintA, poseA, footprintB, poseB)
  }
  if (isFlatFootprint(footprintA) && isSmoothFootprint(footprintB)) {
    return smoothPolygonOverlap(footprintB, poseB, footprintA, poseA)
  }
  const shapeA = createSupportShape(footprintA, poseA)
  const shapeB = createSupportShape(footprintB, poseB)
  // GJK's origin simplex can classify a near-tangent polygon edge as a tiny
  // penetration. A separating flat-face axis is an exact non-overlap witness,
  // especially important when repeated drag updates slide along that face.
  if (isFlatFootprint(footprintA) && isFlatFootprint(footprintB)) {
    return !flatFaceAxesSeparate(footprintA, poseA, footprintB, poseB, shapeA, shapeB)
  }
  return closestBetweenShapes(shapeA, shapeB).overlapping
}

/** Geometric inclusion, independent of terrain or objective rules. Boundary contact counts as within. */
export function footprintContainsFootprint(
  area: Footprint,
  areaPose: Pose,
  inner: Footprint,
  innerPose: Pose,
): boolean {
  validateFootprint(area)
  validateFootprint(inner)
  if (isFlatFootprint(area)) {
    const vertices = flatWorldVertices(area, areaPose)
    return vertices.every((vertex, index) => {
      const next = vertices[(index + 1) % vertices.length]
      const outward = safeDirection({ x: next.y - vertex.y, y: vertex.x - next.x })
      const extreme = footprintSupportPoint(inner, innerPose, outward)
      return dot(subtract(extreme, vertex), outward) <= GEOMETRY_EPSILON
    })
  }
  const radiusX = millimetersToInches(area.shape === 'circle' ? area.diameterMm : area.widthMm) / 2
  const radiusY = millimetersToInches(area.shape === 'circle' ? area.diameterMm : area.heightMm) / 2
  const normalized = (point: Point) => {
    const local = inverseRotate(subtract(point, areaPose.position), areaPose.rotation)
    return { x: local.x / radiusX, y: local.y / radiusY }
  }
  const tolerance = GEOMETRY_EPSILON / Math.min(radiusX, radiusY)
  if (isFlatFootprint(inner)) {
    return flatWorldVertices(inner, innerPose).every((vertex) => lengthSquared(normalized(vertex)) <= (1 + tolerance) ** 2)
  }
  if (area.shape === 'circle' && inner.shape === 'circle') {
    return Math.hypot(innerPose.position.x - areaPose.position.x, innerPose.position.y - areaPose.position.y)
      + millimetersToInches(inner.diameterMm) / 2 <= radiusX + GEOMETRY_EPSILON
  }
  // A smooth inner boundary is parameterized exactly. Its transformed squared
  // radius is a degree-two trigonometric polynomial, with at most four extrema.
  // Bracket every derivative sign change deterministically, then bisect roots.
  const innerX = millimetersToInches(inner.shape === 'circle' ? inner.diameterMm : inner.widthMm) / 2
  const innerY = millimetersToInches(inner.shape === 'circle' ? inner.diameterMm : inner.heightMm) / 2
  const pointAt = (angle: number) => normalized(transformFootprintPoint(innerPose, {
    x: innerX * Math.cos(angle), y: innerY * Math.sin(angle),
  }))
  const derivativeAt = (angle: number) => {
    const point = pointAt(angle)
    const velocity = inverseRotate({
      x: -innerX * Math.sin(angle) * Math.cos(innerPose.rotation) - innerY * Math.cos(angle) * Math.sin(innerPose.rotation),
      y: -innerX * Math.sin(angle) * Math.sin(innerPose.rotation) + innerY * Math.cos(angle) * Math.cos(innerPose.rotation),
    }, areaPose.rotation)
    return 2 * (point.x * velocity.x / radiusX + point.y * velocity.y / radiusY)
  }
  const steps = 128
  let maximum = 0
  for (let index = 0; index < steps; index += 1) {
    let left = index * 2 * Math.PI / steps
    let right = (index + 1) * 2 * Math.PI / steps
    let derivativeLeft = derivativeAt(left)
    const derivativeRight = derivativeAt(right)
    maximum = Math.max(maximum, lengthSquared(pointAt(left)))
    if (derivativeLeft * derivativeRight < 0) {
      for (let iteration = 0; iteration < 50; iteration += 1) {
        const middle = (left + right) / 2
        const derivativeMiddle = derivativeAt(middle)
        if (derivativeLeft * derivativeMiddle <= 0) right = middle
        else { left = middle; derivativeLeft = derivativeMiddle }
      }
      maximum = Math.max(maximum, lengthSquared(pointAt((left + right) / 2)))
    }
  }
  return maximum <= (1 + tolerance) ** 2
}

function isSmoothFootprint(footprint: Footprint): footprint is Extract<Footprint, { shape: 'circle' | 'ellipse' }> {
  return footprint.shape === 'circle' || footprint.shape === 'ellipse'
}

function isFlatFootprint(footprint: Footprint): footprint is Extract<Footprint, { shape: 'rectangle' | 'polygon' }> {
  return footprint.shape === 'rectangle' || footprint.shape === 'polygon'
}

/** Exact ellipse/convex-polygon overlap after mapping the ellipse to a unit circle. */
function smoothPolygonOverlap(
  smooth: Extract<Footprint, { shape: 'circle' | 'ellipse' }>,
  smoothPose: Pose,
  flat: Extract<Footprint, { shape: 'rectangle' | 'polygon' }>,
  flatPose: Pose,
): boolean {
  const radiusX = smooth.shape === 'circle'
    ? millimetersToInches(smooth.diameterMm) / 2 : millimetersToInches(smooth.widthMm) / 2
  const radiusY = smooth.shape === 'circle'
    ? radiusX : millimetersToInches(smooth.heightMm) / 2
  const vertices = flatWorldVertices(flat, flatPose).map((vertex) => {
    const local = inverseRotate(subtract(vertex, smoothPose.position), smoothPose.rotation)
    return { x: local.x / radiusX, y: local.y / radiusY }
  })
  const tolerance = GEOMETRY_EPSILON / Math.min(radiusX, radiusY)
  let inside = true
  let minimumDistanceSquared = Number.POSITIVE_INFINITY
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]
    const end = vertices[(index + 1) % vertices.length]
    const edge = subtract(end, start)
    if (cross(edge, negate(start)) < -tolerance) inside = false
    const fraction = clamp(-dot(start, edge) / lengthSquared(edge), 0, 1)
    minimumDistanceSquared = Math.min(minimumDistanceSquared,
      lengthSquared(add(start, scale(edge, fraction))))
  }
  return inside || minimumDistanceSquared < (1 - tolerance) ** 2
}

function flatFaceAxesSeparate(
  footprintA: Footprint,
  poseA: Pose,
  footprintB: Footprint,
  poseB: Pose,
  shapeA: SupportShape,
  shapeB: SupportShape,
): boolean {
  const axes = [...flatFaceAxes(footprintA, poseA), ...flatFaceAxes(footprintB, poseB)]
  return axes.some((axis) => {
    const maximumA = dot(shapeA.support(axis), axis)
    const minimumA = dot(shapeA.support(negate(axis)), axis)
    const maximumB = dot(shapeB.support(axis), axis)
    const minimumB = dot(shapeB.support(negate(axis)), axis)
    return maximumA <= minimumB + GEOMETRY_EPSILON
      || maximumB <= minimumA + GEOMETRY_EPSILON
  })
}

function flatFaceAxes(footprint: Footprint, pose: Pose): Point[] {
  if (footprint.shape === 'rectangle') {
    const cosine = Math.cos(pose.rotation)
    const sine = Math.sin(pose.rotation)
    return [{ x: cosine, y: sine }, { x: -sine, y: cosine }]
  }
  if (footprint.shape !== 'polygon') return []
  const vertices = flatWorldVertices(footprint, pose)
  return vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]
    return safeDirection({ x: next.y - vertex.y, y: vertex.x - next.x })
  })
}

function flatWorldVertices(
  footprint: Extract<Footprint, { shape: 'rectangle' | 'polygon' }>,
  pose: Pose,
): Point[] {
  const local = footprint.shape === 'rectangle'
    ? (() => {
        const halfWidth = millimetersToInches(footprint.widthMm) / 2
        const halfHeight = millimetersToInches(footprint.heightMm) / 2
        return [
          { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
          { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight },
        ]
      })()
    : footprint.verticesMm.map((vertex) => ({
        x: millimetersToInches(vertex.x), y: millimetersToInches(vertex.y),
      }))
  return local.map((point) => transformFootprintPoint(pose, point))
}

export function footprintInsideBattlefield(
  footprint: Footprint,
  pose: Pose,
  battlefield: Battlefield,
): boolean {
  assertPositiveFinite(battlefield.width, 'Battlefield width')
  assertPositiveFinite(battlefield.height, 'Battlefield height')
  const bounds = footprintBounds(footprint, pose)
  return bounds.left >= -GEOMETRY_EPSILON
    && bounds.right <= battlefield.width + GEOMETRY_EPSILON
    && bounds.top >= -GEOMETRY_EPSILON
    && bounds.bottom <= battlefield.height + GEOMETRY_EPSILON
}

/**
 * Samples the boundary of a footprint dilated by a circular tabletop distance.
 * The returned points are derived from the same exact support mapping used by
 * closest-point and overlap queries; sampling affects rendering only.
 */
export function footprintOffsetOutline(
  footprint: Footprint,
  pose: Pose,
  offset: number,
  segmentCount = 128,
): Point[] {
  assertNonNegativeFinite(offset, 'Footprint offset')
  const directions = outlineDirections(segmentCount)
  const shape = createSupportShape(footprint, pose)
  return directions.map((direction) => add(shape.support(direction), scale(direction, offset)))
}

/**
 * Samples the configuration-space exclusion boundary for a fixed target
 * orientation: source + reflected target + circular separation.
 */
export function footprintExclusionOutline(
  sourceFootprint: Footprint,
  sourcePose: Pose,
  targetFootprint: Footprint,
  targetRotation: number,
  requiredSeparation: number,
  segmentCount = 128,
): Point[] {
  assertNonNegativeFinite(requiredSeparation, 'Required separation')
  const directions = outlineDirections(segmentCount)
  const source = createSupportShape(sourceFootprint, sourcePose)
  const targetAtOrigin = createSupportShape(
    targetFootprint,
    createPose({ x: 0, y: 0 }, targetRotation),
  )
  return directions.map((direction) => add(
    subtract(source.support(direction), targetAtOrigin.support(negate(direction))),
    scale(direction, requiredSeparation),
  ))
}

/** Exact membership for a footprint plus circular offset; boundary is included. */
export function pointWithinFootprintOffset(
  footprint: Footprint,
  pose: Pose,
  point: Point,
  offset: number,
): boolean {
  assertNonNegativeFinite(offset, 'Footprint offset')
  return closestPointsFromFootprintToPoint(footprint, pose, point).distance
    <= offset + GEOMETRY_EPSILON
}

/**
 * Continuous fixed-orientation translation sweep for two convex footprints.
 * Conservative advancement uses exact closest-point distance and returns the
 * earliest safe contact together with its local separating normal.
 */
export function sweepFootprintTranslation(
  movingFootprint: Footprint,
  movingPose: Pose,
  translation: Point,
  obstacleFootprint: Footprint,
  obstaclePose: Pose,
): FootprintSweepContact | null {
  return sweepFootprintTranslationWithClearance(
    movingFootprint, movingPose, translation, obstacleFootprint, obstaclePose, 0,
  )
}

/** Continuous fixed-orientation sweep that stops at an exact edge separation. */
export function sweepFootprintTranslationWithClearance(
  movingFootprint: Footprint,
  movingPose: Pose,
  translation: Point,
  obstacleFootprint: Footprint,
  obstaclePose: Pose,
  minimumDistance: number,
): FootprintSweepContact | null {
  assertFinitePoint(translation, 'Sweep translation')
  assertNonNegativeFinite(minimumDistance, 'Sweep minimum distance')
  if (lengthSquared(translation) <= GEOMETRY_EPSILON ** 2) return null

  const poseAt = (fraction: number): Pose => createPose(
    add(movingPose.position, scale(translation, fraction)),
    movingPose.rotation,
  )
  const overlapsAt = (fraction: number) => footprintsOverlap(
    movingFootprint,
    poseAt(fraction),
    obstacleFootprint,
    obstaclePose,
  )

  let fraction = 0
  let previousNormal: Point | null = null

  const initialClosest = closestPointsBetweenFootprints(
    movingFootprint, movingPose, obstacleFootprint, obstaclePose,
  )
  if (overlapsAt(0) || initialClosest.distance <= minimumDistance + SWEEP_DISTANCE_TOLERANCE) {
    const normal = sweepContactNormal(
      movingFootprint,
      movingPose,
      translation,
      obstacleFootprint,
      obstaclePose,
      null,
    )
    return dot(translation, normal) < -GEOMETRY_EPSILON ? { fraction: 0, normal } : null
  }

  for (let iteration = 0; iteration < SWEEP_MAX_ITERATIONS; iteration += 1) {
    const pose = poseAt(fraction)
    const closest = closestPointsBetweenFootprints(
      movingFootprint,
      pose,
      obstacleFootprint,
      obstaclePose,
    )
    const separation = subtract(closest.startAnchor, closest.endAnchor)
    const separationLength = Math.sqrt(lengthSquared(separation))
    if (separationLength > GEOMETRY_EPSILON) {
      previousNormal = scale(separation, 1 / separationLength)
    }

    if (closest.distance <= minimumDistance + SWEEP_DISTANCE_TOLERANCE) {
      const normal = sweepContactNormal(
        movingFootprint,
        pose,
        translation,
        obstacleFootprint,
        obstaclePose,
        previousNormal,
      )
      return dot(translation, normal) < -GEOMETRY_EPSILON
        ? { fraction: Math.max(0, Math.min(1, fraction)), normal }
        : null
    }

    const normal = previousNormal ?? safeDirection(subtract(pose.position, obstaclePose.position))
    const closingSpeed = -dot(translation, normal)
    if (closingSpeed <= GEOMETRY_EPSILON) return null

    const step = Math.max(0, closest.distance - minimumDistance) / closingSpeed
    const previousFraction = fraction
    fraction += step
    if (fraction >= 1) {
      const endPose = poseAt(1)
      const endClosest = closestPointsBetweenFootprints(
        movingFootprint, endPose, obstacleFootprint, obstaclePose,
      )
      if (!overlapsAt(1) && endClosest.distance + SWEEP_DISTANCE_TOLERANCE >= minimumDistance) return null
      if (minimumDistance > 0 && !overlapsAt(1)) {
        return refineSweepClearanceContact(
          movingFootprint, movingPose, translation, obstacleFootprint, obstaclePose,
          minimumDistance, previousFraction, 1, previousNormal,
        )
      }
      return refineSweepContact(
        movingFootprint,
        movingPose,
        translation,
        obstacleFootprint,
        obstaclePose,
        previousFraction,
        1,
        previousNormal,
      )
    }
    if (overlapsAt(fraction)) {
      return refineSweepContact(
        movingFootprint,
        movingPose,
        translation,
        obstacleFootprint,
        obstaclePose,
        previousFraction,
        fraction,
        previousNormal,
      )
    }
  }

  return null
}

interface SupportShape {
  center: Point
  support(direction: Point): Point
}

interface SupportVertex {
  difference: Point
  pointA: Point
  pointB: Point
}

interface SimplexSolution {
  vertices: SupportVertex[]
  weights: number[]
  closest: Point
}

interface ClosestShapeResult extends ClosestPointsResult {
  overlapping: boolean
}

function createSupportShape(footprint: Footprint, pose: Pose): SupportShape {
  validateFootprint(footprint)
  const normalizedPose = createPose(pose.position, pose.rotation)

  switch (footprint.shape) {
    case 'circle': {
      const radius = millimetersToInches(footprint.diameterMm) / 2
      return {
        center: normalizedPose.position,
        support: (direction) => add(normalizedPose.position, scale(safeDirection(direction), radius)),
      }
    }
    case 'ellipse': {
      const radiusX = millimetersToInches(footprint.widthMm) / 2
      const radiusY = millimetersToInches(footprint.heightMm) / 2
      return {
        center: normalizedPose.position,
        support: (direction) => {
          const localDirection = inverseRotate(direction, normalizedPose.rotation)
          const denominator = Math.hypot(radiusX * localDirection.x, radiusY * localDirection.y)
          const local = denominator <= GEOMETRY_EPSILON
            ? { x: radiusX, y: 0 }
            : {
                x: radiusX * radiusX * localDirection.x / denominator,
                y: radiusY * radiusY * localDirection.y / denominator,
              }
          return transformFootprintPoint(normalizedPose, local)
        },
      }
    }
    case 'rectangle': {
      const halfWidth = millimetersToInches(footprint.widthMm) / 2
      const halfHeight = millimetersToInches(footprint.heightMm) / 2
      return {
        center: normalizedPose.position,
        support: (direction) => {
          const localDirection = inverseRotate(direction, normalizedPose.rotation)
          return transformFootprintPoint(normalizedPose, {
            x: localDirection.x >= 0 ? halfWidth : -halfWidth,
            y: localDirection.y >= 0 ? halfHeight : -halfHeight,
          })
        },
      }
    }
    case 'polygon': {
      const vertices = footprint.verticesMm.map((vertex) => transformFootprintPoint(normalizedPose, {
        x: millimetersToInches(vertex.x),
        y: millimetersToInches(vertex.y),
      }))
      return createVertexShape(vertices, normalizedPose.position)
    }
    default:
      return assertNever(footprint)
  }
}

/** Exact world-space support point for every currently supported convex footprint. */
export function footprintSupportPoint(
  footprint: Footprint,
  pose: Pose,
  direction: Point,
): Point {
  return createSupportShape(footprint, pose).support(safeDirection(direction))
}

function createPointShape(point: Point): SupportShape {
  return { center: { ...point }, support: () => ({ ...point }) }
}

function createVertexShape(vertices: readonly Point[], center?: Point): SupportShape {
  if (vertices.length === 0) throw new InvalidFootprintError('A support shape needs at least one vertex')
  vertices.forEach((vertex) => assertFinitePoint(vertex, 'Support vertex'))
  const shapeCenter = center ?? {
    x: vertices.reduce((sum, vertex) => sum + vertex.x, 0) / vertices.length,
    y: vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length,
  }
  return {
    center: shapeCenter,
    support: (direction) => {
      let result = vertices[0]
      let maximum = dot(result, direction)
      for (let index = 1; index < vertices.length; index += 1) {
        const projection = dot(vertices[index], direction)
        if (projection > maximum + GEOMETRY_EPSILON) {
          result = vertices[index]
          maximum = projection
        }
      }
      return { ...result }
    },
  }
}

function closestBetweenShapes(shapeA: SupportShape, shapeB: SupportShape): ClosestShapeResult {
  let direction = subtract(shapeB.center, shapeA.center)
  if (lengthSquared(direction) <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) direction = { x: 1, y: 0 }

  let simplex = solveSimplex([supportVertex(shapeA, shapeB, direction)])
  let previousDistanceSquared = Number.POSITIVE_INFINITY

  for (let iteration = 0; iteration < GJK_MAX_ITERATIONS; iteration += 1) {
    const distanceSquared = lengthSquared(simplex.closest)
    if (distanceSquared <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
      return resultAtOrigin(shapeA, shapeB, simplex)
    }

    direction = negate(simplex.closest)
    const next = supportVertex(shapeA, shapeB, direction)
    const progress = dot(next.difference, direction) - dot(simplex.closest, direction)
    if (progress <= GEOMETRY_EPSILON ** 2
      || previousDistanceSquared - distanceSquared <= GEOMETRY_EPSILON ** 2) {
      return resultFromSimplex(simplex, false)
    }

    previousDistanceSquared = distanceSquared
    simplex = solveSimplex([...simplex.vertices, next])
  }

  return resultFromSimplex(simplex, lengthSquared(simplex.closest) <= GEOMETRY_EPSILON ** 2)
}

function resultAtOrigin(
  shapeA: SupportShape,
  shapeB: SupportShape,
  simplex: SimplexSolution,
): ClosestShapeResult {
  let overlapping = simplex.vertices.length === 3
  if (!overlapping && simplex.vertices.length === 2) {
    const edge = subtract(simplex.vertices[1].difference, simplex.vertices[0].difference)
    const normal = safeDirection({ x: -edge.y, y: edge.x })
    const positiveExtent = dot(supportVertex(shapeA, shapeB, normal).difference, normal)
    const negativeExtent = dot(supportVertex(shapeA, shapeB, negate(normal)).difference, negate(normal))
    overlapping = positiveExtent > GEOMETRY_EPSILON && negativeExtent > GEOMETRY_EPSILON
  }
  return resultFromSimplex(simplex, overlapping)
}

function resultFromSimplex(simplex: SimplexSolution, overlapping: boolean): ClosestShapeResult {
  let pointA = { x: 0, y: 0 }
  let pointB = { x: 0, y: 0 }
  simplex.vertices.forEach((vertex, index) => {
    pointA = add(pointA, scale(vertex.pointA, simplex.weights[index]))
    pointB = add(pointB, scale(vertex.pointB, simplex.weights[index]))
  })
  const distance = overlapping ? 0 : distanceBetween(pointA, pointB)
  return { startAnchor: pointA, endAnchor: pointB, distance, overlapping }
}

function supportVertex(shapeA: SupportShape, shapeB: SupportShape, direction: Point): SupportVertex {
  const pointA = shapeA.support(direction)
  const pointB = shapeB.support(negate(direction))
  return { pointA, pointB, difference: subtract(pointA, pointB) }
}

function solveSimplex(vertices: SupportVertex[]): SimplexSolution {
  if (vertices.length === 1) {
    return { vertices, weights: [1], closest: vertices[0].difference }
  }
  if (vertices.length === 2) return solveSegment(vertices[0], vertices[1])
  return solveTriangle(vertices[vertices.length - 3], vertices[vertices.length - 2], vertices[vertices.length - 1])
}

function solveSegment(a: SupportVertex, b: SupportVertex): SimplexSolution {
  const ab = subtract(b.difference, a.difference)
  const denominator = lengthSquared(ab)
  if (denominator <= GEOMETRY_EPSILON ** 2) {
    return { vertices: [a], weights: [1], closest: a.difference }
  }
  const t = clamp(-dot(a.difference, ab) / denominator, 0, 1)
  if (t <= GEOMETRY_EPSILON) return { vertices: [a], weights: [1], closest: a.difference }
  if (t >= 1 - GEOMETRY_EPSILON) return { vertices: [b], weights: [1], closest: b.difference }
  return {
    vertices: [a, b],
    weights: [1 - t, t],
    closest: add(scale(a.difference, 1 - t), scale(b.difference, t)),
  }
}

function solveTriangle(a: SupportVertex, b: SupportVertex, c: SupportVertex): SimplexSolution {
  const av = a.difference
  const bv = b.difference
  const cv = c.difference
  const ab = subtract(bv, av)
  const ac = subtract(cv, av)
  const ap = negate(av)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return { vertices: [a], weights: [1], closest: av }

  const bp = negate(bv)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return { vertices: [b], weights: [1], closest: bv }

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return solveSegment(a, b)

  const cp = negate(cv)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return { vertices: [c], weights: [1], closest: cv }

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return solveSegment(a, c)

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return solveSegment(b, c)

  const denominator = va + vb + vc
  if (Math.abs(denominator) <= GEOMETRY_EPSILON ** 2) {
    const candidates = [solveSegment(a, b), solveSegment(a, c), solveSegment(b, c)]
    return candidates.reduce((best, candidate) => (
      lengthSquared(candidate.closest) < lengthSquared(best.closest) ? candidate : best
    ))
  }
  const weights = [va / denominator, vb / denominator, vc / denominator]
  return { vertices: [a, b, c], weights, closest: { x: 0, y: 0 } }
}

function validatePolygonVertices(vertices: readonly Point[]): void {
  if (vertices.length < 3) throw new InvalidFootprintError('Polygon requires at least three vertices')
  vertices.forEach((vertex) => assertFinitePoint(vertex, 'Polygon vertex'))
  if (vertices.length > 1 && pointsEqual(vertices[0], vertices[vertices.length - 1], POLYGON_EPSILON_MM)) {
    throw new InvalidFootprintError('Polygon must not repeat its first vertex at the end')
  }
  for (let first = 0; first < vertices.length; first += 1) {
    for (let second = first + 1; second < vertices.length; second += 1) {
      if (pointsEqual(vertices[first], vertices[second], POLYGON_EPSILON_MM)) {
        throw new InvalidFootprintError('Polygon vertices must be unique')
      }
    }
  }
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length
      if (first === second || firstNext === second || secondNext === first) continue
      if (segmentsIntersect(vertices[first], vertices[firstNext], vertices[second], vertices[secondNext])) {
        throw new InvalidFootprintError('Self-intersecting polygons are not supported')
      }
    }
  }
  if (Math.abs(signedPolygonArea(vertices)) <= POLYGON_EPSILON_MM) {
    throw new InvalidFootprintError('Polygon area must be non-zero')
  }

  let turnSign = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const turn = cross(
      subtract(vertices[(index + 1) % vertices.length], vertices[index]),
      subtract(vertices[(index + 2) % vertices.length], vertices[(index + 1) % vertices.length]),
    )
    if (Math.abs(turn) <= POLYGON_EPSILON_MM) continue
    const sign = Math.sign(turn)
    if (turnSign !== 0 && sign !== turnSign) {
      throw new InvalidFootprintError('Concave polygons are not supported in M6.1; use a convex hull')
    }
    turnSign = sign
  }
  if (turnSign === 0) throw new InvalidFootprintError('Polygon must contain three non-collinear vertices')
}

function signedPolygonArea(vertices: readonly Point[]): number {
  let twiceArea = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const next = vertices[(index + 1) % vertices.length]
    twiceArea += vertices[index].x * next.y - next.x * vertices[index].y
  }
  return twiceArea / 2
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(subtract(b, a), subtract(c, a))
  const abD = cross(subtract(b, a), subtract(d, a))
  const cdA = cross(subtract(d, c), subtract(a, c))
  const cdB = cross(subtract(d, c), subtract(b, c))
  if (((abC > POLYGON_EPSILON_MM && abD < -POLYGON_EPSILON_MM)
      || (abC < -POLYGON_EPSILON_MM && abD > POLYGON_EPSILON_MM))
    && ((cdA > POLYGON_EPSILON_MM && cdB < -POLYGON_EPSILON_MM)
      || (cdA < -POLYGON_EPSILON_MM && cdB > POLYGON_EPSILON_MM))) return true
  return Math.abs(abC) <= POLYGON_EPSILON_MM && pointOnSegment(c, a, b)
    || Math.abs(abD) <= POLYGON_EPSILON_MM && pointOnSegment(d, a, b)
    || Math.abs(cdA) <= POLYGON_EPSILON_MM && pointOnSegment(a, c, d)
    || Math.abs(cdB) <= POLYGON_EPSILON_MM && pointOnSegment(b, c, d)
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  return point.x >= Math.min(start.x, end.x) - POLYGON_EPSILON_MM
    && point.x <= Math.max(start.x, end.x) + POLYGON_EPSILON_MM
    && point.y >= Math.min(start.y, end.y) - POLYGON_EPSILON_MM
    && point.y <= Math.max(start.y, end.y) + POLYGON_EPSILON_MM
}

function refineSweepContact(
  movingFootprint: Footprint,
  movingPose: Pose,
  translation: Point,
  obstacleFootprint: Footprint,
  obstaclePose: Pose,
  safeFraction: number,
  overlappingFraction: number,
  fallbackNormal: Point | null,
): FootprintSweepContact {
  let low = Math.max(0, safeFraction)
  let high = Math.min(1, overlappingFraction)
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middle = (low + high) / 2
    const pose = createPose(add(movingPose.position, scale(translation, middle)), movingPose.rotation)
    if (footprintsOverlap(movingFootprint, pose, obstacleFootprint, obstaclePose)) high = middle
    else low = middle
  }
  const contactPose = createPose(add(movingPose.position, scale(translation, low)), movingPose.rotation)
  return {
    fraction: low,
    normal: sweepContactNormal(
      movingFootprint,
      contactPose,
      translation,
      obstacleFootprint,
      obstaclePose,
      fallbackNormal,
    ),
  }
}

function refineSweepClearanceContact(
  movingFootprint: Footprint,
  movingPose: Pose,
  translation: Point,
  obstacleFootprint: Footprint,
  obstaclePose: Pose,
  minimumDistance: number,
  safeFraction: number,
  illegalFraction: number,
  fallbackNormal: Point | null,
): FootprintSweepContact {
  let low = Math.max(0, safeFraction)
  let high = Math.min(1, illegalFraction)
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middle = (low + high) / 2
    const pose = createPose(add(movingPose.position, scale(translation, middle)), movingPose.rotation)
    const closest = closestPointsBetweenFootprints(movingFootprint, pose, obstacleFootprint, obstaclePose)
    if (closest.distance < minimumDistance) high = middle
    else low = middle
  }
  const contactPose = createPose(add(movingPose.position, scale(translation, low)), movingPose.rotation)
  return {
    fraction: low,
    normal: sweepContactNormal(
      movingFootprint, contactPose, translation, obstacleFootprint, obstaclePose, fallbackNormal,
    ),
  }
}

function sweepContactNormal(
  movingFootprint: Footprint,
  movingPose: Pose,
  translation: Point,
  obstacleFootprint: Footprint,
  obstaclePose: Pose,
  fallbackNormal: Point | null,
): Point {
  const faceNormal = flatFaceContactNormal(
    movingFootprint, movingPose, translation, obstacleFootprint, obstaclePose,
  )
  if (faceNormal) return faceNormal
  if (fallbackNormal && lengthSquared(fallbackNormal) > GEOMETRY_EPSILON ** 2) {
    return safeDirection(fallbackNormal)
  }
  const translationLength = Math.sqrt(lengthSquared(translation))
  const probeDistance = Math.max(1e-6, Math.min(1e-4, translationLength * 1e-5))
  const probePose = createPose(
    add(movingPose.position, scale(translation, -probeDistance / translationLength)),
    movingPose.rotation,
  )
  const closest = closestPointsBetweenFootprints(
    movingFootprint,
    probePose,
    obstacleFootprint,
    obstaclePose,
  )
  const separation = subtract(closest.startAnchor, closest.endAnchor)
  if (lengthSquared(separation) > GEOMETRY_EPSILON ** 2) return safeDirection(separation)
  return safeDirection(subtract(movingPose.position, obstaclePose.position))
}

function flatFaceContactNormal(
  movingFootprint: Footprint,
  movingPose: Pose,
  translation: Point,
  obstacleFootprint: Footprint,
  obstaclePose: Pose,
): Point | null {
  const axes = flatFaceAxes(obstacleFootprint, obstaclePose)
  if (axes.length === 0) return null
  const moving = createSupportShape(movingFootprint, movingPose)
  const obstacle = createSupportShape(obstacleFootprint, obstaclePose)
  let best: { normal: Point; opposition: number; gap: number } | null = null
  for (const axis of axes) for (const normal of [axis, negate(axis)]) {
    const gap = dot(moving.support(negate(normal)), normal)
      - dot(obstacle.support(normal), normal)
    if (Math.abs(gap) > SWEEP_DISTANCE_TOLERANCE * 4) continue
    const opposition = -dot(translation, normal)
    if (!best || opposition > best.opposition + GEOMETRY_EPSILON
      || Math.abs(opposition - best.opposition) <= GEOMETRY_EPSILON && Math.abs(gap) < Math.abs(best.gap)) {
      best = { normal, opposition, gap }
    }
  }
  return best?.normal ?? null
}

function validateRectangleBounds(rectangle: RectangleBounds): void {
  Object.values(rectangle).forEach((value) => {
    if (!Number.isFinite(value)) throw new RangeError('Rectangle bounds must be finite')
  })
  if (rectangle.left > rectangle.right || rectangle.top > rectangle.bottom) {
    throw new RangeError('Rectangle bounds are inverted')
  }
}

function outlineDirections(segmentCount: number): Point[] {
  if (!Number.isInteger(segmentCount) || segmentCount < 16) {
    throw new RangeError('Outline segment count must be an integer of at least 16')
  }
  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = index * Math.PI * 2 / segmentCount
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative and finite`)
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new InvalidFootprintError(`${label} must be positive and finite`)
}

function assertFinitePoint(point: Point, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError(`${label} must be finite`)
}

function inverseRotate(point: Point, rotation: number): Point {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return { x: point.x * cosine + point.y * sine, y: -point.x * sine + point.y * cosine }
}

function safeDirection(direction: Point): Point {
  const magnitude = Math.hypot(direction.x, direction.y)
  return magnitude <= GEOMETRY_EPSILON ? { x: 1, y: 0 } : scale(direction, 1 / magnitude)
}

function add(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y } }
function subtract(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y } }
function scale(point: Point, factor: number): Point { return { x: point.x * factor, y: point.y * factor } }
function negate(point: Point): Point { return { x: -point.x, y: -point.y } }
function dot(a: Point, b: Point): number { return a.x * b.x + a.y * b.y }
function cross(a: Point, b: Point): number { return a.x * b.y - a.y * b.x }
function lengthSquared(point: Point): number { return dot(point, point) }
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
function pointsEqual(a: Point, b: Point, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
}
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1) }

function assertNever(value: never): never {
  throw new Error(`Unknown footprint: ${JSON.stringify(value)}`)
}
