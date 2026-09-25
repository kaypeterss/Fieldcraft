import type {
  GameState,
  GameSystemOwnedState,
  MatchIdentity,
  MovementPolicyConfig,
  ResolvedMovementActionContext,
  ResolvedMatchConfiguration,
  TabletopModel,
} from '../domain/types'
import { GEOMETRY_EPSILON } from '../engine/geometry/tolerance'
import { getMovementAllowance } from '../game/selectors'
import { activeBattlefieldModels } from '../game/modelPresence'
import { movementPermissionForUnit } from './policies'
import type { GameSystemRegistry, RegisteredGameSystem } from './registry'
import type { GameSystem, MovementPermissionResult } from './types'

export interface LoadedMatchRuntime {
  identity: MatchIdentity
  configuration: ResolvedMatchConfiguration
  gameSystem: GameSystem
  gameSystemState: GameSystemOwnedState
  movementPolicy: MovementPolicyConfig
  registration?: RegisteredGameSystem
}

export interface MovementAuthorization {
  allowed: boolean
  reason?: string
  movementPolicy: MovementPolicyConfig
  remainingByModel: Record<string, number>
  unitPermissions: Record<string, MovementPermissionResult>
  actionContext?: ResolvedMovementActionContext
}

/** Normal application loader: identity and content are resolved exactly through the registry. */
export function loadRegisteredMatchRuntime(
  state: GameState,
  registry: GameSystemRegistry,
  developmentOverrides?: { movementPolicy?: MovementPolicyConfig },
): LoadedMatchRuntime {
  if (!state.matchIdentity) throw new Error('Saved match has no GameSystem identity')
  const resolved = registry.resolveIdentity(state.matchIdentity)
  const runtime = loadMatchRuntime(
    state,
    resolved.gameSystem,
    resolved.registration.ui.developmentControls ? developmentOverrides : undefined,
  )
  return { ...runtime, registration: resolved.registration }
}

export function loadMatchRuntime(
  state: GameState,
  gameSystem: GameSystem,
  developmentOverrides?: { movementPolicy?: MovementPolicyConfig },
): LoadedMatchRuntime {
  const identity = state.matchIdentity
  if (!identity || identity.gameSystem.id !== gameSystem.id || identity.gameSystem.version !== gameSystem.version) {
    throw new Error('Saved match GameSystem identity does not match the loaded GameSystem')
  }
  const configuration = state.resolvedMatchConfiguration
  if (!configuration) throw new Error('Saved match has no resolved match configuration')
  const gameSystemState = validateGameSystemOwnedState(state.gameSystemState, gameSystem)
  return {
    identity,
    configuration,
    gameSystem,
    gameSystemState,
    movementPolicy: developmentOverrides?.movementPolicy ?? gameSystem.movement.cost,
  }
}

export function initialGameSystemOwnedState(gameSystem: GameSystem): GameSystemOwnedState {
  const data = gameSystem.matchState.createInitialData()
  if (!gameSystem.matchState.validate(data)) throw new Error('GameSystem produced invalid initial match state')
  return {
    schemaId: gameSystem.matchState.schemaId,
    schemaVersion: gameSystem.matchState.schemaVersion,
    data,
  }
}

export function validateGameSystemOwnedState(
  state: GameSystemOwnedState | undefined,
  gameSystem: GameSystem,
): GameSystemOwnedState {
  if (!state
    || state.schemaId !== gameSystem.matchState.schemaId
    || state.schemaVersion !== gameSystem.matchState.schemaVersion
    || !gameSystem.matchState.validate(state.data)) {
    throw new Error('Saved GameSystem-owned state failed schema validation')
  }
  return state
}

