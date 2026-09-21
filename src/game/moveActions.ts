import type { GameContext, MoveAction, TabletopModel } from '../domain/types'
import type { Point } from '../engine/geometry/point'

export interface CreateMoveActionRequest {
  sequence: number
  actorPlayerId: string
  gameContext: GameContext
  affectedModels: ReadonlyArray<TabletopModel>
  startingPositions: Readonly<Record<string, Point>>
  finalPositions: Readonly<Record<string, Point>>
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
      startingPositions: Object.fromEntries(models.map((model) => [
        model.id,
        { ...request.startingPositions[model.id] },
      ])),
      finalPositions: Object.fromEntries(models.map((model) => [
        model.id,
        { ...request.finalPositions[model.id] },
      ])),
      movementUsed: Object.fromEntries(models.map((model) => [
        model.id,
        request.movementUsed[model.id],
      ])),
    },
  }
}
