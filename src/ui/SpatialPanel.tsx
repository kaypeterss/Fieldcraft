import { useCallback, useState } from 'react'
import type { CoherencyPolicy, CoherencyResult } from '../engine/coherency'
import type { CoherencyAnalysisMode, SpatialMode } from '../tools/spatialOverlay'
import {
  visibilityModeLabel,
  visibilityPolicyLabel,
  type VisibilityAnalysis,
  type VisibilityMode,
  type VisibilityPolicy,
} from '../engine/visibility'
import { formatNumericValue, normalizeNumericDraft } from './numberInput'
import { AreaSummary, type ObjectiveDisplayAnalysis } from './DebugPanel'
import type { ModelPickerTarget } from '../tools/modelPicker'

const RANGE_PRESETS = [3, 6, 9, 12, 18]

interface SpatialPanelProps {
  mode: SpatialMode
  range: number
  requiredSeparation: number
  sourceGeometryLabel: string
  coherencyAnalysisMode: CoherencyAnalysisMode
  coherencyPolicy: CoherencyPolicy
  customCoherencyPolicy: CoherencyPolicy
  coherency: CoherencyResult | null
  sourceCount: number
  coherencyUnitAvailable: boolean
  unitPolicyAvailable: boolean
  objectiveOptions?: Array<{ id: string; name: string }>
  selectedObjectiveId?: string | null
  objectiveAnalysis?: ObjectiveDisplayAnalysis | null
  modelOptions?: Array<{ id: string; label: string }>
  visibilityViewerId?: string | null
  visibilityTargetId?: string | null
  visibilityPickTarget?: ModelPickerTarget | null
  visibilityMode?: VisibilityMode
  visibilityPolicy?: VisibilityPolicy
  visibilityAnalysis?: VisibilityAnalysis | null
  previewActive?: boolean
  onObjectiveChange?: (id: string | null) => void
  onVisibilityViewerChange?: (id: string | null) => void
  onVisibilityTargetChange?: (id: string | null) => void
  onVisibilityPick?: (target: ModelPickerTarget) => void
  onVisibilityModeChange?: (mode: VisibilityMode) => void
  onVisibilityPolicyChange?: (policy: VisibilityPolicy) => void
  onModeChange: (mode: SpatialMode) => void
  onRangeChange: (range: number) => void
  onRequiredSeparationChange: (distance: number) => void
  onCoherencyAnalysisModeChange: (mode: CoherencyAnalysisMode) => void
  onCoherencyPolicyChange: (policy: CoherencyPolicy) => void
}

