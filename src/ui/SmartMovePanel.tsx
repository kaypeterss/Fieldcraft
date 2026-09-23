import type { SmartMoveResult } from '../engine/smartMove'
import type { CoherencyPolicy } from '../domain/types'
import type { SmartMoveAsyncStatus } from '../tools/smartMoveWorkerController'
import { smartMoveBadge } from './smartMoveStatus'

interface SmartMovePanelProps {
  selectedCount: number
  unitSize: number
  unitName?: string
  coherencyPolicy?: CoherencyPolicy
  targetMode: 'live' | 'locked'
  result: SmartMoveResult | null
  asyncStatus: SmartMoveAsyncStatus
  thinkingVisible: boolean
  canApply: boolean
  errorMessage?: string
  message?: string
  onApply: () => void
  onCancel: () => void
}

export function SmartMovePanel(props: SmartMovePanelProps) {
  const badge = smartMoveBadge(props.asyncStatus)
  const result = props.asyncStatus === 'ready-valid' || props.asyncStatus === 'ready-invalid'
    ? props.result : null
  const diagnostics = result?.diagnostics
  return (
    <aside className="smart-move-panel" aria-label="Smart Move preview">
      <div className="smart-move-panel-heading">
        <div><span className="eyebrow">FORMATION PREVIEW</span><h2>Smart Move</h2></div>
        <span className={`smart-candidate ${badge.tone}`}>{badge.label}</span>
      </div>
      <dl>
        <div><dt>Selected</dt><dd>{props.selectedCount} / {props.unitSize} models</dd></div>
        <div><dt>Unit</dt><dd>{props.unitName ?? '—'}</dd></div>
        <div><dt>Target</dt><dd>{props.targetMode === 'locked' ? 'Locked' : 'Live'}</dd></div>
        <div><dt>Coherency</dt><dd>{props.coherencyPolicy ? `${props.coherencyPolicy.distance}″` : '—'}</dd></div>
        <div><dt>Required neighbors</dt><dd>{props.coherencyPolicy?.requiredNeighbors ?? '—'}</dd></div>
        <div><dt>Candidates tested</dt><dd>{result?.candidatesTested ?? '—'}</dd></div>
        <div><dt>Solver</dt><dd>{diagnostics ? formatSolverStage(diagnostics.solverStage) : '—'}</dd></div>
        <div><dt>Path movement</dt><dd>{diagnostics ? `${diagnostics.totalActualPathMovement.toFixed(2)}″` : '—'}</dd></div>
        <div><dt>Target progress</dt><dd>{diagnostics ? `${diagnostics.totalTargetProgress.toFixed(2)}″` : '—'}</dd></div>
        <div><dt>Average progress</dt><dd>{diagnostics ? `${diagnostics.averageUsefulProgressPercent.toFixed(0)}%` : '—'}</dd></div>
        <div><dt>Minimum progress</dt><dd>{diagnostics ? `${diagnostics.minimumUsefulProgressPercent.toFixed(0)}%` : '—'}</dd></div>
      </dl>
      {props.thinkingVisible && props.asyncStatus === 'calculating' && (
        <p className="smart-calculating" role="status" aria-live="polite">
          <span className="smart-spinner" aria-hidden="true" /> Calculating...
        </p>
      )}
      {props.targetMode === 'locked' && props.asyncStatus === 'calculating' && !props.thinkingVisible && (
        <p className="smart-calculating-text" role="status" aria-live="polite">Calculating exact target...</p>
      )}
      {props.errorMessage ? <p className={props.asyncStatus === 'search-limit' ? 'smart-warning' : 'smart-failure'} role="alert">{props.errorMessage}</p> : props.message ? <p className="smart-message">{props.message}</p> : (
        <div className="smart-validation">
          <Status label="Movement" value={result?.validation.movement} />
          <Status label="Collision" value={result?.validation.collision} />
          <Status label="Battlefield" value={result?.validation.battlefield} />
          <Status label="Coherency" value={result?.validation.coherency} />
        </div>
      )}
      {result && !result.valid && result.failureReasons.length > 0 && (
        <p className="smart-failure">
          {result.failureReasons.join(' · ').replaceAll('_', ' ')}
          {result.failureReasons.includes('COHERENCY') && result.coherency
            ? ` · ${result.coherency.models.filter((model) => !model.valid).length} models failing`
            : ''}
        </p>
      )}
      <div className="smart-move-actions">
        <button className="cancel-move" onClick={props.onCancel}>Cancel</button>
        <button className="apply-smart-move" disabled={!props.canApply} onClick={props.onApply}>Apply Move</button>
      </div>
    </aside>
  )
}

function formatSolverStage(stage: NonNullable<SmartMoveResult['diagnostics']>['solverStage']) {
  if (stage === 'COMMON_TRANSLATION') return 'Common Translation'
  if (stage === 'DIRECT_MAXIMUM') return 'Direct Maximum'
  if (stage === 'ROTATION_FALLBACK') return 'Rotation Fallback'
  return 'Fallback'
}

function Status({ label, value }: { label: string; value?: boolean }) {
  return <div><span>{label}</span><strong>{value === undefined ? '—' : value ? '✓' : '✕'}</strong></div>
}
