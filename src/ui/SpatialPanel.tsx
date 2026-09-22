import { useCallback, useState } from 'react'
import type { CoherencyPolicy, CoherencyResult } from '../engine/coherency'
import type { CoherencyAnalysisMode, SpatialMode } from '../tools/spatialOverlay'
import { formatNumericValue, normalizeNumericDraft } from './numberInput'

const RANGE_PRESETS = [3, 6, 9, 12, 18]
const TARGET_BASE_PRESETS = [25, 32, 40, 50]

interface SpatialPanelProps {
  mode: SpatialMode
  range: number
  requiredSeparation: number
  targetBaseDiameterMm: number
  targetModelId: string | null
  targetModelOptions: Array<{ id: string; label: string }>
  sourceGeometryLabel: string
  targetGeometryLabel: string
  coherencyAnalysisMode: CoherencyAnalysisMode
  coherencyPolicy: CoherencyPolicy
  customCoherencyPolicy: CoherencyPolicy
  coherency: CoherencyResult | null
  sourceCount: number
  coherencyUnitAvailable: boolean
  unitPolicyAvailable: boolean
  onModeChange: (mode: SpatialMode) => void
  onRangeChange: (range: number) => void
  onRequiredSeparationChange: (distance: number) => void
  onTargetBaseDiameterChange: (diameterMm: number) => void
  onTargetModelChange: (modelId: string | null) => void
  onCoherencyAnalysisModeChange: (mode: CoherencyAnalysisMode) => void
  onCoherencyPolicyChange: (policy: CoherencyPolicy) => void
}

export function SpatialPanel(props: SpatialPanelProps) {
  return (
    <aside className="spatial-panel" aria-label="Spatial analysis tools">
      <div className="spatial-panel-heading">
        <div><span className="eyebrow">ANALYSIS OVERLAY</span><h2>Spatial Tools</h2></div>
        <span className="spatial-source-count">{props.sourceCount}</span>
      </div>

      <div className="segmented-control" aria-label="Spatial visualization mode">
        {(['range', 'exclusion', 'coherency'] as const).map((mode) => (
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
          <div className="panel-section-label">TARGET-ORIGIN EXCLUSION</div>
          <GeometrySummary source={props.sourceGeometryLabel} target={props.targetGeometryLabel} />
          <NumberField key={`separation-${props.requiredSeparation}`} label="Required separation" value={props.requiredSeparation} min={0} step="any" suffix="in" onChange={props.onRequiredSeparationChange} />
          <label className="spatial-select-field">
            <span>Target footprint</span>
            <select
              aria-label="Target footprint"
              value={props.targetModelId ?? ''}
              onChange={(event) => props.onTargetModelChange(event.target.value || null)}
            >
              <option value="">Manual circle</option>
              {props.targetModelOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="spatial-field-label">Manual circle presets</div>
          <PresetButtons values={TARGET_BASE_PRESETS} value={props.targetModelId ? Number.NaN : props.targetBaseDiameterMm} suffix="mm" onChange={props.onTargetBaseDiameterChange} />
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

      {props.sourceCount === 0 && props.mode !== 'coherency' && (
        <p className="spatial-empty">Select one model or a complete unit to visualize this overlay.</p>
      )}
      <p className="spatial-note">Overlay only · movement remains permissive</p>
    </aside>
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
