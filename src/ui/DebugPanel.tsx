import type { TabletopModel } from '../domain/types'
import { formatInches, millimetersToInches } from '../engine/units'

interface DebugPanelProps {
  model?: TabletopModel
  selectedCount: number
  wholeUnitName?: string
}

export function DebugPanel({ model, selectedCount, wholeUnitName }: DebugPanelProps) {
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
            <div><dt>Unit ID</dt><dd>{model.unitId}</dd></div>
            <div><dt>Owner</dt><dd>{model.ownerId}</dd></div>
          </dl>
          <div className="panel-section-label">POSITION</div>
          <div className="coordinate-grid">
            <div><span>X</span><strong>{model.position.x.toFixed(4)}</strong><small>in</small></div>
            <div><span>Y</span><strong>{model.position.y.toFixed(4)}</strong><small>in</small></div>
          </div>
          <div className="panel-section-label">BASE GEOMETRY</div>
          <dl>
            <div><dt>Shape</dt><dd>{model.base.shape}</dd></div>
            <div><dt>Diameter</dt><dd>{model.base.diameterMm} mm</dd></div>
            <div><dt>Converted</dt><dd>{formatInches(millimetersToInches(model.base.diameterMm))}</dd></div>
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
