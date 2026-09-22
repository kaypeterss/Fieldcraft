import type { Footprint, Pose } from '../domain/types'
import { createPose, footprintSupportPoint } from './geometry/footprints'
import type { Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export interface MovementEnvelopeReach {
  distance: number
  /** Outward support direction that currently requires the most allowance. */
  direction: Point
}

export interface MovementEnvelopeProjection {
  pose: Pose
  retreat: Point
  reach: number
}

export interface MovementEnvelopeContact {
  fraction: number
  /** Inward normal; legal center motion has a non-negative dot product with it. */
  normal: Point
}

const DIRECTION_COUNT = 256
const PROJECTION_CYCLES = 96

/**
 * Directed Hausdorff distance from the starting footprint to the candidate
 * footprint. Equivalently, this is the smallest disk radius R for which
 * candidateFootprint is contained by startFootprint ⊕ disk(R).
 */
export function movementEnvelopeReach(
  footprint: Footprint,
  startPose: Pose,
  candidatePose: Pose,
): MovementEnvelopeReach {
  const start = createPose(startPose.position, startPose.rotation)
  const candidate = createPose(candidatePose.position, candidatePose.rotation)
  const displacement = subtract(candidate.position, start.position)
  if (footprint.shape === 'circle'
    || Math.abs(normalizedAngularDifference(start.rotation, candidate.rotation)) <= GEOMETRY_EPSILON) {
    const distance = magnitude(displacement)
    return { distance, direction: distance > GEOMETRY_EPSILON
      ? scale(displacement, 1 / distance)
      : { x: 1, y: 0 } }
  }

  const step = Math.PI * 2 / DIRECTION_COUNT
  let bestAngle = 0
  let bestDistance = 0
  for (let index = 0; index < DIRECTION_COUNT; index += 1) {
    const angle = index * step
    const distance = supportGap(footprint, start, candidate, directionAt(angle))
    if (distance > bestDistance) {
      bestDistance = distance
      bestAngle = angle
    }
  }

  // Refine the winning angular interval using exact analytic support queries.
  let low = bestAngle - step
  let high = bestAngle + step
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const first = low + (high - low) / 3
    const second = high - (high - low) / 3
    if (supportGap(footprint, start, candidate, directionAt(first))
      < supportGap(footprint, start, candidate, directionAt(second))) low = first
    else high = second
  }
  const direction = directionAt((low + high) / 2)
  const distance = Math.max(0, supportGap(footprint, start, candidate, direction), bestDistance)
  return { distance, direction }
}

export function poseFitsMovementEnvelope(
  footprint: Footprint,
  startPose: Pose,
  candidatePose: Pose,
  allowance: number,
): boolean {
  validateAllowance(allowance)
  return movementEnvelopeReach(footprint, startPose, candidatePose).distance
    <= allowance + GEOMETRY_EPSILON
}

/** Closest legal center for the requested orientation (Euclidean projection). */
export function projectPoseIntoMovementEnvelope(
  footprint: Footprint,
  startPose: Pose,
  candidatePose: Pose,
  allowance: number,
): MovementEnvelopeProjection {
  validateAllowance(allowance)
  const desired = createPose(candidatePose.position, candidatePose.rotation)
  if (poseFitsMovementEnvelope(footprint, startPose, desired, allowance)) {
    return { pose: desired, retreat: { x: 0, y: 0 }, reach: movementEnvelopeReach(footprint, startPose, desired).distance }
  }

  const directions = Array.from({ length: DIRECTION_COUNT }, (_, index) =>
    directionAt(index * Math.PI * 2 / DIRECTION_COUNT))
  let projected = dykstraProject(desired.position, directions.map((direction) => ({
    direction,
    maximum: centerMaximum(footprint, startPose, desired.rotation, allowance, direction),
  })))

  // Sampled half-planes seed the solve; exact worst-direction queries close any
  // residual numerical gap without approximating footprint vertices.
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const pose = createPose(projected, desired.rotation)
    const reach = movementEnvelopeReach(footprint, startPose, pose)
    if (reach.distance <= allowance + GEOMETRY_EPSILON) break
    const direction = reach.direction
    directions.push(direction)
    projected = dykstraProject(desired.position, directions.map((candidateDirection) => ({
      direction: candidateDirection,
      maximum: centerMaximum(footprint, startPose, desired.rotation, allowance, candidateDirection),
    })))
  }

  const pose = createPose(projected, desired.rotation)
  return {
    pose,
    retreat: subtract(projected, desired.position),
    reach: movementEnvelopeReach(footprint, startPose, pose).distance,
  }
}

