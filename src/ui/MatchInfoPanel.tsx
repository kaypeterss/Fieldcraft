import type { GameState } from '../domain/types'
import type { GameSystemUiContribution } from '../gameSystem/registry'

export function MatchInfoPanel({ gameSystemName, gameState, ui, runtimeFacts = [], onClose }: {
  gameSystemName: string
  gameState: GameState
  ui: GameSystemUiContribution
  runtimeFacts?: Array<{ label: string; value: string }>
  onClose: () => void
}) {
  return <aside className="match-info-panel" aria-label="Match Info">
    <div className="context-panel-heading">
      <div><span className="eyebrow">MATCH INFO</span><h2>{ui.shell?.shortName ?? gameSystemName}</h2></div>
      <button type="button" className="panel-close" aria-label="Close Match Info" onClick={onClose}>×</button>
    </div>
    <dl>
      {(ui.matchInfo?.facts ?? []).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      {runtimeFacts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      <div><dt>Battlefield</dt><dd>{gameState.battlefield.width} × {gameState.battlefield.height}″</dd></div>
      <div><dt>Status</dt><dd>{gameState.matchLifecycle ?? 'SETUP'}</dd></div>
      {gameState.resolvedMatchConfiguration?.roundLimit !== undefined &&
        <div><dt>Rounds</dt><dd>{gameState.resolvedMatchConfiguration.roundLimit}</dd></div>}
    </dl>
    <div className="panel-section-label">PLAYERS</div>
    <div className="match-info-players">
      {gameState.players.map((player) => <div key={player.id}>
        <strong>{player.displayName}</strong>
        {ui.matchInfo?.playerLabels?.[player.id] && <span>{ui.matchInfo.playerLabels[player.id]}</span>}
      </div>)}
    </div>
  </aside>
}
