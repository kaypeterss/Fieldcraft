import type { GameState, MatchIdentity, ResolvedMatchConfiguration } from '../domain/types'
import { developmentContentManifest, developmentGameSystem } from '../gameSystem/developmentGameSystem'
import type { GameSystem } from '../gameSystem/types'
import { initialGameSystemOwnedState } from '../gameSystem/runtime'
import { withMatchIdentity } from './matchIdentity'

export function migrateGameStateToV4(
  state: GameState,
  gameSystem: GameSystem,
  identity: MatchIdentity,
  configuration: ResolvedMatchConfiguration,
): GameState {
  if (state.schemaVersion === 4) return state
  return {
    ...state,
    schemaVersion: 4,
    matchIdentity: structuredClone(identity),
    resolvedMatchConfiguration: structuredClone(configuration),
    gameSystemState: initialGameSystemOwnedState(gameSystem),
    models: state.models.map((model) => ({ ...model, presence: model.presence ?? 'ON_BATTLEFIELD' })),
    committedOperations: [],
    lastCommittedOperationUndo: null,
    lastConfirmedMovementUndo: null,
    matchLifecycle: 'SETUP',
  }
}

/**
 * M9.1 has only one legacy source: pre-registry Development matches. They are
 * upgraded explicitly; no unknown or future GameSystem is assigned content.
 */
export function migrateDevelopmentGameStateToV5(
  state: GameState,
  identity: MatchIdentity,
  configuration: ResolvedMatchConfiguration,
): GameState {
  const v4 = state.schemaVersion === 3
    ? migrateGameStateToV4(state, developmentGameSystem, identity, configuration)
    : state
  const persistedSystem = v4.matchIdentity?.gameSystem
  if (!persistedSystem
    || persistedSystem.id !== developmentGameSystem.id
    || persistedSystem.version !== developmentGameSystem.version) {
    throw new Error('Only legacy Development matches can be migrated to the M9.1 registry schema.')
  }
  return withMatchIdentity({
    ...v4,
    schemaVersion: 5,
    matchIdentity: {
      ...structuredClone(v4.matchIdentity),
      gameSystem: { ...persistedSystem },
      contentManifest: developmentContentManifest.map((entry) => ({ ...entry })),
    },
    matchLifecycle: v4.matchLifecycle ?? 'SETUP',
  }, v4.matchIdentity?.matchName)
}
