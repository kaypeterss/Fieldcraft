import type { GameContext, TurnConfiguration } from '../domain/types'

export function advanceTurn(context: GameContext, configuration: TurnConfiguration): GameContext {
  const order = configuration.playerOrder
  if (order.length === 0) return context
  const currentIndex = order.indexOf(context.activePlayerId)
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % order.length
  const nextTurnSequence = context.turnSequence + 1
  return {
    round: context.round + (currentIndex >= 0 && nextIndex === 0 ? 1 : 0),
    turn: nextIndex + 1,
    turnSequence: nextTurnSequence,
    turnId: `turn-${nextTurnSequence}`,
    activePlayerId: order[nextIndex],
    ...(configuration.phases?.[0] ? { phase: configuration.phases[0] } : {}),
  }
}