/** First contact while translating at fixed orientation through the convex envelope. */
export function sweepTranslationToMovementEnvelope(
  footprint: Footprint,
  startPose: Pose,
  movingPose: Pose,
  translation: Point,
  allowance: number,
): MovementEnvelopeContact | null {
  validateAllowance(allowance)
  const endPose = createPose(add(movingPose.position, translation), movingPose.rotation)
  if (poseFitsMovementEnvelope(footprint, startPose, endPose, allowance)) return null
  if (footprint.shape === 'circle'
    || Math.abs(normalizedAngularDifference(startPose.rotation, movingPose.rotation)) <= GEOMETRY_EPSILON) {
    const displacement = subtract(movingPose.position, startPose.position)
    const a = dot(translation, translation)
    const b = 2 * dot(displacement, translation)
    const c = dot(displacement, displacement) - allowance * allowance
    const discriminant = Math.max(0, b * b - 4 * a * c)
    const fraction = Math.max(0, Math.min(1, (-b + Math.sqrt(discriminant)) / (2 * a)))
    const contactDisplacement = add(displacement, scale(translation, fraction))
    const length = magnitude(contactDisplacement)
    return {
      fraction,
      normal: length > GEOMETRY_EPSILON
        ? scale(contactDisplacement, -1 / length)
        : scale(translation, -1 / Math.max(magnitude(translation), GEOMETRY_EPSILON)),
    }
  }
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middle = (low + high) / 2
    const pose = createPose(add(movingPose.position, scale(translation, middle)), movingPose.rotation)
    if (poseFitsMovementEnvelope(footprint, startPose, pose, allowance)) low = middle
    else high = middle
  }
  const contactPose = createPose(add(movingPose.position, scale(translation, low)), movingPose.rotation)
  const outward = movementEnvelopeReach(footprint, startPose, contactPose).direction
  return { fraction: low, normal: scale(outward, -1) }
}

function supportGap(footprint: Footprint, start: Pose, candidate: Pose, direction: Point): number {
  return dot(footprintSupportPoint(footprint, candidate, direction), direction)
    - dot(footprintSupportPoint(footprint, start, direction), direction)
}

function centerMaximum(
  footprint: Footprint,
  startPose: Pose,
  candidateRotation: number,
  allowance: number,
  direction: Point,
): number {
  const originPose = createPose({ x: 0, y: 0 }, candidateRotation)
  return dot(footprintSupportPoint(footprint, startPose, direction), direction)
    + allowance
    - dot(footprintSupportPoint(footprint, originPose, direction), direction)
}

function dykstraProject(
  desired: Point,
  constraints: ReadonlyArray<{ direction: Point; maximum: number }>,
): Point {
  let point = { ...desired }
  const corrections = constraints.map(() => ({ x: 0, y: 0 }))
  for (let cycle = 0; cycle < PROJECTION_CYCLES; cycle += 1) {
    const before = point
    constraints.forEach((constraint, index) => {
      const input = add(point, corrections[index])
      const excess = dot(input, constraint.direction) - constraint.maximum
      const next = excess > 0 ? subtract(input, scale(constraint.direction, excess)) : input
      corrections[index] = subtract(input, next)
      point = next
    })
    if (magnitude(subtract(point, before)) <= GEOMETRY_EPSILON * 0.1) break
  }
  return point
}

function normalizedAngularDifference(first: number, second: number): number {
  let delta = (second - first) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function validateAllowance(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Movement allowance must be finite and non-negative')
}

function directionAt(angle: number): Point { return { x: Math.cos(angle), y: Math.sin(angle) } }
function magnitude(point: Point): number { return Math.hypot(point.x, point.y) }
function dot(a: Point, b: Point): number { return a.x * b.x + a.y * b.y }
function add(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y } }
function subtract(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y } }
function scale(point: Point, factor: number): Point { return { x: point.x * factor, y: point.y * factor } }
