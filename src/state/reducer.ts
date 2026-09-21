import type { GameState, MovementSession } from '../domain/types'
import { appendAcceptedPathPoint, resolveMovement } from '../engine/movement'
import { getMovementAllowance } from '../game/selectors'
import type { GameAction } from './actions'

export function gameReducer(state: GameState, action: GameAction): GameState {
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
      const requested = new Map(
        Object.entries(action.positions).filter(([modelId]) => session.modelIds.includes(modelId)),
      )
      if (requested.size === 0) return state
      const remainingMovement = new Map(session.modelIds.map((modelId) => {
        const model = state.models.find((candidate) => candidate.id === modelId)
        const used = session.models[modelId]?.movementUsed ?? 0
        return [modelId, model ? Math.max(0, getMovementAllowance(state, model) - used) : 0]
      }))
      const resolution = resolveMovement({
        allModels: state.models,
        requestedPositions: requested,
        battlefield: state.battlefield,
        remainingMovement,
      })
      const nextSession: MovementSession = {
        ...session,
        referencePath: requested.size === session.modelIds.length
          ? resolution.translationPath.slice(1).reduce(
            (path, offset) => appendAcceptedPathPoint(path, {
              x: session.referencePath[session.referencePath.length - 1].x + offset.x,
              y: session.referencePath[session.referencePath.length - 1].y + offset.y,
            }),
            session.referencePath,
          )
          : session.referencePath,
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
      return {
        ...state,
        movementSession: null,
        lastConfirmedMovementUndo: { models: beforeModels },
      }
    }

    case 'movement/undoLastConfirmed': {
      if (state.movementSession || !state.lastConfirmedMovementUndo) return state
      return {
        ...state,
        models: state.lastConfirmedMovementUndo.models.map((model) => ({
          ...model,
          position: { ...model.position },
        })),
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

    // Retained for deterministic Milestone 1 actions and older serialized tests.
    case 'models/moved': {
      const resolution = resolveMovement({
        allModels: state.models,
        requestedPositions: new Map(Object.entries(action.positions)),
        battlefield: state.battlefield,
      })
      return {
        ...state,
        models: state.models.map((model) => {
          const position = resolution.positions.get(model.id)
          return position ? { ...model, position } : model
        }),
      }
    }
  }
}
