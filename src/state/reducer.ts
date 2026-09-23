import type { GameState, MovementSession } from '../domain/types'
import { appendAcceptedPathPoint, resolveRigidTranslation } from '../engine/movement'
import {
  calculatePathMovementCost,
  isPathCostPolicy,
  maximumAdditionalPathRotation,
  maximumAdditionalPathTranslation,
  normalizeMovementPolicy,
} from '../engine/movementCost'
import { movementEnvelopeReach, poseFitsMovementEnvelope, projectPoseIntoMovementEnvelope } from '../engine/movementEnvelope'
import { resolveModelRotation, shortestSignedAngularDelta } from '../engine/rotation'
import { terrainDestinationLegal } from '../engine/terrainPolicy'
import {
  appendPoseTrajectorySegment,
  createPoseTrajectory,
  derivePoseTrajectoryMetrics,
  poseTrajectoryEndPose,
  poseTrajectoryFromPositions,
} from '../engine/trajectory'
import { normalizeRotation } from '../engine/geometry/footprints'
import { GEOMETRY_EPSILON } from '../engine/geometry/tolerance'
import { createMoveAction } from '../game/moveActions'
import { getMovementAllowance } from '../game/selectors'
import { advanceTurn } from '../game/turns'
import { createScoreEvent } from '../game/scoring'
import { createDiceRollRecord, createDiceSequenceRecord, updateDiceRollRecord } from '../game/diceHistory'
import type { GameStateAction } from './actions'