export function SpatialPanel(props: SpatialPanelProps) {
  return (
    <aside className="spatial-panel" aria-label="Spatial analysis tools">
      <div className="spatial-panel-heading">
        <div><span className="eyebrow">ANALYSIS OVERLAY</span><h2>Spatial Tools</h2></div>
        <div className="spatial-heading-status">
          {props.previewActive && <span className="spatial-preview-badge">SMART MOVE PREVIEW</span>}
          <span className="spatial-source-count">{props.sourceCount}</span>
        </div>
      </div>

      <div className="segmented-control" aria-label="Spatial visualization mode">
        {(['range', 'exclusion', 'coherency', 'objectives', 'visibility'] as const).map((mode) => (
          <button
            key={mode}
            className={props.mode === mode ? 'active' : ''}
            onClick={() => props.onModeChange(mode)}
          >
            {mode}
          </button>
        ))}
      </div>

      {props.mode === 'range' && (
        <>
          <div className="panel-section-label">BASE-EDGE RANGE</div>
          <GeometrySummary source={props.sourceGeometryLabel} />
          <PresetButtons values={RANGE_PRESETS} value={props.range} suffix="″" onChange={props.onRangeChange} />
          <NumberField key={`range-${props.range}`} label="Custom range" value={props.range} min={0.01} step="any" suffix="in" onChange={props.onRangeChange} />
        </>
      )}

      {props.mode === 'exclusion' && (
        <>
          <div className="panel-section-label">MODEL-FOOTPRINT EXCLUSION</div>
          <GeometrySummary source={props.sourceGeometryLabel} />
          <p className="spatial-help">Each selected model uses its actual footprint and current orientation.</p>
          <NumberField key={`separation-${props.requiredSeparation}`} label="Required separation" value={props.requiredSeparation} min={0} step="any" suffix="in" onChange={props.onRequiredSeparationChange} />
        </>
      )}

      {props.mode === 'coherency' && (
        <>
          <div className="panel-section-label">COHERENCY POLICY</div>
          <GeometrySummary source={props.sourceGeometryLabel} />
          <div className="segmented-control" aria-label="Coherency policy source">
            <button
              className={props.coherencyAnalysisMode === 'unit-policy' ? 'active' : ''}
              disabled={!props.unitPolicyAvailable}
              onClick={() => props.onCoherencyAnalysisModeChange('unit-policy')}
            >Unit Policy</button>
            <button
              className={props.coherencyAnalysisMode === 'custom' ? 'active' : ''}
              onClick={() => props.onCoherencyAnalysisModeChange('custom')}
            >Custom Analysis</button>
          </div>
          {props.coherencyAnalysisMode === 'unit-policy' ? (
            <dl className="spatial-policy-summary">
              <div><dt>Neighbor distance</dt><dd>{props.coherencyPolicy.distance}″</dd></div>
              <div><dt>Required neighbors</dt><dd>{props.coherencyPolicy.requiredNeighbors}</dd></div>
              <div><dt>Connected required</dt><dd>{props.coherencyPolicy.requireConnected ? 'Yes' : 'No'}</dd></div>
            </dl>
          ) : (
            <>
              <NumberField key={`coherency-distance-${props.customCoherencyPolicy.distance}`} label="Neighbor distance" value={props.customCoherencyPolicy.distance} min={0} step="any" suffix="in" onChange={(distance) => props.onCoherencyPolicyChange({ ...props.customCoherencyPolicy, distance })} />
              <NumberField key={`coherency-neighbors-${props.customCoherencyPolicy.requiredNeighbors}`} label="Required neighbors" value={props.customCoherencyPolicy.requiredNeighbors} min={0} step={1} integer suffix="" onChange={(requiredNeighbors) => props.onCoherencyPolicyChange({ ...props.customCoherencyPolicy, requiredNeighbors })} />
              <label className="spatial-checkbox-field">
                <input
                  type="checkbox"
                  checked={Boolean(props.customCoherencyPolicy.requireConnected)}
                  onChange={(event) => props.onCoherencyPolicyChange({ ...props.customCoherencyPolicy, requireConnected: event.target.checked })}
                />
                Require connected unit
              </label>
            </>
          )}
          {props.coherency && props.coherencyUnitAvailable ? (
            <div className={props.coherency.coherent ? 'coherency-summary valid' : 'coherency-summary invalid'}>
              <strong>{props.coherency.coherent ? 'COHERENT' : 'COHERENCY WARNING'}</strong>
              <span>Overall: {props.coherency.coherent ? 'Valid' : 'Invalid'}</span>
              <span>Neighbor Requirements: {props.coherency.neighborRequirementsSatisfied ? 'Valid' : 'Invalid'}</span>
              <span>Connected: {props.coherency.connected ? 'Yes' : 'No'}</span>
              <span>Components: {props.coherency.componentCount}</span>
            </div>
          ) : (
            <p className="spatial-empty">Select one model or a complete unit to evaluate its unit coherency.</p>
          )}
        </>
      )}

      {props.mode === 'visibility' && (
        <section className="spatial-visibility-section" aria-label="Visibility analysis">
          <div className="panel-section-label">GEOMETRIC LINE OF SIGHT</div>
          <ModelSelect label="Viewer" value={props.visibilityViewerId ?? ''}
            options={props.modelOptions ?? []} excludeId={props.visibilityTargetId}
            pickTarget="viewer" activePickTarget={props.visibilityPickTarget}
            onPick={props.onVisibilityPick} onChange={(id) => props.onVisibilityViewerChange?.(id)} />
          <ModelSelect label="Target" value={props.visibilityTargetId ?? ''}
            options={props.modelOptions ?? []} excludeId={props.visibilityViewerId}
            pickTarget="target" activePickTarget={props.visibilityPickTarget}
            onPick={props.onVisibilityPick} onChange={(id) => props.onVisibilityTargetChange?.(id)} />
          {props.visibilityPickTarget && (
            <p className="spatial-help visibility-pick-help">
              Pick {props.visibilityPickTarget} on the battlefield. Press Escape to cancel.
            </p>
          )}
          <div className="segmented-control visibility-mode" aria-label="Visibility mode">
            {(['any-to-any', 'any-to-all'] as const).map((mode) => (
              <button key={mode} className={props.visibilityMode === mode ? 'active' : ''}
                onClick={() => props.onVisibilityModeChange?.(mode)}>
                {visibilityModeLabel(mode)}
              </button>
            ))}
          </div>
          <div className="segmented-control visibility-policy" aria-label="Visibility policy">
            {(['base-blocks', 'objects-block', 'nothing-blocks'] as const).map((policy) => (
              <button key={policy} className={props.visibilityPolicy === policy ? 'active' : ''}
                onClick={() => props.onVisibilityPolicyChange?.(policy)}>
                {visibilityPolicyLabel(policy)}
              </button>
            ))}
          </div>
          {props.visibilityAnalysis ? <VisibilitySummary analysis={props.visibilityAnalysis} />
            : <p className="spatial-empty">Choose a viewer and target model to analyze visibility.</p>}
        </section>
      )}

      {props.sourceCount === 0 && !['coherency', 'objectives', 'visibility'].includes(props.mode) && (
        <p className="spatial-empty">Select one model or a complete unit to visualize this overlay.</p>
      )}
      {props.mode === 'objectives' && (props.objectiveOptions?.length ?? 0) > 0 && <section className="spatial-objective-section" aria-label="Objective area analysis">
        <div className="panel-section-label">OBJECTIVE AREAS · GEOMETRY ONLY</div>
        <label className="spatial-select-field">
          <span>Analyze objective</span>
          <select aria-label="Analyze objective" value={props.selectedObjectiveId ?? ''}
            onChange={(event) => props.onObjectiveChange?.(event.target.value || null)}>
            <option value="">Choose an objective</option>
            {props.objectiveOptions?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        {props.objectiveAnalysis && (props.objectiveAnalysis.modelRelationship || props.objectiveAnalysis.unitSummary || (props.objectiveAnalysis.playerSummaries?.length ?? 0) > 0)
          ? <AreaSummary name={props.objectiveAnalysis.featureName}
              model={props.objectiveAnalysis.modelRelationship}
              unit={props.objectiveAnalysis.unitSummary}
              unitName={props.objectiveAnalysis.unitName}
              players={props.objectiveAnalysis.playerSummaries} />
          : <p className="spatial-empty">Select a model or unit to see live objective relationships.</p>}
      </section>}
      <p className="spatial-note">Overlay only · movement remains permissive</p>
    </aside>
  )
}

function ModelSelect(props: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  excludeId?: string | null
  pickTarget: ModelPickerTarget
  activePickTarget?: ModelPickerTarget | null
  onPick?: (target: ModelPickerTarget) => void
  onChange: (id: string | null) => void
}) {
  return (
    <label className="spatial-select-field">
      <span className="visibility-select-label">
        {props.label}
        <button type="button" className={props.activePickTarget === props.pickTarget ? 'active' : ''}
          aria-label={`Pick ${props.label}`} onClick={() => props.onPick?.(props.pickTarget)}>
          {props.activePickTarget === props.pickTarget ? 'Picking…' : 'Pick'}
        </button>
      </span>
      <select aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value || null)}>
        <option value="">Choose model</option>
        {props.options.filter((option) => option.id !== props.excludeId || option.id === props.value)
          .map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  )
}

