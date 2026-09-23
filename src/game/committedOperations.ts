import type { CommittedOperation, CommittedOperationType, CommittedOperationUndo, GameState } from '../domain/types'

export function createCommittedOperation(request: {
  sequence: number
  type: CommittedOperationType
  actorPlayerId: string
  state: GameState
  entityIds: readonly string[]
}): CommittedOperation {
  return {
    id: `operation-${request.sequence}`,
    sequence: request.sequence,
    type: request.type,
    actorPlayerId: request.actorPlayerId,
    round: request.state.gameContext.round,
    turn: request.state.gameContext.turn,
    turnSequence: request.state.gameContext.turnSequence,
    turnId: request.state.gameContext.turnId,
    ...(request.state.gameContext.phase ? { phase: request.state.gameContext.phase } : {}),
    entityIds: [...new Set(request.entityIds)].sort((left, right) => left.localeCompare(right)),
  }
}

export function commitOperation(
  before: GameState,
  after: GameState,
  operation: CommittedOperation,
): GameState {
  const gameSystemState = before.gameSystemState ?? {
    schemaId: 'fieldcraft.legacy-v3', schemaVersion: 1, data: {},
  }
  const undo: CommittedOperationUndo = {
    operationId: operation.id,
    turnId: before.gameContext.turnId,
    models: structuredClone(before.models),
    actionHistory: structuredClone(before.actionHistory),
    scoreHistory: before.scoreHistory ? structuredClone(before.scoreHistory) : undefined,
    gameSystemState: structuredClone(gameSystemState),
    committedOperations: structuredClone(before.committedOperations ?? []),
  }
  return {
    ...after,
    committedOperations: [...(before.committedOperations ?? []), operation],
    lastCommittedOperationUndo: undo,
    lastConfirmedMovementUndo: null,
  }
}

export function undoLastCommittedOperation(state: GameState): GameState {
  const undo = state.lastCommittedOperationUndo
  if (state.movementSession || !undo || undo.turnId !== state.gameContext.turnId) return state
  return {
    ...state,
    models: structuredClone(undo.models),
    actionHistory: structuredClone(undo.actionHistory),
    scoreHistory: undo.scoreHistory ? structuredClone(undo.scoreHistory) : undefined,
    gameSystemState: structuredClone(undo.gameSystemState),
    committedOperations: structuredClone(undo.committedOperations),
    movementSession: null,
    lastConfirmedMovementUndo: null,
    lastCommittedOperationUndo: null,
  }
}