export function gameReducer(state: GameState, action: GameStateAction): GameState {
  switch (action.type) {
    case 'movement/sessionStarted': {
      if (state.movementSession) return state
      const models = state.models.filter((model) => action.modelIds.includes(model.id))
      if (models.length === 0) return state
      if (models.some((model) => getMovementAllowance(state, model) <= GEOMETRY_EPSILON)) return state
      const referenceStart = {
        x: models.reduce((total, model) => total + model.position.x, 0) / models.length,
        y: models.reduce((total, model) => total + model.position.y, 0) / models.length,
      }
      const session: MovementSession = {
        id: action.sessionId,
        movementPolicy: normalizeMovementPolicy(action.movementPolicy),
        modelIds: models.map((model) => model.id),
        referenceStart,
        referencePath: [{ ...referenceStart }],
        models: Object.fromEntries(models.map((model) => [model.id, {
          modelId: model.id,
          startPose: { position: { ...model.position }, rotation: model.rotation },
          trajectory: createPoseTrajectory({ position: model.position, rotation: model.rotation }),
          translationDistance: 0,
          angularRotation: 0,
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
      const pathCostPolicy = isPathCostPolicy(session.movementPolicy) ? session.movementPolicy : null
      const remainingMovement = pathCostPolicy ? new Map(session.modelIds.map((modelId) => {
        const model = state.models.find((candidate) => candidate.id === modelId)
        const movement = session.models[modelId]
        return [modelId, model && movement ? maximumAdditionalPathTranslation(
          pathCostPolicy,
          {
            translationDistance: movement.translationDistance,
            angularDistance: movement.angularRotation,
          },
          getMovementAllowance(state, model),
        ) : 0]
      })) : undefined
      const movementEnvelopes = session.movementPolicy.type === 'movement-envelope'
        ? new Map(session.modelIds.map((modelId) => {
            const model = state.models.find((candidate) => candidate.id === modelId)
            const movement = session.models[modelId]
            return [modelId, {
              startPose: movement.startPose,
              allowance: model ? getMovementAllowance(state, model) : 0,
            }]
          }))
        : undefined
      const resolution = resolveRigidTranslation({
        allModels: state.models,
        modelIds: session.modelIds,
        translation,
        battlefield: state.battlefield,
        terrainFeatures: state.battlefieldFeatures,
        terrainPolicy: state.terrainPolicy,
        remainingMovement,
        movementEnvelopes,
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
          const acceptedPath = resolution.paths.get(modelId)?.slice(1) ?? []
          const model = state.models.find((candidate) => candidate.id === modelId)
          const trajectory = model ? acceptedPath.reduce(
            (current, position) => appendPoseTrajectorySegment(current, {
              endPose: { position, rotation: model.rotation },
              angularDelta: 0,
            }),
            movement.trajectory,
          ) : movement.trajectory
          const trajectoryMetrics = derivePoseTrajectoryMetrics(trajectory)
          return [modelId, acceptedPosition ? {
            ...movement,
            trajectory,
            translationDistance: trajectoryMetrics.centerPathLength,
            angularRotation: trajectoryMetrics.totalAbsoluteAngularTravel,
            movementUsed: model ? movementUsedForPose(
              session,
              model,
              { position: acceptedPosition, rotation: model.rotation },
              trajectoryMetrics,
            ) : movement.movementUsed,
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

    case 'movement/rotationRequested': {
      const session = state.movementSession
      if (!session || session.modelIds.length !== 1 || session.modelIds[0] !== action.modelId) return state
      const model = state.models.find((candidate) => candidate.id === action.modelId)
      if (!model || !Number.isFinite(action.rotation)) return state
      const movement = session.models[model.id]
      if (!movement) return state
      const requestedAngularDelta = shortestSignedAngularDelta(model.rotation, normalizeRotation(action.rotation))
      const maximumAngularDistance = isPathCostPolicy(session.movementPolicy)
        ? maximumAdditionalPathRotation(
            session.movementPolicy,
            {
              translationDistance: movement.translationDistance,
              angularDistance: movement.angularRotation,
            },
            getMovementAllowance(state, model),
          )
        : Number.POSITIVE_INFINITY
      const angularDelta = Math.sign(requestedAngularDelta) * Math.min(
        Math.abs(requestedAngularDelta),
        maximumAngularDistance,
      )
      const resolution = resolveModelRotation({
        allModels: state.models,
        modelId: model.id,
        angularDelta,
        battlefield: state.battlefield,
        terrainFeatures: state.battlefieldFeatures,
        terrainPolicy: state.terrainPolicy,
      })
      const allowance = getMovementAllowance(state, model)
      const requestedPose = { position: model.position, rotation: resolution.rotation }
      const projected = session.movementPolicy.type === 'movement-envelope'
        ? projectPoseIntoMovementEnvelope(model.base, movement.startPose, requestedPose, allowance)
        : { pose: requestedPose, retreat: { x: 0, y: 0 } }
      const rotatedModels = state.models.map((candidate) => candidate.id === model.id
        ? { ...candidate, rotation: resolution.rotation }
        : candidate)
      const retreatResolution = resolveRigidTranslation({
        allModels: rotatedModels,
        modelIds: [model.id],
        translation: projected.retreat,
        battlefield: state.battlefield,
        terrainFeatures: state.battlefieldFeatures,
        terrainPolicy: state.terrainPolicy,
      })
      const finalPosition = retreatResolution.positions.get(model.id) ?? model.position
      const finalRotation = session.movementPolicy.type !== 'movement-envelope'
        || poseFitsMovementEnvelope(model.base, movement.startPose, {
          position: finalPosition,
          rotation: resolution.rotation,
        }, allowance)
        ? resolution.rotation
        : model.rotation
      const acceptedPosition = finalRotation === resolution.rotation ? finalPosition : model.position
      const acceptedAngularRotation = finalRotation === resolution.rotation ? resolution.angularRotation : 0
      const trajectory = appendPoseTrajectorySegment(movement.trajectory, {
        endPose: { position: acceptedPosition, rotation: finalRotation },
        angularDelta: Math.sign(angularDelta) * acceptedAngularRotation,
      })
      const trajectoryMetrics = derivePoseTrajectoryMetrics(trajectory)
      const movementCost = movementUsedForPose(session, model, {
        position: acceptedPosition,
        rotation: finalRotation,
      }, trajectoryMetrics)
      return {
        ...state,
        models: state.models.map((candidate) => candidate.id === model.id
          ? { ...candidate, position: acceptedPosition, rotation: finalRotation }
          : candidate),
        movementSession: {
          ...session,
          referencePath: retreatResolution.translationPath.slice(1).reduce(
            (path, offset) => appendAcceptedPathPoint(path, {
              x: session.referencePath[session.referencePath.length - 1].x + offset.x,
              y: session.referencePath[session.referencePath.length - 1].y + offset.y,
            }),
            session.referencePath,
          ),
          models: {
            ...session.models,
            [model.id]: {
              ...movement,
              trajectory,
              translationDistance: trajectoryMetrics.centerPathLength,
              angularRotation: trajectoryMetrics.totalAbsoluteAngularTravel,
              movementUsed: movementCost,
              path: retreatResolution.paths.get(model.id)?.slice(1)
                .reduce(appendAcceptedPathPoint, movement.path) ?? movement.path,
            },
          },
        },
      }
    }

    case 'movement/confirmed': {
      const session = state.movementSession
      if (!session) return state
      const changed = session.modelIds.some((modelId) => {
        const current = state.models.find((model) => model.id === modelId)
        const start = session.models[modelId]?.startPose
        return current && start && (
          current.position.x !== start.position.x
          || current.position.y !== start.position.y
          || Math.abs(shortestSignedAngularDelta(start.rotation, current.rotation)) > GEOMETRY_EPSILON
        )
      })
      if (!changed) return { ...state, movementSession: null }

      const beforeModels = state.models.map((model) => {
        const startPose = session.models[model.id]?.startPose
        return startPose ? {
          ...model,
          position: { ...startPose.position },
          rotation: startPose.rotation,
        } : { ...model }
      })
      const sequence = state.nextActionSequence
      const participatingModels = session.modelIds
        .map((modelId) => state.models.find((model) => model.id === modelId))
        .filter((model): model is GameState['models'][number] => Boolean(model))
      if (participatingModels.some((model) => !terrainDestinationLegal(
        model, { position: model.position, rotation: model.rotation },
        state.battlefieldFeatures, state.terrainPolicy,
      ))) return state
      const moveAction = createMoveAction({
        sequence,
        actorPlayerId: state.gameContext.activePlayerId,
        gameContext: state.gameContext,
        affectedModels: participatingModels,
        startingPoses: Object.fromEntries(participatingModels.map((model) => [
          model.id,
          session.models[model.id].startPose,
        ])),
        finalPoses: Object.fromEntries(participatingModels.map((model) => [model.id, {
          position: model.position,
          rotation: model.rotation,
        }])),
        trajectories: Object.fromEntries(participatingModels.map((model) => [
          model.id,
          session.models[model.id].trajectory,
        ])),
        translationDistance: Object.fromEntries(participatingModels.map((model) => [
          model.id,
          session.models[model.id].translationDistance,
        ])),
        angularRotation: Object.fromEntries(participatingModels.map((model) => [
          model.id,
          session.models[model.id].angularRotation,
        ])),
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

    case 'movement/validatedCandidateApplied': {
      if (state.movementSession) return state
      const modelIds = Object.keys(action.finalPositions).sort((a, b) => a.localeCompare(b))
      if (modelIds.length === 0
        || !sameIdSet(modelIds, Object.keys(action.startingPositions))
        || !sameIdSet(modelIds, Object.keys(action.movementUsed))
        || (action.startingRotations && !sameIdSet(modelIds, Object.keys(action.startingRotations)))
        || (action.finalRotations && !sameIdSet(modelIds, Object.keys(action.finalRotations)))
        || (action.trajectories && Object.keys(action.trajectories).some((id) => !modelIds.includes(id)))
        || (action.paths && !sameIdSet(modelIds, Object.keys(action.paths)))) return state
      const affectedModels = modelIds.flatMap((modelId) => {
        const model = state.models.find((candidate) => candidate.id === modelId)
        return model ? [model] : []
      })
      if (affectedModels.length !== modelIds.length) return state
      const inputValid = affectedModels.every((model) => {
        const start = action.startingPositions[model.id]
        const final = action.finalPositions[model.id]
        const used = action.movementUsed[model.id]
        const path = action.paths?.[model.id]
        const finalRotation = action.finalRotations?.[model.id] ?? model.rotation
        const trajectory = action.trajectories?.[model.id]
        const trajectoryEnd = trajectory ? poseTrajectoryEndPose(trajectory) : null
        return start && final
          && Number.isFinite(start.x) && Number.isFinite(start.y)
          && Number.isFinite(final.x) && Number.isFinite(final.y)
          && Number.isFinite(used) && used >= 0
          && Number.isFinite(finalRotation)
          && (action.startingRotations === undefined
            || Math.abs(shortestSignedAngularDelta(model.rotation, action.startingRotations[model.id])) <= GEOMETRY_EPSILON)
          && (!trajectory || (Math.abs(trajectory.startPose.position.x - start.x) <= GEOMETRY_EPSILON
            && Math.abs(trajectory.startPose.position.y - start.y) <= GEOMETRY_EPSILON
            && Math.abs(shortestSignedAngularDelta(trajectory.startPose.rotation, model.rotation)) <= GEOMETRY_EPSILON
            && trajectoryEnd !== null
            && Math.abs(trajectoryEnd.position.x - final.x) <= GEOMETRY_EPSILON
            && Math.abs(trajectoryEnd.position.y - final.y) <= GEOMETRY_EPSILON
            && Math.abs(shortestSignedAngularDelta(trajectoryEnd.rotation, finalRotation)) <= GEOMETRY_EPSILON))
          && (!path || validCenterPath(path, start, final))
          && Math.abs(model.position.x - start.x) <= GEOMETRY_EPSILON
          && Math.abs(model.position.y - start.y) <= GEOMETRY_EPSILON
      })
      if (!inputValid) return state
      if (affectedModels.some((model) => !terrainDestinationLegal(model, {
        position: action.finalPositions[model.id],
        rotation: action.finalRotations?.[model.id] ?? model.rotation,
      }, state.battlefieldFeatures, state.terrainPolicy))) return state
      const changedModels = affectedModels.filter((model) => {
        const final = action.finalPositions[model.id]
        return Math.abs(model.position.x - final.x) > GEOMETRY_EPSILON
          || Math.abs(model.position.y - final.y) > GEOMETRY_EPSILON
          || Math.abs(shortestSignedAngularDelta(model.rotation,
            action.finalRotations?.[model.id] ?? model.rotation)) > GEOMETRY_EPSILON
      })
      if (changedModels.length === 0) return state

      const beforeModels = state.models.map((model) => ({ ...model, position: { ...model.position } }))
      const sequence = state.nextActionSequence
      const moveAction = createMoveAction({
        sequence,
        actorPlayerId: state.gameContext.activePlayerId,
        gameContext: state.gameContext,
        affectedModels: changedModels,
        startingPoses: Object.fromEntries(affectedModels.map((model) => [model.id, {
          position: action.startingPositions[model.id],
          rotation: action.startingRotations?.[model.id] ?? model.rotation,
        }])),
        finalPoses: Object.fromEntries(affectedModels.map((model) => [model.id, {
          position: action.finalPositions[model.id],
          rotation: action.finalRotations?.[model.id] ?? model.rotation,
        }])),
        trajectories: Object.fromEntries(affectedModels.map((model) => [model.id,
          action.trajectories?.[model.id] ?? poseTrajectoryFromPositions(
            action.paths?.[model.id] ?? [action.startingPositions[model.id], action.finalPositions[model.id]],
            model.rotation,
          ),
        ])),
        translationDistance: Object.fromEntries(affectedModels.map((model) => [model.id,
          action.trajectories?.[model.id]
            ? derivePoseTrajectoryMetrics(action.trajectories[model.id]).centerPathLength
            : action.movementUsed[model.id],
        ])),
        angularRotation: Object.fromEntries(affectedModels.map((model) => [model.id,
          action.trajectories?.[model.id]
            ? derivePoseTrajectoryMetrics(action.trajectories[model.id]).totalAbsoluteAngularTravel
            : 0,
        ])),
        movementUsed: action.movementUsed,
      })
      return {
        ...state,
        models: state.models.map((model) => {
          const final = action.finalPositions[model.id]
          return final ? { ...model, position: { ...final },
            rotation: normalizeRotation(action.finalRotations?.[model.id] ?? model.rotation) } : model
        }),
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
          const startPose = session.models[model.id]?.startPose
          return startPose ? {
            ...model,
            position: { ...startPose.position },
            rotation: startPose.rotation,
          } : model
        }),
        movementSession: null,
      }
    }

    case 'score/eventRecorded': {
      if (!state.players.some((player) => player.id === action.playerId)) return state
      try {
        const scoreEvent = createScoreEvent({
          sequence: state.nextActionSequence,
          playerId: action.playerId,
          pointsDelta: action.pointsDelta,
          reason: action.reason,
          gameContext: state.gameContext,
          source: action.source,
        })
        return {
          ...state,
          scoreHistory: [...(state.scoreHistory ?? []), scoreEvent],
          nextActionSequence: state.nextActionSequence + 1,
        }
      } catch {
        return state
      }
    }

    case 'score/lastEventUndone': {
      const scoreHistory = state.scoreHistory ?? []
      const lastScoreEvent = scoreHistory[scoreHistory.length - 1]
      if (!lastScoreEvent) return state
      return {
        ...state,
        scoreHistory: scoreHistory.filter((scoreEvent) => scoreEvent.id !== lastScoreEvent.id),
      }
    }

    case 'dice/rollRecorded': {
      if (!state.players.some((player) => player.id === action.playerId)) return state
      try {
        const roll = createDiceRollRecord({
          sequence: state.nextActionSequence,
          playerId: action.playerId,
          gameContext: state.gameContext,
          result: action.result,
        })
        return {
          ...state,
          diceHistory: [...(state.diceHistory ?? []), roll],
          nextActionSequence: state.nextActionSequence + 1,
        }
      } catch {
        return state
      }
    }

    case 'dice/rollUpdated': {
      const history = state.diceHistory ?? []
      if (!history.some((roll) => roll.type === 'DICE_ROLL' && roll.id === action.rollId)) return state
      try {
        return {
          ...state,
          diceHistory: history.map((roll) => roll.type === 'DICE_ROLL' && roll.id === action.rollId
            ? updateDiceRollRecord(roll, action.result)
            : roll),
        }
      } catch {
        return state
      }
    }

    case 'dice/sequenceRecorded': {
      if (!state.players.some((player) => player.id === action.playerId)) return state
      try {
        const sequence = createDiceSequenceRecord({
          sequence: state.nextActionSequence,
          playerId: action.playerId,
          gameContext: state.gameContext,
          resolution: action.resolution,
        })
        return {
          ...state,
          diceHistory: [...(state.diceHistory ?? []), sequence],
          nextActionSequence: state.nextActionSequence + 1,
        }
      } catch {
        return state
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

function movementUsedForPose(
  session: MovementSession,
  model: GameState['models'][number],
  pose: { position: { x: number; y: number }; rotation: number },
  metrics: { centerPathLength: number; totalAbsoluteAngularTravel: number },
): number {
  const movement = session.models[model.id]
  if (!movement) return 0
  if (session.movementPolicy.type === 'movement-envelope') {
    return movementEnvelopeReach(model.base, movement.startPose, pose).distance
  }
  return calculatePathMovementCost(session.movementPolicy, {
    translationDistance: metrics.centerPathLength,
    angularDistance: metrics.totalAbsoluteAngularTravel,
  }).totalCost
}

function validCenterPath(
  path: ReadonlyArray<{ x: number; y: number }>,
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean {
  if (path.length === 0 || path.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return false
  }
  const first = path[0]
  const last = path[path.length - 1]
  return Math.abs(first.x - start.x) <= GEOMETRY_EPSILON
    && Math.abs(first.y - start.y) <= GEOMETRY_EPSILON
    && Math.abs(last.x - end.x) <= GEOMETRY_EPSILON
    && Math.abs(last.y - end.y) <= GEOMETRY_EPSILON
}
