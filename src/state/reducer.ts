import type { GameState, MovementSession } from '../domain/types'
import { appendAcceptedPathPoint, resolveRigidTranslation } from '../engine/movement'
import { GEOMETRY_EPSILON } from '../engine/geometry/tolerance'
import { createMoveAction } from '../game/moveActions'
import { getMovementAllowance } from '../game/selectors'
import { advanceTurn } from '../game/turns'
import type { GameStateAction } from './actions'

export function gameReducer(state: GameState, action: GameStateAction): GameState {
  switch (action.type) {
    case 'movement/sessionStarted': {
      if (state.movementSession) return state
      const models = state.models.filter((model) => action.modelIds.includes(model.id))
      if (models.length === 0) return state
      const referenceStart = {
        x: models.reduce((total, model) => total + model.position.x, 0) / models.length,
        y: models.reduce((total, model) => total + model.position.y, 0) / models.length,
      }
      const session: MovementSession = {
        id: action.sessionId,
        modelIds: models.map((model) => model.id),
        referenceStart,
        referencePath: [{ ...referenceStart }],
        models: Object.fromEntries(models.map((model) => [model.id, {
          modelId: model.id,
          startPosition: { ...model.position },
          movementUsed: 0,
          path: [{ ...model.position }],
        }])),
      }
      return { ...state, movementSession: session }
    }

    case 'movement/requested': {
      const session = state.movementSession
      if (!session) return state
      const requestedIds = Object.keys(action.positions)
      if (!sameIdSet(requestedIds, session.modelIds)) return state
      const translations = session.modelIds.map((modelId) => {
        const model = state.models.find((candidate) => candidate.id === modelId)
        const requested = action.positions[modelId]
        return model && requested
          ? { x: requested.x - model.position.x, y: requested.y - model.position.y }
          : null
      })
      const translation = translations[0]
      if (!translation || translations.some((candidate) => !candidate
        || Math.abs(candidate.x - translation.x) > GEOMETRY_EPSILON
        || Math.abs(candidate.y - translation.y) > GEOMETRY_EPSILON)) return state
      const remainingMovement = new Map(session.modelIds.map((modelId) => {
        const model = state.models.find((candidate) => candidate.id === modelId)
        const used = session.models[modelId]?.movementUsed ?? 0
        return [modelId, model ? Math.max(0, getMovementAllowance(state, model) - used) : 0]
      }))
      const resolution = resolveRigidTranslation({
        allModels: state.models,
        modelIds: session.modelIds,
        translation,
        battlefield: state.battlefield,
        remainingMovement,
      })
      const nextSession: MovementSession = {
        ...session,
        referencePath: resolution.translationPath.slice(1).reduce(
          (path, offset) => appendAcceptedPathPoint(path, {
            x: session.referencePath[session.referencePath.length - 1].x + offset.x,
            y: session.referencePath[session.referencePath.length - 1].y + offset.y,
          }),
          session.referencePath,
        ),
        models: Object.fromEntries(Object.entries(session.models).map(([modelId, movement]) => {
          const acceptedPosition = resolution.positions.get(modelId)
          const acceptedDistance = resolution.distances.get(modelId) ?? 0
          const acceptedPath = resolution.paths.get(modelId)?.slice(1) ?? []
          return [modelId, acceptedPosition ? {
            ...movement,
            movementUsed: movement.movementUsed + acceptedDistance,
            path: acceptedPath.reduce(appendAcceptedPathPoint, movement.path),
          } : movement]
        })),
      }
      return {
        ...state,
        models: state.models.map((model) => {
          const position = resolution.positions.get(model.id)
          return position ? { ...model, position } : model
        }),
        movementSession: nextSession,
      }
    }

    case 'movement/confirmed': {
      const session = state.movementSession
      if (!session) return state
      const changed = session.modelIds.some((modelId) => {
        const current = state.models.find((model) => model.id === modelId)
        const start = session.models[modelId]?.startPosition
        return current && start && (current.position.x !== start.x || current.position.y !== start.y)
      })
      if (!changed) return { ...state, movementSession: null }

      const beforeModels = state.models.map((model) => {
        const startPosition = session.models[model.id]?.startPosition
        return startPosition ? { ...model, position: { ...startPosition } } : { ...model }
      })
      const sequence = state.nextActionSequence
      const participatingModels = session.modelIds
        .map((modelId) => state.models.find((model) => model.id === modelId))
        .filter((model): model is GameState['models'][number] => Boolean(model))
      const moveAction = createMoveAction({
        sequence,
        actorPlayerId: state.gameContext.activePlayerId,
        gameContext: state.gameContext,
        affectedModels: participatingModels,
        startingPositions: Object.fromEntries(participatingModels.map((model) => [
          model.id,
          session.models[model.id].startPosition,
        ])),
        finalPositions: Object.fromEntries(participatingModels.map((model) => [model.id, model.position])),
        movementUsed: Object.fromEntries(participatingModels.map((model) => [
          model.id,
          session.models[model.id].movementUsed,
        ])),
      })
      return {
        ...state,
        movementSession: null,
        actionHistory: [...state.actionHistory, moveAction],
        nextActionSequence: sequence + 1,
        lastConfirmedMovementUndo: {
          models: beforeModels,
          actionId: moveAction.id,
          turnId: moveAction.turnId,
        },
      }
    }

    case 'movement/undoLastConfirmed': {
      const undo = state.lastConfirmedMovementUndo
      if (state.movementSession || !undo || undo.turnId !== state.gameContext.turnId) return state
      return {
        ...state,
        models: undo.models.map((model) => ({
          ...model,
          position: { ...model.position },
        })),
        actionHistory: state.actionHistory.filter((confirmedAction) => confirmedAction.id !== undo.actionId),
        movementSession: null,
        lastConfirmedMovementUndo: null,
      }
    }

    case 'movement/cancelled': {
      const session = state.movementSession
      if (!session) return state
      return {
        ...state,
        models: state.models.map((model) => {
          const startPosition = session.models[model.id]?.startPosition
          return startPosition ? { ...model, position: { ...startPosition } } : model
        }),
        movementSession: null,
      }
    }

    case 'game/turnEnded': {
      if (state.movementSession) return state
      return {
        ...state,
        gameContext: advanceTurn(state.gameContext, state.turnConfiguration),
      }
    }
  }
}

function sameIdSet(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false
  const leftIds = new Set(left)
  return leftIds.size === right.length && right.every((id) => leftIds.has(id))
}
