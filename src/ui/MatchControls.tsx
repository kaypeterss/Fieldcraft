interface MatchControlsProps {
  notice?: string | null
  error?: boolean
  onNewMatch: () => void
  onSave: () => void
  onLoad: () => void
  onSaveAs: () => void
}

export function MatchControls({ notice, error, onNewMatch, onSave, onLoad, onSaveAs }: MatchControlsProps) {
  return (
    <div className="match-controls" aria-label="Match controls">
      {notice && <span className={error ? 'match-notice error' : 'match-notice'} role="status">{notice}</span>}
      <button type="button" onClick={onNewMatch}>New Match</button>
      <button type="button" onClick={onSave}>Save</button>
      <button type="button" onClick={onSaveAs}>Save As</button>
      <button type="button" onClick={onLoad}>Load</button>
    </div>
  )
}
