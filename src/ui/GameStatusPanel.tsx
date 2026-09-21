import type { GameState } from '../domain/types'
import { hasUnitPerformedAction } from '../game/actionQueries'
import { getUnitDefinition } from '../game/selectors'

interface GameStatusPanelProps {
  gameState: GameState
  blockedMessage: string | null
  onEndTurn: () => void
}

export function GameStatusPanel({ gameState, blockedMessage, onEndTurn }: GameStatusPanelProps) {
  const { gameContext } = gameState
  const activePlayer = gameState.players.find((player) => player.id === gameContext.activePlayerId)

  return (
    <section className="game-status" aria-label="Game status">
      <div className="turn-summary">
        <span>R{gameContext.round}/T{gameContext.turn}</span>
        <strong>{activePlayer?.displayName ?? gameContext.activePlayerId} TURN</strong>
        {gameContext.phase && <small>{gameContext.phase}</small>}
      </div>
      <button type="button" className="end-turn" onClick={onEndTurn}>End Turn</button>
      <details className="unit-status-menu">
        <summary>Units</summary>
        <div className="status-popover">
          <span className="popover-title">MOVEMENT · THIS TURN</span>
          {gameState.units.map((unit) => (
            <div className="unit-status-row" key={unit.id}>
              <span>{getUnitDefinition(gameState, unit)?.name ?? unit.id}</span>
              <strong className={hasUnitPerformedAction(gameState.actionHistory, unit.id, 'MOVE', gameContext) ? 'moved' : ''}>
                {hasUnitPerformedAction(gameState.actionHistory, unit.id, 'MOVE', gameContext) ? 'Moved' : '—'}
              </strong>
            </div>
          ))}
        </div>
      </details>
      <details className="action-history-menu">
        <summary>History {gameState.actionHistory.length}</summary>
        <div className="status-popover action-history-list">
          <span className="popover-title">CONFIRMED ACTIONS</span>
          {gameState.actionHistory.length === 0 && <p>No confirmed actions yet.</p>}
          {[...gameState.actionHistory].reverse().map((action) => {
            const unitNames = action.payload.unitIds.map((unitId) => {
              const unit = gameState.units.find((candidate) => candidate.id === unitId)
              return unit ? getUnitDefinition(gameState, unit)?.name ?? unit.id : unitId
            })
            const player = gameState.players.find((candidate) => candidate.id === action.playerId)
            return (
              <div className="history-row" key={action.id}>
                <strong>#{action.sequence} {action.type}</strong>
                <span>{unitNames.join(', ')} · {player?.displayName ?? action.playerId} · R{action.round}/T{action.turn}</span>
              </div>
            )
          })}
        </div>
      </details>
      {blockedMessage && <div className="turn-blocked" role="status">{blockedMessage}</div>}
    </section>
  )
}
