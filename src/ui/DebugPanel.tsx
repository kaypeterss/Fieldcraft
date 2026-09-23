import type { BattlefieldFeature, CoherencyPolicy, TabletopModel, TerrainPermissions } from '../domain/types'
import type { EffectiveTerrainFeaturePermissions, TerrainMovementInteraction } from '../engine/terrainPolicy'
import type { CoherencyResult } from '../engine/coherency'
import { formatInches, millimetersToInches } from '../engine/units'
import { describeFootprint } from '../tools/spatialOverlay'
import type { ModelAreaRelationship, PlayerAreaSummary, UnitAreaSummary } from '../engine/areaRelationships'
import type { ObjectiveControlResult } from '../engine/objectiveControl'

export interface ObjectiveDisplayAnalysis {
  featureName: string
  areaType: 'feature-base' | 'local-footprint' | 'point-range'
  unitName?: string
  modelRelationship: ModelAreaRelationship | null
  unitSummary: UnitAreaSummary | null
  playerSummaries?: PlayerAreaSummary[]
  control?: ObjectiveControlResult | null
  controlPreview?: boolean
}

interface DebugPanelProps {
  model?: TabletopModel
  feature?: BattlefieldFeature
  terrainRelationships?: Array<{ featureId: string; objectId?: string; name: string; permissions: TerrainPermissions }>
  terrainMovement?: TerrainMovementInteraction[]
  effectiveTerrainPermissions?: EffectiveTerrainFeaturePermissions[]
  terrainAreaAnalysis?: Array<{ featureId: string; featureName: string; modelRelationship: ModelAreaRelationship; unitSummary: UnitAreaSummary | null }>
  objectiveAnalysis?: ObjectiveDisplayAnalysis | null
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
  const { model, feature, selectedCount, wholeUnitName, ownerDisplayName } = props
  const modelCoherency = props.coherency?.models.find((entry) => entry.modelId === model?.id)
  return (
    <aside className={model || feature ? 'debug-panel visible' : 'debug-panel'} aria-live="polite">
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
          {props.terrainRelationships && <>
            <div className="panel-section-label">CURRENT TERRAIN RELATION</div>
            <dl>
              {props.terrainRelationships.length === 0
                ? <div><dt>Currently intersects</dt><dd>None</dd></div>
                : props.terrainRelationships.map((relation) => <div key={`${relation.featureId}:${relation.objectId ?? 'base'}`}>
                    <dt>Currently intersects</dt>
                    <dd>{relation.name}{relation.objectId ? ' · Object' : ' · Base'}</dd>
                  </div>)}
            </dl>
          </>}
          {props.terrainAreaAnalysis && props.terrainAreaAnalysis.length > 0 && <details className="debug-collapsible" open>
            <summary>TERRAIN BASE GEOMETRY</summary>
            {props.terrainAreaAnalysis.map((entry) => <AreaSummary key={entry.featureId}
              name={entry.featureName} model={entry.modelRelationship} unit={entry.unitSummary} unitName={props.unitName} />)}
          </details>}
          {props.objectiveAnalysis && <details className="debug-collapsible" open>
            <summary>OBJECTIVE AREA · GEOMETRY ONLY</summary>
            <AreaSummary name={props.objectiveAnalysis.featureName}
              model={props.objectiveAnalysis.modelRelationship}
              unit={props.objectiveAnalysis.unitSummary}
              unitName={props.objectiveAnalysis.unitName}
              players={props.objectiveAnalysis.playerSummaries}
              control={props.objectiveAnalysis.control}
              controlPreview={props.objectiveAnalysis.controlPreview} />
          </details>}
          {props.terrainMovement && <>
            <div className="panel-section-label">CURRENT MOVEMENT TERRAIN INTERACTION</div>
            <dl>
              {props.terrainMovement.length === 0
                ? <div><dt>Encountered this move</dt><dd>None yet</dd></div>
                : props.terrainMovement.map((interaction) => <div key={`${interaction.featureId}:${interaction.objectId ?? 'base'}`}>
                    <dt>{interaction.name}{interaction.objectId ? ' · Object' : ' · Base'}</dt>
                    <dd>{[
                      interaction.startedInside && 'Started inside',
                      interaction.entered && 'Entered',
                      interaction.crossed && 'Crossed',
                      interaction.contacted && 'Contacted',
                    ].filter(Boolean).join(' · ')}</dd>
                  </div>)}
            </dl>
          </>}
          {props.effectiveTerrainPermissions && props.effectiveTerrainPermissions.length > 0 && <>
            <div className="panel-section-label">EFFECTIVE TERRAIN PERMISSIONS</div>
            <p className="terrain-permission-context">For this selected model only</p>
            {props.effectiveTerrainPermissions.map((featurePermission) => <div key={featurePermission.featureId}>
              <div className="terrain-permission-feature">{featurePermission.featureName}</div>
              <dl>{featurePermission.surfaces.map((surface) => <div key={surface.objectId ?? 'base'}>
                <dt>{surface.name}{surface.objectId ? ' · Object' : ''}</dt>
                <dd className="terrain-permission-values">
                  <span>Enter: {permissionLabel(surface.permissions.canEnter)}</span>
                  <span>Cross: {permissionLabel(surface.permissions.canCross)}</span>
                  <span>Finish: {permissionLabel(surface.permissions.canFinish)}</span>
                </dd>
              </div>)}</dl>
            </div>)}
          </>}
          <details className="debug-collapsible" open>
          <summary>POSITION / MOVEMENT</summary>
          <div className="coordinate-grid">
            <div><span>X</span><strong>{model.position.x.toFixed(4)}</strong><small>in</small></div>
            <div><span>Y</span><strong>{model.position.y.toFixed(4)}</strong><small>in</small></div>
          </div>
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
          </details>
        </>
      ) : feature ? (
        <>
          <div className="panel-heading"><div><span className="eyebrow">BATTLEFIELD FEATURE</span><h2>{feature.name}</h2></div></div>
          <dl>
            <div><dt>Feature ID</dt><dd>{feature.id}</dd></div>
            <div><dt>Base Area</dt><dd>{describeFootprint(feature.baseArea, feature.pose.rotation)}</dd></div>
            <div><dt>Position</dt><dd>{feature.pose.position.x.toFixed(2)}, {feature.pose.position.y.toFixed(2)} in</dd></div>
            <div><dt>Rotation</dt><dd>{(feature.pose.rotation * 180 / Math.PI).toFixed(1)}°</dd></div>
            <div><dt>Capabilities</dt><dd>{[
              feature.capabilities.terrain && 'Terrain',
              feature.capabilities.objective && 'Objective',
              feature.capabilities.movable && 'Movable',
            ].filter(Boolean).join(' + ') || 'None'}</dd></div>
            <div><dt>Child Objects</dt><dd>{feature.objects.length}</dd></div>
            {feature.capabilities.objective && <div><dt>Objective Area</dt><dd>{feature.capabilities.objective.area.type === 'feature-base'
              ? 'Same as feature base' : feature.capabilities.objective.area.type === 'point-range'
                ? `Point + ${formatInches(feature.capabilities.objective.area.rangeInches)} range`
                : 'Custom local footprint'}</dd></div>}
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

export function AreaSummary({ name, model, unit, unitName, players, control, controlPreview }: {
  name: string
  model: ModelAreaRelationship | null
  unit: UnitAreaSummary | null
  unitName?: string
  players?: PlayerAreaSummary[]
  control?: ObjectiveControlResult | null
  controlPreview?: boolean
}) {
  return <div className="area-summary">
    <strong>{name}</strong>
    {control && <div className="objective-control-summary">
      <div className="objective-control-heading">
        <span>{controlPreview ? 'PROJECTED CONTROL' : 'OBJECTIVE CONTROL'}</span>
        <strong>{control.state === 'controlled'
          ? `Controlled by ${control.players.find((player) => player.playerId === control.controllingPlayerId)?.playerName ?? control.controllingPlayerId}`
          : control.state === 'contested' ? 'Tied / contested' : 'Nobody controls'}</strong>
      </div>
      {control.players.map((player) => <div className="objective-control-player" key={player.playerId}>
        <span>{player.playerName}</span>
        <small>{player.qualifyingModelCount} models</small>
        <strong>{player.totalControl} Control</strong>
      </div>)}
    </div>}
    {model && <dl>
      <div><dt>Selected model</dt><dd>{model.placement === 'wholly-within' ? 'Wholly within'
        : model.intersects ? 'Touching / intersecting' : 'Outside'}</dd></div>
      <div><dt>Center within</dt><dd>{model.centerWithin ? 'Yes' : 'No'}</dd></div>
      <div><dt>Model ↔ area</dt><dd>{formatInches(model.distanceInches)}</dd></div>
    </dl>}
    {unit && <dl>
      <div><dt>Unit</dt><dd>{unitName ?? 'Selected unit'}</dd></div>
      <div><dt>Intersecting</dt><dd>{unit.intersectingCount} / {unit.modelCount}</dd></div>
      <div><dt>Wholly within</dt><dd>{unit.whollyWithinCount} / {unit.modelCount}</dd></div>
      <div><dt>Centers within</dt><dd>{unit.centerWithinCount} / {unit.modelCount}</dd></div>
      <div><dt>Unit ↔ area</dt><dd>{unit.distanceInches === null ? '—' : formatInches(unit.distanceInches)}</dd></div>
    </dl>}
    {players && players.length > 0 && <details className="objective-geometry-details">
      <summary>GEOMETRIC RELATIONSHIPS</summary>
      <div className="area-player-summaries">
      {players.map((player) => <details key={player.playerId} open>
        <summary>{player.playerName} · {player.modelCount} models</summary>
        <dl>
          <div><dt>Intersecting</dt><dd>{player.intersectingCount}</dd></div>
          <div><dt>Wholly within</dt><dd>{player.whollyWithinCount}</dd></div>
          <div><dt>Centers within</dt><dd>{player.centerWithinCount}</dd></div>
        </dl>
        {player.units.map((entry) => <div className="area-unit-summary" key={entry.unitId}>
          <span>{entry.unitName}</span><small>{entry.intersectingCount} / {entry.whollyWithinCount} / {entry.centerWithinCount}</small>
        </div>)}
      </details>)}
      </div>
    </details>}
  </div>
}

function permissionLabel(allowed: boolean): string {
  return allowed ? 'Yes' : 'No'
}
