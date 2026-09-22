import type { GameContext, MoveAction, Pose, PoseTrajectory, TabletopModel } from '../domain/types'

export interface CreateMoveActionRequest {
  sequence: number
  actorPlayerId: string
  gameContext: GameContext
  affectedModels: ReadonlyArray<TabletopModel>
  startingPoses: Readonly<Record<string, Pose>>
  finalPoses: Readonly<Record<string, Pose>>
  trajectories: Readonly<Record<string, PoseTrajectory>>
  translationDistance: Readonly<Record<string, number>>
  angularRotation: Readonly<Record<string, number>>
  movementUsed: Readonly<Record<string, number>>
}

/** Builds the canonical serializable action for any already-validated move. */
export function createMoveAction(request: CreateMoveActionRequest): MoveAction {
  const models = request.affectedModels
  return {
    id: `action-${request.sequence}`,
    sequence: request.sequence,
    type: 'MOVE',
    playerId: request.actorPlayerId,
    round: request.gameContext.round,
    turn: request.gameContext.turn,
    turnSequence: request.gameContext.turnSequence,
    turnId: request.gameContext.turnId,
    ...(request.gameContext.phase ? { phase: request.gameContext.phase } : {}),
    payload: {
      modelIds: models.map((model) => model.id),
      unitIds: [...new Set(models.map((model) => model.unitId))],
      ownerIds: [...new Set(models.map((model) => model.ownerId))],
      startingPoses: Object.fromEntries(models.map((model) => [
        model.id,
        clonePose(request.startingPoses[model.id]),
      ])),
      finalPoses: Object.fromEntries(models.map((model) => [
        model.id,
        clonePose(request.finalPoses[model.id]),
      ])),
      trajectories: Object.fromEntries(models.map((model) => [
        model.id,
        cloneTrajectory(request.trajectories[model.id]),
      ])),
      startingPositions: Object.fromEntries(models.map((model) => [
        model.id,
        { ...request.startingPoses[model.id].position },
      ])),
      finalPositions: Object.fromEntries(models.map((model) => [
        model.id,
        { ...request.finalPoses[model.id].position },
      ])),
      translationDistance: Object.fromEntries(models.map((model) => [
        model.id,
        request.translationDistance[model.id],
      ])),
      angularRotation: Object.fromEntries(models.map((model) => [
        model.id,
        request.angularRotation[model.id],
      ])),
      movementUsed: Object.fromEntries(models.map((model) => [
        model.id,
        request.movementUsed[model.id],
      ])),
    },
  }
}

function clonePose(pose: Pose): Pose {
  return { position: { ...pose.position }, rotation: pose.rotation }
}

function cloneTrajectory(trajectory: PoseTrajectory): PoseTrajectory {
  return {
    startPose: clonePose(trajectory.startPose),
    segments: trajectory.segments.map((segment) => ({
      endPose: clonePose(segment.endPose),
      angularDelta: segment.angularDelta,
    })),
  }
}
