import type { SmartMoveResult } from '../engine/smartMove'
import type { CoherencyPolicy } from '../domain/types'
import type { SmartMoveAsyncStatus } from '../tools/smartMoveWorkerController'

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
  const result = props.result
  const diagnostics = result?.diagnostics
  const candidateLabel = props.asyncStatus === 'error'
    ? 'ERROR'
    : props.asyncStatus === 'calculating' && (props.targetMode === 'locked' || props.thinkingVisible)
      ? 'CALCULATING'
      : result
        ? (result.valid ? 'VALID' : 'INVALID')
        : 'AWAITING TARGET'
  return (
    <aside className="smart-move-panel" aria-label="Smart Move preview">
      <div className="smart-move-panel-heading">
        <div><span className="eyebrow">FORMATION PREVIEW</span><h2>Smart Move</h2></div>
        <span className={result?.valid ? 'smart-candidate valid' : 'smart-candidate invalid'}>{candidateLabel}</span>
      </div>
      <dl>
        <div><dt>Selected</dt><dd>{props.selectedCount} / {props.unitSize} models</dd></div>
        <div><dt>Unit</dt><dd>{props.unitName ?? '—'}</dd></div>
        <div><dt>Target</dt><dd>{props.targetMode === 'locked' ? 'Locked' : 'Live'}</dd></div>
        {props.coherencyPolicy && <>
          <div><dt>Coherency</dt><dd>{props.coherencyPolicy.distance}″</dd></div>
          <div><dt>Required neighbors</dt><dd>{props.coherencyPolicy.requiredNeighbors}</dd></div>
        </>}
        {result && <div><dt>Candidates tested</dt><dd>{result.candidatesTested}</dd></div>}
        {diagnostics && <>
          <div><dt>Solver</dt><dd>{formatSolverStage(diagnostics.solverStage)}</dd></div>
          <div><dt>Path movement</dt><dd>{diagnostics.totalActualPathMovement.toFixed(2)}″</dd></div>
          <div><dt>Target progress</dt><dd>{diagnostics.totalTargetProgress.toFixed(2)}″</dd></div>
          <div><dt>Average progress</dt><dd>{diagnostics.averageUsefulProgressPercent.toFixed(0)}%</dd></div>
          <div><dt>Minimum progress</dt><dd>{diagnostics.minimumUsefulProgressPercent.toFixed(0)}%</dd></div>
        </>}
      </dl>
      {props.thinkingVisible && props.asyncStatus === 'calculating' && (
        <p className="smart-calculating" role="status" aria-live="polite">
          <span className="smart-spinner" aria-hidden="true" /> Calculating...
        </p>
      )}
      {props.targetMode === 'locked' && props.asyncStatus === 'calculating' && !props.thinkingVisible && (
        <p className="smart-calculating-text" role="status" aria-live="polite">Calculating exact target...</p>
      )}
      {props.errorMessage ? <p className="smart-failure" role="alert">{props.errorMessage}</p> : props.message ? <p className="smart-message">{props.message}</p> : (
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
  return 'Fallback'
}

function Status({ label, value }: { label: string; value?: boolean }) {
  return <div><span>{label}</span><strong>{value === undefined ? '—' : value ? '✓' : '✕'}</strong></div>
}
