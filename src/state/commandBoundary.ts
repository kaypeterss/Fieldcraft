import type { GameState } from '../domain/types'
import { GEOMETRY_EPSILON } from '../engine/geometry/tolerance'
import { validateCandidateFormation } from '../engine/candidateFormation'
import { activeBattlefieldModels } from '../game/modelPresence'
import { getUnitCoherencyPolicy } from '../game/selectors'
import { coherencyPolicyFor } from '../gameSystem/policies'
import { derivePoseTrajectoryMetrics, poseTrajectoryFromPositions } from '../engine/trajectory'
import { movementEnvelopeReach } from '../engine/movementEnvelope'
import { calculatePathMovementCost } from '../engine/movementCost'
import { authorizeCommand, authorizeMovement, type LoadedMatchRuntime } from '../gameSystem/runtime'
import type { GameStateAction } from './actions'
import { gameReducer } from './reducer'

/** The sole production entry point for state-changing player/UI intents. */
export function reduceGameCommand(
  runtime: LoadedMatchRuntime,
  state: GameState,
  action: GameStateAction,
): GameState {
  switch (action.type) {
    case 'gameSystem/command':
      return runtime.registration?.executeCommand?.(state, action.command) ?? state
    case 'movement/sessionStarted': {
      const authorization = authorizeMovement(runtime, state, action.modelIds)
      if (!authorization.allowed) return state
      return gameReducer(state, {
        ...action,
        modelIds: authorization.actionContext
          ? Object.keys(authorization.actionContext.movementAllowanceByModel)
          : action.modelIds,
        movementPolicy: authorization.movementPolicy,
        movementAllowanceByModel: authorization.remainingByModel,
        actionContext: authorization.actionContext,
      })
    }
    case 'movement/confirmed': {
      const session = state.movementSession
      if (!session) return state
      const authorization = authorizeMovement(runtime, state, session.modelIds)
      if (!authorization.allowed
        || authorization.actionContext?.id !== session.actionContext?.id) return state
      if (session.actionContext) {
        const unit = state.units.find((candidate) => candidate.id === session.actionContext!.unitId)
        const coherencyPolicy = unit
          ? coherencyPolicyFor(runtime.gameSystem.coherency, getUnitCoherencyPolicy(state, unit))
          : undefined
        const validation = validateCandidateFormation({
          allModels: activeBattlefieldModels(state),
          battlefield: state.battlefield,
          terrainFeatures: state.battlefieldFeatures,
          terrainPolicy: state.terrainPolicy,
          positions: Object.fromEntries(session.modelIds.map((id) => {
            const model = state.models.find((candidate) => candidate.id === id)!
            return [id, model.position]
          })),
          rotations: Object.fromEntries(session.modelIds.map((id) => {
            const model = state.models.find((candidate) => candidate.id === id)!
            return [id, model.rotation]
          })),
          separationConstraints: session.actionContext.separationConstraints,
          destinationConstraints: session.actionContext.destinationConstraints,
          ...(session.actionContext.requireCoherency && unit && coherencyPolicy
            ? { coherency: { unit, policy: coherencyPolicy } } : {}),
        })
        if (!validation.valid) return state
      }
      const after = gameReducer(state, action)
      if (after === state || after.actionHistory.length === state.actionHistory.length || !session.actionContext) return after
      return runtime.gameSystem.movement.commitAction?.({
        before: state,
        after,
        context: session.actionContext,
      }) ?? after
    }
    case 'movement/validatedCandidateApplied': {
      const modelIds = Object.keys(action.finalPositions)
      const authorization = authorizeMovement(runtime, state, modelIds)
      if (!authorization.allowed) return state
      const models = activeBattlefieldModels(state)
      const movementUsed = Object.fromEntries(modelIds.map((id) => {
        const model = models.find((candidate) => candidate.id === id)
        const start = action.startingPositions[id]
        const final = action.finalPositions[id]
        if (!model || !start || !final) return [id, Number.POSITIVE_INFINITY]
        const startRotation = action.startingRotations?.[id] ?? model.rotation
        const finalRotation = action.finalRotations?.[id] ?? model.rotation
        if (authorization.movementPolicy.type === 'movement-envelope') {
          return [id, movementEnvelopeReach(
            model.base,
            { position: start, rotation: startRotation },
            { position: final, rotation: finalRotation },
          ).distance]
        }
        const trajectory = action.trajectories?.[id] ?? poseTrajectoryFromPositions(
          action.paths?.[id] ?? [start, final],
          startRotation,
        )
        const metrics = derivePoseTrajectoryMetrics(trajectory)
        return [id, calculatePathMovementCost(authorization.movementPolicy, {
          translationDistance: metrics.centerPathLength,
          angularDistance: metrics.totalAbsoluteAngularTravel,
        }).totalCost]
      }))
      if (modelIds.some((id) => movementUsed[id] > (authorization.remainingByModel[id] ?? 0) + GEOMETRY_EPSILON)) {
        return state
      }
      const unitIds = [...new Set(models.filter((model) => modelIds.includes(model.id)).map((model) => model.unitId))]
      if (unitIds.length !== 1) return state
      const unit = state.units.find((candidate) => candidate.id === unitIds[0])
      const coherencyPolicy = unit
        ? coherencyPolicyFor(runtime.gameSystem.coherency, getUnitCoherencyPolicy(state, unit))
        : undefined
      const validation = validateCandidateFormation({
        allModels: models,
        battlefield: state.battlefield,
        terrainFeatures: state.battlefieldFeatures,
        terrainPolicy: state.terrainPolicy,
        positions: action.finalPositions,
        rotations: action.finalRotations,
        reachability: {
          movementCosts: movementUsed,
          movementAllowances: authorization.remainingByModel,
        },
        ...(unit && coherencyPolicy ? { coherency: { unit, policy: coherencyPolicy } } : {}),
        separationConstraints: authorization.actionContext?.separationConstraints,
        destinationConstraints: authorization.actionContext?.destinationConstraints,
      })
      if (!validation.valid) return state
      const after = gameReducer(state, {
        ...action,
        movementUsed,
        actionContext: authorization.actionContext,
      })
      if (after === state || after.actionHistory.length === state.actionHistory.length || !authorization.actionContext) return after
      return runtime.gameSystem.movement.commitAction?.({
        before: state,
        after,
        context: authorization.actionContext,
      }) ?? after
    }
    case 'score/eventRecorded':
      return authorizeCommand(runtime, state, 'SCORE', [action.playerId]) ? gameReducer(state, action) : state
    case 'lifecycle/modelPresenceSet':
      return authorizeCommand(runtime, state, 'MODEL_PRESENCE', [action.modelId]) ? gameReducer(state, action) : state
    case 'lifecycle/modelsPresenceSet':
      return authorizeCommand(runtime, state, 'MODEL_PRESENCE', action.modelIds) ? gameReducer(state, action) : state
    case 'lifecycle/modelPlaced':
      return authorizeCommand(runtime, state, 'MODEL_PLACEMENT', [action.modelId]) ? gameReducer(state, action) : state
    case 'lifecycle/modelsPlaced':
      return authorizeCommand(runtime, state, 'MODEL_PLACEMENT', Object.keys(action.placements))
        ? gameReducer(state, action)
        : state
    case 'history/undoLastCommitted':
    case 'movement/undoLastConfirmed': {
      const undo = state.lastCommittedOperationUndo
      const operation = undo
        ? state.committedOperations?.find((candidate) => candidate.id === undo.operationId)
        : undefined
      if (operation && runtime.gameSystem.authorizeUndo?.({
        state,
        gameSystemState: runtime.gameSystemState,
        operation,
      }) === false) return state
      return gameReducer(state, action)
    }
    default:
      return gameReducer(state, action)
  }
}
