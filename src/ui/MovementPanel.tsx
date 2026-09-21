import { formatInches } from '../engine/units'

export interface MovementSummary {
  participantCount: number
  allowanceLabel: string
  maximumUsed: number
  minimumRemaining: number
}

interface MovementPanelProps {
  summary: MovementSummary
  onConfirm: () => void
  onCancel: () => void
}

export function MovementPanel({ summary, onConfirm, onCancel }: MovementPanelProps) {
  return (
    <aside className="movement-panel" aria-live="polite">
      <div className="movement-panel-heading">
        <div><span className="eyebrow">ACTIVE MOVE</span><strong>{summary.participantCount === 1 ? '1 model' : `${summary.participantCount} models`}</strong></div>
        <span className="movement-pulse" />
      </div>
      <dl>
        <div><dt>Allowance</dt><dd>{summary.allowanceLabel}</dd></div>
        <div><dt>Maximum used</dt><dd>{formatInches(summary.maximumUsed)}</dd></div>
        <div><dt>Minimum remaining</dt><dd>{formatInches(summary.minimumRemaining)}</dd></div>
      </dl>
      <div className="movement-actions">
        <button className="cancel-move" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
        <button className="confirm-move" onClick={onConfirm}>Confirm move <kbd>Enter</kbd></button>
      </div>
    </aside>
  )
}
