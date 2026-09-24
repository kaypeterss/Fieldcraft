interface MatchControlsProps {
  notice?: string | null
  error?: boolean
  onNewMatch: () => void
  onSave: () => void
  onLoad: () => void
  onSaveAs: () => void
  matchName?: string
  gameSystemName?: string
  missionName?: string
  onMatchInfo: () => void
}

export function MatchControls({ notice, error, onNewMatch, onSave, onLoad, onSaveAs,
  matchName, gameSystemName, missionName, onMatchInfo }: MatchControlsProps) {
  return (
    <div className="match-controls" aria-label="Match controls">
      {notice && <span className={error ? 'match-notice error' : 'match-notice'} role="status">{notice}</span>}
      <details>
        <summary>Match ▾</summary>
        <div className="match-menu-popover">
          <button type="button" onClick={onSave}>Save</button>
          <button type="button" onClick={onSaveAs}>Save As…</button>
          <button type="button" onClick={onLoad}>Load Match…</button>
          <button type="button" onClick={onNewMatch}>New Match…</button>
          <button type="button" className="match-info-action" onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open')
            onMatchInfo()
          }}>Match Info</button>
          <div className="match-menu-info"><strong>{matchName ?? 'Unnamed Match'}</strong>
            <small>{gameSystemName}{missionName ? ` · ${missionName}` : ''}</small></div>
        </div>
      </details>
    </div>
  )
}
