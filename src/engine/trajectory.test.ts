import { describe, expect, it } from 'vitest'
import { normalizeRotation } from './geometry/footprints'
import { calculatePathMovementCost } from './movementCost'
import {
  appendPoseTrajectorySegment,
  createPoseTrajectory,
  derivePoseTrajectoryMetrics,
  poseTrajectoryEndPose,
  poseTrajectoryFromPositions,
} from './trajectory'

describe('PoseTrajectory', () => {
  it('retains ordered translation and rotation segments and derives current metrics', () => {
    let trajectory = createPoseTrajectory({ position: { x: 0, y: 0 }, rotation: 0 })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 3, y: 4 }, rotation: 0 },
      angularDelta: 0,
    })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 3, y: 4 }, rotation: 0.5 },
      angularDelta: 0.5,
    })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 6, y: 8 }, rotation: 0.5 },
      angularDelta: 0,
    })

    expect(trajectory.segments.map((segment) => segment.angularDelta)).toEqual([0, 0.5, 0])
    expect(poseTrajectoryEndPose(trajectory)).toEqual({ position: { x: 6, y: 8 }, rotation: 0.5 })
    expect(derivePoseTrajectoryMetrics(trajectory)).toEqual({
      centerPathLength: 10,
      totalAbsoluteAngularTravel: 0.5,
      rotationOccurred: true,
    })
  })

  it('preserves signed wraparound and reversal while deriving absolute angular travel', () => {
    let trajectory = createPoseTrajectory({ position: { x: 1, y: 2 }, rotation: 6.1 })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 1, y: 2 }, rotation: normalizeRotation(6.1 + 0.4) },
      angularDelta: 0.4,
    })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 1, y: 2 }, rotation: normalizeRotation(6.1 + 0.15) },
      angularDelta: -0.25,
    })

    expect(trajectory.segments.map((segment) => segment.angularDelta)).toEqual([0.4, -0.25])
    expect(derivePoseTrajectoryMetrics(trajectory).totalAbsoluteAngularTravel).toBeCloseTo(0.65)
  })

  it('can represent a future coupled translation and rotation segment without reducing it', () => {
    const trajectory = appendPoseTrajectorySegment(
      createPoseTrajectory({ position: { x: 0, y: 0 }, rotation: 0 }),
      {
        endPose: { position: { x: 3, y: 4 }, rotation: 0.75 },
        angularDelta: 0.75,
      },
    )
    expect(trajectory.segments).toEqual([{
      endPose: { position: { x: 3, y: 4 }, rotation: 0.75 },
      angularDelta: 0.75,
    }])
    expect(derivePoseTrajectoryMetrics(trajectory)).toEqual({
      centerPathLength: 5,
      totalAbsoluteAngularTravel: 0.75,
      rotationOccurred: true,
    })
  })

  it('builds fixed-orientation pathfinding trajectories and remains JSON-safe', () => {
    const trajectory = poseTrajectoryFromPositions([
      { x: 1, y: 1 },
      { x: 4, y: 5 },
      { x: 7, y: 9 },
    ], Math.PI / 3)
    expect(derivePoseTrajectoryMetrics(trajectory)).toEqual({
      centerPathLength: 10,
      totalAbsoluteAngularTravel: 0,
      rotationOccurred: false,
    })
    expect(trajectory.segments).toHaveLength(1)
    expect(structuredClone(trajectory)).toEqual(trajectory)
    expect(JSON.parse(JSON.stringify(trajectory))).toEqual(trajectory)
  })

  it('feeds both scalar path-cost policies without changing their behavior', () => {
    let trajectory = createPoseTrajectory({ position: { x: 0, y: 0 }, rotation: 0 })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 3, y: 0 }, rotation: 0 }, angularDelta: 0,
    })
    trajectory = appendPoseTrajectorySegment(trajectory, {
      endPose: { position: { x: 3, y: 0 }, rotation: 0.5 }, angularDelta: 0.5,
    })
    const facts = derivePoseTrajectoryMetrics(trajectory)
    const metrics = {
      translationDistance: facts.centerPathLength,
      angularDistance: facts.totalAbsoluteAngularTravel,
    }

    expect(calculatePathMovementCost(
      { type: 'fixed-rotation-charge', rotationCharge: 2 }, metrics,
    ).totalCost).toBe(5)
    expect(calculatePathMovementCost(
      { type: 'free-rotation' }, metrics,
    ).totalCost).toBe(3)
  })
})
