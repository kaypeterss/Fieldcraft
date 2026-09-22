import { formatInches } from '../engine/units'

export interface MovementSummary {
  participantCount: number
  allowanceLabel: string
  maximumUsed: number
  minimumRemaining: number
  maximumTranslationDistance: number
  maximumRotationCost: number
  maximumRotationDegrees: number
  policyLabel: string
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
        <div><dt>Movement</dt><dd>{formatInches(summary.maximumUsed)} / {summary.allowanceLabel}</dd></div>
        <div><dt>Translation travelled</dt><dd>{formatInches(summary.maximumTranslationDistance)}</dd></div>
        <div><dt>Rotation travelled</dt><dd>{summary.maximumRotationDegrees.toFixed(1)}°</dd></div>
        <div><dt>Rotation cost</dt><dd>{formatInches(summary.maximumRotationCost)}</dd></div>
        <div><dt>Remaining</dt><dd>{formatInches(summary.minimumRemaining)}</dd></div>
        <div><dt>Policy</dt><dd>{summary.policyLabel}</dd></div>
      </dl>
      {summary.participantCount === 1 && (
        <p className="movement-handoff-hint">Click another model in this unit to confirm and continue.</p>
      )}
      <div className="movement-actions">
        <button className="cancel-move" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
        <button className="confirm-move" onClick={onConfirm}>Confirm move <kbd>Enter</kbd></button>
      </div>
    </aside>
  )
}