function VisibilitySummary({ analysis }: { analysis: VisibilityAnalysis }) {
  const bases = analysis.basesCrossed.map((entry) => entry.featureName).join(', ') || 'None'
  const objects = analysis.objectsCrossed.map((entry) => `${entry.featureName} · ${entry.objectName}`).join(', ') || 'None'
  return (
    <div className={analysis.visible ? 'visibility-summary visible' : 'visibility-summary blocked'}>
      <strong>{analysis.visible ? 'VISIBLE' : 'BLOCKED'}</strong>
      <p className="spatial-help">{analysis.mode === 'any-to-any'
        ? 'At least one footprint-to-footprint sightline must be clear.'
        : 'One point of the viewer must see the complete target footprint.'}</p>
      <dl className="spatial-policy-summary">
        <div><dt>Distance</dt><dd>{analysis.distance.toFixed(2)}″</dd></div>
        <div><dt>Mode</dt><dd>{visibilityModeLabel(analysis.mode)}</dd></div>
        <div><dt>Bases crossed</dt><dd>{bases}</dd></div>
        <div><dt>Objects crossed</dt><dd>{objects}</dd></div>
        <div><dt>Policy</dt><dd>{visibilityPolicyLabel(analysis.policy)}</dd></div>
      </dl>
    </div>
  )
}

function GeometrySummary({ source, target }: { source: string; target?: string }) {
  return (
    <dl className="spatial-policy-summary spatial-geometry-summary">
      <div><dt>Source</dt><dd>{source}</dd></div>
      {target && <div><dt>Target</dt><dd>{target}</dd></div>}
    </dl>
  )
}

function PresetButtons({ values, value, suffix, onChange }: { values: number[]; value: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <div className="preset-grid">
      {values.map((preset) => (
        <button key={preset} className={value === preset ? 'active' : ''} onClick={() => onChange(preset)}>
          {preset}{suffix}
        </button>
      ))}
    </div>
  )
}

function NumberField({ label, value, min, step, integer = false, suffix, onChange }: { label: string; value: number; min: number; step: number | 'any'; integer?: boolean; suffix: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(() => formatNumericValue(value, integer))

  const commit = useCallback(() => {
    const next = normalizeNumericDraft(draft, { min, integer, fallback: value })
    setDraft(formatNumericValue(next, integer))
    if (next !== value) onChange(next)
  }, [draft, integer, min, onChange, value])

  return (
    <label className="spatial-number-field">
      <span>{label}</span>
      <span className="number-input-wrap">
        <input
          aria-label={label}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          min={min}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              commit()
            }
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  )
}
