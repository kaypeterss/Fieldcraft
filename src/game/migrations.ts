import type { GameState, MatchIdentity, ResolvedMatchConfiguration } from '../domain/types'
import type { GameSystem } from '../gameSystem/types'
import { initialGameSystemOwnedState } from '../gameSystem/runtime'

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
  }
}
