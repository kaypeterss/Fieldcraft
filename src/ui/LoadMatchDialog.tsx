import type { SavedMatchMetadata } from '../game/matchPersistence'

export function LoadMatchDialog({ matches, onLoad, onDelete, onCancel }: {
  matches: readonly SavedMatchMetadata[]
  onLoad: (matchId: string) => void
  onDelete: (matchId: string) => void
  onCancel: () => void
}) {
  const groups = [...new Set(matches.map((match) => match.gameSystemName ?? match.gameSystemId))]
  return <div className="match-dialog-backdrop" role="presentation">
    <section className="match-dialog load-match-dialog" role="dialog" aria-modal="true" aria-labelledby="load-match-title">
      <span className="eyebrow">FIELDCRAFT</span><h1 id="load-match-title">Load Match</h1>
      {matches.length === 0 && <p className="muted">No saved matches yet.</p>}
      {groups.map((group) => <div key={group} className="saved-match-group"><h2>{group}</h2>{matches.filter((match) => (match.gameSystemName ?? match.gameSystemId) === group).map((match) => (
        <article className="saved-match-row" key={match.matchId}>
          <div><strong>{match.matchName}</strong><small>{match.lifecycle} · {new Date(match.savedAt).toLocaleString()}</small>{!match.valid && <small className="match-notice error">Unavailable: {match.error}</small>}</div>
          <div className="button-row"><button type="button" disabled={!match.valid} onClick={() => onLoad(match.matchId)}>Load</button><button type="button" onClick={() => onDelete(match.matchId)}>Delete</button></div>
        </article>
      ))}</div>)}
      <div className="match-dialog-actions"><button type="button" onClick={onCancel}>Close</button></div>
    </section>
  </div>
}
