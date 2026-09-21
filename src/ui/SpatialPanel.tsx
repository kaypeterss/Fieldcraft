import { useCallback, useState } from 'react'
import type { CoherencyPolicy, CoherencyResult } from '../engine/coherency'
import type { SpatialMode } from '../tools/spatialOverlay'
import { formatNumericValue, normalizeNumericDraft } from './numberInput'

const RANGE_PRESETS = [3, 6, 9, 12, 18]
const TARGET_BASE_PRESETS = [25, 32, 40, 50]

interface SpatialPanelProps {
  mode: SpatialMode
  range: number
  requiredSeparation: number
  targetBaseDiameterMm: number
  coherencyPolicy: CoherencyPolicy
  coherency: CoherencyResult | null
  sourceCount: number
  coherencyUnitAvailable: boolean
  onModeChange: (mode: SpatialMode) => void
  onRangeChange: (range: number) => void
  onRequiredSeparationChange: (distance: number) => void
  onTargetBaseDiameterChange: (diameterMm: number) => void
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
          <PresetButtons values={RANGE_PRESETS} value={props.range} suffix="″" onChange={props.onRangeChange} />
          <NumberField key={`range-${props.range}`} label="Custom range" value={props.range} min={0.01} step="any" suffix="in" onChange={props.onRangeChange} />
        </>
      )}

      {props.mode === 'exclusion' && (
        <>
          <div className="panel-section-label">TARGET-CENTER EXCLUSION</div>
          <NumberField key={`separation-${props.requiredSeparation}`} label="Required separation" value={props.requiredSeparation} min={0} step="any" suffix="in" onChange={props.onRequiredSeparationChange} />
          <div className="spatial-field-label">Target base</div>
          <PresetButtons values={TARGET_BASE_PRESETS} value={props.targetBaseDiameterMm} suffix="mm" onChange={props.onTargetBaseDiameterChange} />
        </>
      )}

      {props.mode === 'coherency' && (
        <>
          <div className="panel-section-label">SAMPLE POLICY</div>
          <NumberField key={`coherency-distance-${props.coherencyPolicy.distance}`} label="Neighbor distance" value={props.coherencyPolicy.distance} min={0} step="any" suffix="in" onChange={(distance) => props.onCoherencyPolicyChange({ ...props.coherencyPolicy, distance })} />
          <NumberField key={`coherency-neighbors-${props.coherencyPolicy.requiredNeighbors}`} label="Required neighbors" value={props.coherencyPolicy.requiredNeighbors} min={0} step={1} integer suffix="" onChange={(requiredNeighbors) => props.onCoherencyPolicyChange({ ...props.coherencyPolicy, requiredNeighbors })} />
          {props.coherency && props.coherencyUnitAvailable ? (
            <div className={props.coherency.coherent ? 'coherency-summary valid' : 'coherency-summary invalid'}>
              <strong>{props.coherency.coherent ? 'COHERENT' : 'COHERENCY WARNING'}</strong>
              <span>{props.coherency.models.filter((model) => !model.valid).length} violating · {props.coherency.connected ? 'connected' : 'disconnected'}</span>
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
