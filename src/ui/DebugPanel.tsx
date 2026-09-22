import type { CoherencyPolicy, TabletopModel } from '../domain/types'
import type { CoherencyResult } from '../engine/coherency'
import { formatInches, millimetersToInches } from '../engine/units'
import { describeFootprint } from '../tools/spatialOverlay'

interface DebugPanelProps {
  model?: TabletopModel
  selectedCount: number
  wholeUnitName?: string
  ownerDisplayName?: string
  unitName?: string
  unitModelCount?: number
  unitBaseLabel?: string
  movementAllowance?: number
  movementUsed?: number
  movementRemaining?: number
  coherencyPolicy?: CoherencyPolicy
  coherency?: CoherencyResult | null
  coherencyValid?: boolean
}

export function DebugPanel(props: DebugPanelProps) {
  const { model, selectedCount, wholeUnitName, ownerDisplayName } = props
  const modelCoherency = props.coherency?.models.find((entry) => entry.modelId === model?.id)
  return (
    <aside className={model ? 'debug-panel visible' : 'debug-panel'} aria-live="polite">
      {model ? (
        <>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">INSPECTOR</span>
              <h2>{model.label ?? model.id}</h2>
            </div>
            {selectedCount > 1 && <span className="selection-count">+{selectedCount - 1}</span>}
          </div>
          {wholeUnitName && <div className="whole-unit-badge">FULL UNIT · {wholeUnitName}</div>}
          <dl>
            <div><dt>Model ID</dt><dd>{model.id}</dd></div>
            <div><dt>Unit</dt><dd>{props.unitName ?? model.unitId}</dd></div>
            <div><dt>Owner</dt><dd>{ownerDisplayName ?? model.ownerId}</dd></div>
            {props.unitModelCount !== undefined && <div><dt>Models</dt><dd>{props.unitModelCount}</dd></div>}
            {props.unitBaseLabel && <div><dt>Unit Bases</dt><dd>{props.unitBaseLabel}</dd></div>}
          </dl>
          <div className="panel-section-label">POSITION</div>
          <div className="coordinate-grid">
            <div><span>X</span><strong>{model.position.x.toFixed(4)}</strong><small>in</small></div>
            <div><span>Y</span><strong>{model.position.y.toFixed(4)}</strong><small>in</small></div>
          </div>
          <div className="panel-section-label">BASE GEOMETRY</div>
          <dl>
            <div><dt>Footprint</dt><dd>{describeFootprint(model.base, model.rotation)}</dd></div>
            {model.base.shape === 'circle' && <>
              <div><dt>Converted</dt><dd>{formatInches(millimetersToInches(model.base.diameterMm))}</dd></div>
            </>}
            <div><dt>Rotation</dt><dd>{(model.rotation * 180 / Math.PI).toFixed(1)}°</dd></div>
            {props.movementAllowance !== undefined
              && <div><dt>Move</dt><dd>{formatInches(props.movementAllowance)}</dd></div>}
            {props.movementUsed !== undefined
              && <div><dt>Movement Used</dt><dd>{formatInches(props.movementUsed)}</dd></div>}
            {props.movementRemaining !== undefined
              && <div><dt>Movement Remaining</dt><dd>{formatInches(props.movementRemaining)}</dd></div>}
            {props.coherencyPolicy && <>
              <div><dt>Coherency Distance</dt><dd>{formatInches(props.coherencyPolicy.distance)}</dd></div>
              <div><dt>Required Neighbors</dt><dd>{props.coherencyPolicy.requiredNeighbors}</dd></div>
              <div><dt>Current Coherency</dt><dd>{props.coherencyValid ? 'Valid' : 'Invalid'}</dd></div>
              {props.coherency && <>
                <div><dt>Neighbor Requirements</dt><dd>{props.coherency.neighborRequirementsSatisfied ? 'Valid' : 'Invalid'}</dd></div>
                <div><dt>Connected</dt><dd>{props.coherency.connected ? 'Yes' : 'No'}</dd></div>
                <div><dt>Components</dt><dd>{props.coherency.componentCount}</dd></div>
              </>}
            </>}
            {modelCoherency && <div>
              <dt>Model Neighbors</dt>
              <dd>{modelCoherency.neighborCount} / {props.coherencyPolicy?.requiredNeighbors ?? 0}</dd>
            </div>}
          </dl>
        </>
      ) : (
        <div className="empty-inspector">
          <span className="empty-ring" />
          <p>Select a model to inspect its tabletop data.</p>
        </div>
      )}
    </aside>
  )
}
