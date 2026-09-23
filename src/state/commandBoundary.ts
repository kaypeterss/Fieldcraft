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
    case 'movement/sessionStarted': {
      const authorization = authorizeMovement(runtime, state, action.modelIds)
      if (!authorization.allowed) return state
      return gameReducer(state, {
        ...action,
        movementPolicy: authorization.movementPolicy,
        movementAllowanceByModel: authorization.remainingByModel,
      })
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
      })
      if (!validation.valid) return state
      return gameReducer(state, { ...action, movementUsed })
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
    default:
      return gameReducer(state, action)
  }
}