export function authorizeMovement(
  runtime: LoadedMatchRuntime,
  state: GameState,
  modelIds: readonly string[],
): MovementAuthorization {
  const activeById = new Map(activeBattlefieldModels(state).map((model) => [model.id, model]))
  const models = modelIds.flatMap((id) => {
    const model = activeById.get(id)
    return model ? [model] : []
  })
  if (models.length !== modelIds.length || models.length === 0) {
    return denied(runtime, 'Only models currently on the battlefield can move.')
  }

  const phase = runtime.gameSystem.turns.phases.find((candidate) => candidate.id === state.gameContext.phase)
  if (phase && !phase.allowsMovement) return denied(runtime, 'Movement is not allowed in the current phase.')
  if (runtime.gameSystem.authorizeCommand?.({
    kind: 'MOVE',
    actorPlayerId: state.gameContext.activePlayerId,
    entityIds: modelIds,
    state,
    gameSystemState: runtime.gameSystemState,
  }) === false) return denied(runtime, 'The loaded GameSystem does not permit this movement.')

  const unitIds = [...new Set(models.map((model) => model.unitId))]
  if (unitIds.length === 1 && runtime.gameSystem.movement.resolveActionContext) {
    const resolution = runtime.gameSystem.movement.resolveActionContext({
      state,
      gameSystemState: runtime.gameSystemState,
      unitId: unitIds[0],
      modelIds,
    })
    if (!resolution.allowed) return denied(runtime, resolution.reason)
    const remainingByModel = { ...resolution.context.movementAllowanceByModel }
    if (modelIds.some((id) => remainingByModel[id] <= GEOMETRY_EPSILON)) {
      return denied(runtime, 'This unit has no movement allowance remaining under the active GameSystem.')
    }
    return {
      allowed: true,
      movementPolicy: runtime.movementPolicy,
      remainingByModel,
      unitPermissions: {},
      actionContext: resolution.context,
    }
  }
  const unitPermissions: Record<string, MovementPermissionResult> = {}
  const remainingByModel: Record<string, number> = {}
  for (const unitId of unitIds) {
    const unit = state.units.find((candidate) => candidate.id === unitId)
    const unitModels = models.filter((model) => model.unitId === unitId)
    if (!unit || unitModels.length === 0) return denied(runtime, 'Movement unit data is incomplete.')
    const permission = movementPermissionForUnit({
      policy: runtime.gameSystem.movement.permissions,
      actions: state.actionHistory,
      gameContext: state.gameContext,
      unitId,
      modelIds: unit.modelIds,
      baseAllowance: Math.min(...unitModels.map((model) => getMovementAllowance(state, model))),
      ...runtime.gameSystem.movement.resolveGrants?.({
        state,
        gameSystemState: runtime.gameSystemState,
        unitId,
        modelIds: unit.modelIds,
      }),
    })
    unitPermissions[unitId] = permission
    for (const model of unitModels) remainingByModel[model.id] = permission.remainingAllowance
    if (!permission.canStartAction || permission.remainingAllowance <= GEOMETRY_EPSILON) {
      return {
        allowed: false,
        reason: !permission.canStartAction
          ? 'This unit has no movement actions remaining under the active GameSystem.'
          : 'This unit has no movement allowance remaining under the active GameSystem.',
        movementPolicy: runtime.movementPolicy,
        remainingByModel,
        unitPermissions,
      }
    }
  }
  return { allowed: true, movementPolicy: runtime.movementPolicy, remainingByModel, unitPermissions }
}

export function authorizeCommand(
  runtime: LoadedMatchRuntime,
  state: GameState,
  kind: 'SCORE' | 'MODEL_PRESENCE' | 'MODEL_PLACEMENT',
  entityIds: readonly string[],
): boolean {
  return runtime.gameSystem.authorizeCommand?.({
    kind,
    actorPlayerId: state.gameContext.activePlayerId,
    entityIds,
    state,
    gameSystemState: runtime.gameSystemState,
  }) !== false
}

function denied(runtime: LoadedMatchRuntime, reason: string): MovementAuthorization {
  return {
    allowed: false,
    reason,
    movementPolicy: runtime.movementPolicy,
    remainingByModel: {},
    unitPermissions: {},
  }
}

export function movementModels(state: GameState, modelIds: readonly string[]): TabletopModel[] {
  const ids = new Set(modelIds)
  return activeBattlefieldModels(state).filter((model) => ids.has(model.id))
}
