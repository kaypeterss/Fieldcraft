import type { GameSystemUiContribution } from '../gameSystem/registry'
import type { GameState } from '../domain/types'
import { Scoreboard } from './Scoreboard'

export function GameSystemStatusPanel({ ui, gameState, onPrepare }: {
  ui: GameSystemUiContribution
  gameState?: GameState
  onPrepare?: () => void
}) {
  return (
    <section className="game-system-status" aria-label="GameSystem status">
      {gameState && <Scoreboard players={gameState.players} events={gameState.scoreHistory ?? []}
        showControls={false} />}
      <div className="shell-state-summary">
        <span>{gameState?.matchLifecycle ?? 'SETUP'}</span>
        <strong>{gameState?.matchLifecycle === 'DEPLOYMENT' ? 'Deployment setup ready' : ui.status.title}</strong>
      </div>
      {gameState?.matchLifecycle === 'SETUP' && onPrepare
        ? <button type="button" className="primary-progression" onClick={onPrepare}>Prepare Match</button>
        : <button type="button" className="primary-progression" disabled title="Deployment begins in M9.3">Continue</button>}
      {gameState?.matchLifecycle === 'DEPLOYMENT' && <small className="progression-hint">Deployment begins in M9.3.</small>}
    </section>
  )
}
