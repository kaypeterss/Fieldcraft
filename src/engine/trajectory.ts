import type { Pose, PoseTrajectory, PoseTrajectorySegment } from '../domain/types'
import { distanceBetween } from './geometry/point'
import { normalizeRotation } from './geometry/footprints'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export interface PoseTrajectoryMetrics {
  centerPathLength: number
  totalAbsoluteAngularTravel: number
  rotationOccurred: boolean
}

export function createPoseTrajectory(startPose: Pose): PoseTrajectory {
  return { startPose: clonePose(startPose), segments: [] }
}

/**
 * Appends one accepted pose segment without reducing it to scalar totals.
 * Future coupled motion can change position and rotation in the same segment.
 */
export function appendPoseTrajectorySegment(
  trajectory: PoseTrajectory,
  segment: PoseTrajectorySegment,
): PoseTrajectory {
  if (!Number.isFinite(segment.angularDelta)) throw new RangeError('Trajectory angular delta must be finite')
  const previous = poseTrajectoryEndPose(trajectory)
  const endPose = clonePose(segment.endPose)
  assertFinitePose(endPose)
  const expectedRotation = normalizeRotation(previous.rotation + segment.angularDelta)
  if (angularDifference(expectedRotation, endPose.rotation) > GEOMETRY_EPSILON) {
    throw new RangeError('Trajectory end rotation must match its signed angular delta')
  }
  if (distanceBetween(previous.position, endPose.position) <= GEOMETRY_EPSILON
    && Math.abs(segment.angularDelta) <= GEOMETRY_EPSILON) return trajectory

  const segments = trajectory.segments.map(cloneSegment)
  const last = segments.at(-1)
  const beforeLast = segments.length > 1
    ? segments[segments.length - 2].endPose
    : trajectory.startPose
  if (last && canMergePureTranslation(beforeLast, last, endPose, segment.angularDelta)) {
    segments[segments.length - 1] = { endPose, angularDelta: 0 }
  } else if (last && canMergePureRotation(beforeLast, last, endPose, segment.angularDelta)) {
    segments[segments.length - 1] = {
      endPose,
      angularDelta: last.angularDelta + segment.angularDelta,
    }
  } else {
    segments.push({ endPose, angularDelta: segment.angularDelta })
  }

  return {
    startPose: clonePose(trajectory.startPose),
    segments,
  }
}

export function poseTrajectoryEndPose(trajectory: PoseTrajectory): Pose {
  const pose = trajectory.segments.at(-1)?.endPose ?? trajectory.startPose
  return clonePose(pose)
}

export function derivePoseTrajectoryMetrics(trajectory: PoseTrajectory): PoseTrajectoryMetrics {
  let previous = trajectory.startPose
  let centerPathLength = 0
  let totalAbsoluteAngularTravel = 0
  for (const segment of trajectory.segments) {
    centerPathLength += distanceBetween(previous.position, segment.endPose.position)
    totalAbsoluteAngularTravel += Math.abs(segment.angularDelta)
    previous = segment.endPose
  }
  return {
    centerPathLength,
    totalAbsoluteAngularTravel,
    rotationOccurred: totalAbsoluteAngularTravel > GEOMETRY_EPSILON,
  }
}

/** Builds a fixed-orientation piecewise-linear trajectory from center-path points. */
export function poseTrajectoryFromPositions(
  positions: ReadonlyArray<{ x: number; y: number }>,
  rotation: number,
): PoseTrajectory {
  if (positions.length === 0) throw new RangeError('A trajectory requires at least one position')
  return positions.slice(1).reduce(
    (trajectory, position) => appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { ...position }, rotation: normalizeRotation(rotation) },
      angularDelta: 0,
    }),
    createPoseTrajectory({ position: { ...positions[0] }, rotation: normalizeRotation(rotation) }),
  )
}

function cloneSegment(segment: PoseTrajectorySegment): PoseTrajectorySegment {
  return { endPose: clonePose(segment.endPose), angularDelta: segment.angularDelta }
}

function clonePose(pose: Pose): Pose {
  return { position: { ...pose.position }, rotation: normalizeRotation(pose.rotation) }
}

function assertFinitePose(pose: Pose): void {
  if (!Number.isFinite(pose.position.x) || !Number.isFinite(pose.position.y)) {
    throw new RangeError('Trajectory positions must be finite')
  }
}

function canMergePureTranslation(
  start: Pose,
  current: PoseTrajectorySegment,
  next: Pose,
  nextAngularDelta: number,
): boolean {
  if (Math.abs(current.angularDelta) > GEOMETRY_EPSILON
    || Math.abs(nextAngularDelta) > GEOMETRY_EPSILON
    || angularDifference(start.rotation, current.endPose.rotation) > GEOMETRY_EPSILON
    || angularDifference(current.endPose.rotation, next.rotation) > GEOMETRY_EPSILON) return false
  const first = {
    x: current.endPose.position.x - start.position.x,
    y: current.endPose.position.y - start.position.y,
  }
  const second = {
    x: next.position.x - current.endPose.position.x,
    y: next.position.y - current.endPose.position.y,
  }
  return Math.abs(first.x * second.y - first.y * second.x) <= GEOMETRY_EPSILON
    && first.x * second.x + first.y * second.y >= 0
}

function canMergePureRotation(
  start: Pose,
  current: PoseTrajectorySegment,
  next: Pose,
  nextAngularDelta: number,
): boolean {
  return Math.abs(current.angularDelta) > GEOMETRY_EPSILON
    && Math.abs(nextAngularDelta) > GEOMETRY_EPSILON
    && Math.sign(current.angularDelta) === Math.sign(nextAngularDelta)
    && distanceBetween(start.position, current.endPose.position) <= GEOMETRY_EPSILON
    && distanceBetween(current.endPose.position, next.position) <= GEOMETRY_EPSILON
}

function angularDifference(left: number, right: number): number {
  const fullTurn = Math.PI * 2
  const difference = Math.abs(normalizeRotation(left) - normalizeRotation(right))
  return Math.min(difference, fullTurn - difference)
}
