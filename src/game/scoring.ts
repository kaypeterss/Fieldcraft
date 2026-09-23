import type { GameContext, ScoreEvent, ScoreEventSource } from '../domain/types'

export interface CreateScoreEventRequest {
  sequence: number
  playerId: string
  pointsDelta: number
  reason: string
  gameContext: GameContext
  source?: ScoreEventSource
}

/** Shared factory for manual adjustments now and automatic GameSystem scoring later. */
export function createScoreEvent(request: CreateScoreEventRequest): ScoreEvent {
  if (!Number.isFinite(request.pointsDelta) || request.pointsDelta === 0) {
    throw new RangeError('Score delta must be finite and non-zero')
  }
  const reason = request.reason.trim()
  if (!reason) throw new RangeError('Score reason is required')
  return {
    id: `action-${request.sequence}`,
    sequence: request.sequence,
    type: 'SCORE',
    playerId: request.playerId,
    round: request.gameContext.round,
    turn: request.gameContext.turn,
    turnSequence: request.gameContext.turnSequence,
    turnId: request.gameContext.turnId,
    ...(request.gameContext.phase ? { phase: request.gameContext.phase } : {}),
    payload: {
      pointsDelta: request.pointsDelta,
      reason,
      ...(request.source ? { source: { ...request.source } } : {}),
    },
  }
}

export function scoreTotalForPlayer(events: readonly ScoreEvent[], playerId: string): number {
  return events.reduce((total, event) => event.playerId === playerId
    ? total + event.payload.pointsDelta
    : total, 0)
}

export function scoreTotals(
  events: readonly ScoreEvent[],
  playerIds: readonly string[],
): Record<string, number> {
  return Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    scoreTotalForPlayer(events, playerId),
  ]))
}
