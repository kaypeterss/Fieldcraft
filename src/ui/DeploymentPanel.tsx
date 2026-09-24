import type { GameState, Pose } from '../domain/types'
import { modelPresence } from '../game/modelPresence'
import { getUnitDefinition } from '../game/selectors'
import type { AosDeploymentState } from '../gameSystem/ageOfSigmar/deployment'
import type { FormationPresetId } from '../tools/formationPresets'

export interface DeploymentPlacementView {
  unitId: string
  placements: Record<string, Pose>
  valid: boolean
  locked: boolean
  adjustingModelId: string | null
  reasons: string[]
  formationPreset: FormationPresetId | 'custom'
  formationRotation: number
  formationOptions: Array<{ id: FormationPresetId; label: string; available: boolean; reason?: string }>
  formationValid: boolean
  hoveredModelId: string | null
}

export function DeploymentPanel({ state, deployment, playerLabels, placement, onRollOff, onChooseAttacker,
  onChooseTerritory, onBeginUnit, onConfirmPlacement, onCancelPlacement, onAdjustModel,
  onHoverTerritory, onHoverModel, onSelectFormationPreset, onRotateFormation,
  onCycleFormation, onMoveFormation, onUndo }: {
  state: GameState
  deployment: AosDeploymentState
  playerLabels?: Record<string, string>
  placement: DeploymentPlacementView | null
  onRollOff: () => void
  onChooseAttacker: (playerId: string) => void
  onChooseTerritory: (zoneId: string) => void
  onHoverTerritory: (zoneId: string | null) => void
  onBeginUnit: (unitId: string) => void
  onConfirmPlacement: () => void
  onCancelPlacement: () => void
  onAdjustModel: (modelId: string) => void
  onHoverModel: (modelId: string | null) => void
  onSelectFormationPreset: (preset: FormationPresetId) => void
  onRotateFormation: (delta: number) => void
  onCycleFormation: (direction: -1 | 1) => void
  onMoveFormation: () => void
  onUndo?: () => void
}) {
  const winner = state.players.find((player) => player.id === deployment.rollWinnerPlayerId)
  const attacker = state.players.find((player) => player.id === deployment.attackerPlayerId)
  const defender = state.players.find((player) => player.id === deployment.defenderPlayerId)
  const current = state.players.find((player) => player.id === deployment.currentPlayerId)
  return <section className="deployment-panel" aria-label="Age of Sigmar deployment">
    <header className="context-panel-heading">
      <div><p className="eyebrow">AGE OF SIGMAR</p><h2>Deployment</h2></div>
      <span className={`deployment-phase ${deployment.phase === 'READY_FOR_BATTLE' ? 'ready' : ''}`}>
        {deployment.phase.replaceAll('_', ' ')}
      </span>
    </header>

    {deployment.phase === 'ROLL_OFF' && <div className="deployment-step">
      <h3>Determine roles</h3>
      <p>Roll off. The winner chooses attacker or defender.</p>
      <RollOffSummary state={state} deployment={deployment} />
      <button className="deployment-primary" type="button" onClick={onRollOff}>Roll D6 for both players</button>
    </div>}

    {deployment.phase === 'CHOOSE_ROLES' && winner && <div className="deployment-step">
      <h3>{winner.displayName} won the roll-off</h3>
      <RollOffSummary state={state} deployment={deployment} />
      <p>Choose which player is the attacker.</p>
      {state.players.map((player) => <button className="deployment-primary" type="button" key={player.id}
        onClick={() => onChooseAttacker(player.id)}>Make {player.displayName} attacker</button>)}
    </div>}

    {deployment.phase === 'CHOOSE_TERRITORY' && attacker && <div className="deployment-step">
      <h3>{attacker.displayName} chooses territory</h3>
      <p>The other territory is assigned to the defender.</p>
      {(state.resolvedMatchConfiguration?.deploymentZones ?? []).map((zone, index) => <button
        className="deployment-primary" type="button" key={zone.id}
        onPointerEnter={() => onHoverTerritory(zone.id)} onPointerLeave={() => onHoverTerritory(null)}
        onFocus={() => onHoverTerritory(zone.id)} onBlur={() => onHoverTerritory(null)}
        onClick={() => onChooseTerritory(zone.id)}>
        Choose Territory {String.fromCharCode(65 + index)}
      </button>)}
    </div>}

    {(deployment.phase === 'DEPLOYING' || deployment.phase === 'READY_FOR_BATTLE') && <>
      <dl className="deployment-roles">
        <div><dt>Attacker</dt><dd>{attacker?.displayName} · {labelFor(attacker?.id, playerLabels)}<small>{territoryLabel(state, deployment, attacker?.id)}</small></dd></div>
        <div><dt>Defender</dt><dd>{defender?.displayName} · {labelFor(defender?.id, playerLabels)}<small>{territoryLabel(state, deployment, defender?.id)}</small></dd></div>
      </dl>
      {deployment.rolls.length > 0 && <details className="deployment-roll-record">
        <summary>Roll-off record · {winner?.displayName} won</summary>
        <RollOffSummary state={state} deployment={deployment} />
      </details>}
      {deployment.phase === 'DEPLOYING' && current && <div className="deployment-current">
        <span>Currently deploying</span><strong>{current.displayName}</strong><small>{labelFor(current.id, playerLabels)}</small>
      </div>}
      {state.players.map((player) => {
        const units = state.units.filter((unit) => unit.ownerId === player.id)
        const deployed = units.filter((unit) => deployment.deployedUnitIds.includes(unit.id))
        const onBoard = state.models.filter((model) => model.ownerId === player.id && modelPresence(model) === 'ON_BATTLEFIELD').length
        const totalModels = state.models.filter((model) => model.ownerId === player.id).length
        return <details className="deployment-army" key={player.id} open={deployment.currentPlayerId === player.id}>
          <summary><span><strong>{labelFor(player.id, playerLabels)}</strong><small>{player.displayName}</small></span>
            <span>{deployed.length} / {units.length} units<br />{onBoard} / {totalModels} models</span></summary>
          <div className="deployment-unit-list">
            {units.map((unit) => {
              const definition = getUnitDefinition(state, unit)
              const isDeployed = deployment.deployedUnitIds.includes(unit.id)
              const isActive = placement?.unitId === unit.id
              const canDeploy = deployment.phase === 'DEPLOYING'
                && deployment.currentPlayerId === player.id && !isDeployed && !placement
              return <div className={`deployment-unit-row${isActive ? ' active' : ''}`} key={unit.id}>
                <div><strong>{definition?.name ?? unit.id}</strong><small>{unit.modelIds.length} models · {isDeployed ? 'Deployed' : 'Off board'}</small></div>
                {canDeploy && <button type="button" onClick={() => onBeginUnit(unit.id)}>Deploy Unit</button>}
              </div>
            })}
          </div>
        </details>
      })}
      {onUndo && !placement && <button className="deployment-secondary" type="button" onClick={onUndo}>
        Undo last deployment
      </button>}
    </>}

    {placement && <div className="deployment-placement">
      <h3>{getUnitDefinition(state, state.units.find((unit) => unit.id === placement.unitId)!)?.name}</h3>
      <p>{placement.locked ? 'Formation placed. Adjust models or confirm.' : 'Move the pointer, then click to place the formation.'}</p>
      <div className={`deployment-validity ${placement.valid ? 'valid' : 'invalid'}`}>
        <strong>{placement.valid ? 'Legal placement' : 'Illegal placement'}</strong>
        {!placement.valid && placement.reasons.map((reason) => <small key={reason}>{reason}</small>)}
      </div>
      <div className="deployment-formation-controls">
        <span>Formation</span>
        <div>{placement.formationOptions.map((option) => <button type="button" key={option.id}
          className={placement.formationPreset === option.id ? 'active' : ''} disabled={!option.available}
          title={option.reason} onClick={() => onSelectFormationPreset(option.id)}>{option.label}</button>)}</div>
        <div className="deployment-preset-cycle">
          <button type="button" onClick={() => onCycleFormation(-1)}>Previous</button>
          <button type="button" onClick={() => onCycleFormation(1)}>Next</button>
        </div>
        {placement.formationPreset === 'custom' && <small>Custom — choose a preset to regenerate at this anchor.</small>}
        <div className="deployment-rotation-controls">
          <button type="button" onClick={() => onRotateFormation(-Math.PI / 12)}>↶ Rotate</button>
          <strong>{Math.round(placement.formationRotation * 180 / Math.PI)}°</strong>
          <button type="button" onClick={() => onRotateFormation(Math.PI / 12)}>Rotate ↷</button>
        </div>
        <small>{placement.formationValid ? 'Formation coherency valid' : 'Formation does not satisfy resolved coherency'} · Q/E cycles available presets</small>
      </div>
      {placement.locked && <>
        <button className="deployment-secondary" type="button" onClick={onMoveFormation}>Move whole formation</button>
        <details className="deployment-adjustments">
          <summary>Adjust individual models</summary>
          {state.units.find((unit) => unit.id === placement.unitId)?.modelIds.map((modelId) => {
            const model = state.models.find((candidate) => candidate.id === modelId)
            return <button type="button" className={`${placement.adjustingModelId === modelId ? 'active' : ''}${placement.hoveredModelId === modelId ? ' hover' : ''}`}
              key={modelId} onPointerEnter={() => onHoverModel(modelId)} onPointerLeave={() => onHoverModel(null)}
              onFocus={() => onHoverModel(modelId)} onBlur={() => onHoverModel(null)}
              onClick={() => onAdjustModel(modelId)}>{model?.label ?? modelId}</button>
          })}
        </details>
      </>}
      <div className="deployment-actions">
        <button type="button" onClick={onCancelPlacement}>Cancel</button>
        <button className="deployment-primary" type="button" disabled={!placement.locked || !placement.valid || Boolean(placement.adjustingModelId)}
          onClick={onConfirmPlacement}>Confirm deployment</button>
      </div>
    </div>}

    {deployment.phase === 'READY_FOR_BATTLE' && <div className="deployment-complete">
      <strong>Deployment complete</strong><span>Ready for battle</span>
      <small>Round 1 does not begin until M9.4.</small>
    </div>}
    <p className="deployment-rule-note">Deploy Unit is supported. Deploy Regiment is deferred until regiment membership is authored in the roster snapshot.</p>
  </section>
}

function RollOffSummary({ state, deployment }: { state: GameState; deployment: AosDeploymentState }) {
  return <div className="deployment-roll-summary" aria-label="Roll-off attempts">
    {deployment.rolls.map((roll, index) => <div key={index}>
      <span>Attempt {index + 1}</span>
      <b>{state.players[0]?.displayName}: <i>{roll.player1}</i></b>
      <b>{state.players[1]?.displayName}: <i>{roll.player2}</i></b>
      <small>{roll.player1 === roll.player2 ? 'Tie' : 'Decisive roll'}</small>
    </div>)}
  </div>
}

function territoryLabel(state: GameState, deployment: AosDeploymentState, playerId?: string): string {
  const zoneId = playerId ? deployment.territoryByPlayerId[playerId] : undefined
  const index = state.resolvedMatchConfiguration?.deploymentZones.findIndex((zone) => zone.id === zoneId) ?? -1
  return index >= 0 ? `Territory ${String.fromCharCode(65 + index)}` : 'Territory unassigned'
}

function labelFor(playerId: string | undefined, labels?: Record<string, string>): string {
  return playerId ? labels?.[playerId] ?? playerId : '—'
}
