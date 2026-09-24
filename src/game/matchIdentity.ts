import type { GameState, MatchIdentity } from '../domain/types'

export type MatchIdFactory = () => string

export const randomMatchId: MatchIdFactory = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function withMatchIdentity(state: GameState, name?: string, idFactory: MatchIdFactory = randomMatchId): GameState {
  const identity = state.matchIdentity
  if (!identity) throw new Error('Cannot assign match identity to a state without a GameSystem identity.')
  const matchId = identity.matchId ?? idFactory()
  const matchName = name?.trim() || identity.matchName || `${identity.gameSystem.id} match`
  return {
    ...state,
    matchLifecycle: state.matchLifecycle ?? 'SETUP',
    matchIdentity: { ...identity, matchId, matchName },
  }
}

export function matchDisplayName(identity: MatchIdentity): string {
  return identity.matchName?.trim() || `${identity.gameSystem.id} match`
}
