import type { GameSystemUiContribution } from '../gameSystem/registry'
import type { GameState } from '../domain/types'

export function GameSystemStatusPanel({ ui, gameState }: { ui: GameSystemUiContribution; gameState?: GameState }) {
  return (
    <section className="game-system-status" aria-label="GameSystem status">
      <div>
        <span>{ui.status.eyebrow}</span>
        <strong>{ui.status.title}</strong>
      </div>
      <dl>
        {gameState?.matchIdentity?.matchName && <div><dt>Match</dt><dd>{gameState.matchIdentity.matchName}</dd></div>}
        {gameState && <div><dt>Status</dt><dd>{gameState.matchLifecycle ?? 'SETUP'}</dd></div>}
        {ui.status.details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
      {ui.status.message && <p>{ui.status.message}</p>}
    </section>
  )
}
