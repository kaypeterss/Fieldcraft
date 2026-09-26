import type { AosMovementActionId, AosMovementAvailability, AosUnitMovementStatus } from '../gameSystem/ageOfSigmar/movement'
import type { MovementSummary } from './MovementPanel'

export type AosMovementMethod = 'manual' | 'smart'

interface AosMovementPanelProps {
  unitName: string
  moveCharacteristic: number
  availability: AosMovementAvailability
  summary: MovementSummary | null
  status?: AosUnitMovementStatus | null
  activeMethod?: AosMovementMethod | null
  message?: string
  targetUnits?: Array<{ id: string; name: string }>
  onTargetUnitChange?: (unitId: string) => void
  onChoose: (actionId: AosMovementActionId) => void
  onMethodChange: (method: AosMovementMethod) => void
  onConfirm: () => void
  onCancel: () => void
  onClose: () => void
}

export function AosMovementPanel(props: AosMovementPanelProps) {
  const selected = props.availability.selected
  const panelPhase = selected?.phase ?? (props.availability.available.includes('CHARGE') || props.status?.kind === 'CHARGE' ? 'CHARGE_PHASE'
    : props.availability.available.includes('PILE_IN') || props.status?.kind === 'PILE_IN' ? 'COMBAT_PHASE' : 'MOVEMENT_PHASE')
  const baseMove = props.status?.baseMove ?? props.moveCharacteristic
  const rollResult = selected?.rollResult ?? props.status?.rollResult
  const actionId = selected?.actionId ?? (props.status?.kind === 'READY' ? undefined : props.status?.kind)
  const allowance = actionId === 'RUN' ? baseMove + (rollResult ?? 0)
    : actionId === 'CHARGE' ? rollResult ?? 0
      : actionId === 'PILE_IN' ? 3 : baseMove
  return <aside className="movement-panel aos-movement-panel" aria-label="Age of Sigmar movement">
    <div className="movement-panel-heading">
      <div><span className="eyebrow">{panelPhase === 'CHARGE_PHASE' ? 'CHARGE' : panelPhase === 'COMBAT_PHASE' ? 'COMBAT' : 'MOVEMENT'}</span><strong>{props.unitName}</strong></div>
      <button type="button" className="panel-close" aria-label="Close Movement panel" onClick={props.onClose}>×</button>
    </div>
    <dl>
      <div><dt>Base Move</dt><dd>{baseMove}″</dd></div>
      <div><dt>Combat</dt><dd>{props.availability.inCombat ? 'In combat' : 'Not in combat'}</dd></div>
      <div><dt>Action</dt><dd>{actionId ? actionLabel(actionId) : props.status?.label ?? 'Choose an action'}</dd></div>
      {rollResult !== undefined && <div><dt>{actionId === 'RUN' ? 'Run Roll' : actionId === 'CHARGE' ? 'Charge Roll' : 'Retreat Damage'}</dt>
        <dd>{actionId === 'RUN' ? `+${rollResult}″` : actionId === 'CHARGE'
          ? `${selected?.rollResults?.join(' + ') ?? '2D6'} = ${rollResult}″` : `D3 = ${rollResult}`}</dd></div>}
      {actionId && <div><dt>Allowance</dt><dd>{allowance}″</dd></div>}
      {props.summary && <>
        <div><dt>Used</dt><dd>{props.summary.maximumUsed.toFixed(2)}″</dd></div>
        <div><dt>Remaining</dt><dd>{props.summary.minimumRemaining.toFixed(2)}″</dd></div>
      </>}
      {selected && !props.summary && <div><dt>Remaining</dt><dd>{allowance}″</dd></div>}
    </dl>
    {props.availability.reason && <p className="smart-warning" role="status">{props.availability.reason}</p>}
    {props.message && <p className="smart-message" role="status">{props.message}</p>}
    {!props.summary && props.availability.available.length > 0 && <><span className="movement-choice-label">ACTION</span><div className="movement-action-choices">
      {props.availability.available.map((actionId) => <button type="button" key={actionId}
        className={selected?.actionId === actionId ? 'active' : ''}
        onClick={() => props.onChoose(actionId)}>{actionLabel(actionId)}</button>)}
    </div></>}
    {!props.summary && selected?.actionId === 'PILE_IN' && props.availability.inCombat && <label className="movement-choice-label">
      PILE-IN TARGET
      <select value={selected.targetUnitId ?? ''} onChange={(event) => props.onTargetUnitChange?.(event.target.value)}>
        <option value="">Choose enemy unit</option>
        {(props.targetUnits ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
      </select>
    </label>}
    {!props.summary && <><span className="movement-choice-label">METHOD</span><div className="movement-method-choices">
      <button type="button" disabled={!selected} className={props.activeMethod === 'manual' ? 'active' : ''}
        onClick={() => props.onMethodChange('manual')}>Manual Move</button>
      <button type="button" disabled={!selected} className={props.activeMethod === 'smart' ? 'active' : ''}
        onClick={() => props.onMethodChange('smart')}>Smart Move</button>
    </div></>}
    {actionId === 'RUN' && <p className="movement-action-flag">RAN THIS TURN</p>}
    {actionId === 'RETREAT' && <p className="movement-action-flag">RETREATED THIS TURN</p>}
    {actionId === 'CHARGE' && <p className="movement-action-flag">FINISH WITHIN ½″ OF A VISIBLE ENEMY</p>}
    {actionId === 'PILE_IN' && <p className="movement-action-flag">{props.status?.kind === 'PILE_IN'
      ? 'PILE-IN COMPLETE · RETURN TO FIGHT'
      : '3″ · DO NOT FINISH FARTHER FROM THE TARGET'}</p>}
    {props.summary && <div className="movement-actions">
      <button className="cancel-move" onClick={props.onCancel}>Cancel <kbd>Esc</kbd></button>
      <button className="confirm-move" onClick={props.onConfirm}>Confirm <kbd>Enter</kbd></button>
    </div>}
  </aside>
}

function actionLabel(actionId: AosMovementActionId): string {
  if (actionId === 'NORMAL_MOVE') return 'Normal Move'
  if (actionId === 'RUN') return 'Run'
  if (actionId === 'RETREAT') return 'Retreat'
  if (actionId === 'CHARGE') return 'Charge'
  return 'Pile-in'
}
