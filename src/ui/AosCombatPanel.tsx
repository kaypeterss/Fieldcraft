import { useState } from 'react'
import type { AosActiveFight, AosAttackProfileOption, AosDeclaredAttack, AosFightAvailability } from '../gameSystem/ageOfSigmar/combat'
import {
  aosCombatDiceStages,
  type AosCombatDiceMode,
  type AosCombatDiceReview,
  type AosCombatDiceStageView,
} from '../gameSystem/ageOfSigmar/combatDicePresentation'

export interface AosCombatPanelProps {
  unitName: string
  playerName: string
  availability: AosFightAvailability
  unitDamage?: { healthThreshold: number; currentDamage: number; untilNextSlain: number } | null
  fight?: AosActiveFight
  profiles: AosAttackProfileOption[]
  targetNames: Readonly<Record<string, string>>
  allocatedDamage: number
  targetHealth?: number
  allocationOptions: string[][]
  modelNames: Readonly<Record<string, string>>
  hoveredModelId?: string | null
  focusedProfileId?: string | null
  diceMode: AosCombatDiceMode
  diceReview?: AosCombatDiceReview | null
  revealedDiceStage: number
  casualtyCandidateModelIds: readonly string[]
  selectedCasualtyModelId?: string | null
  onStartFight: () => void
  onBeginPileIn: () => void
  onCompletePileIn: () => void
  onDeclareAttacks: (allocations: AosDeclaredAttack[]) => void
  onResolveAttacks: (profileId: string, targetUnitId: string) => void
  onDiceModeChange: (mode: AosCombatDiceMode) => void
  onNextDiceStage: () => void
  onCasualtyModelChoose: (modelId: string) => void
  onConfirmUnitDamage: () => void
  onCasualtyModelHover: (modelId: string | null) => void
  onProfileFocus: (profileId: string | null, targetUnitId: string | null) => void
  onClose: () => void
}

export function AosCombatPanel(props: AosCombatPanelProps) {
  const [targetByProfile, setTargetByProfile] = useState<Record<string, string>>({})
  const pending = props.fight?.pendingDamage
  const diceStages = props.diceReview ? aosCombatDiceStages(props.diceReview) : []
  const stepping = props.diceMode === 'step' && props.diceReview && props.revealedDiceStage < diceStages.length
  const nonlethal = Boolean(pending && !pending.coherencyCorrection && props.targetHealth
    && props.allocatedDamage + pending.remaining < props.targetHealth)

  return <aside className="movement-panel aos-combat-panel" aria-label="Age of Sigmar combat">
    <div className="movement-panel-heading">
      <div><span className="eyebrow">FIGHT</span><strong>{props.unitName}</strong><small>{props.playerName}</small></div>
      <button type="button" className="panel-close" aria-label="Close Combat panel" onClick={props.onClose}>×</button>
    </div>
    <div className="combat-resolution-mode" aria-label="Combat dice resolution mode">
      <button type="button" className={props.diceMode === 'quick' ? 'active' : ''}
        onClick={() => props.onDiceModeChange('quick')}>Quick Resolve</button>
      <button type="button" className={props.diceMode === 'step' ? 'active' : ''}
        onClick={() => props.onDiceModeChange('step')}>Step Through</button>
    </div>
    {props.unitDamage && props.unitDamage.currentDamage > 0 && <dl aria-label="Selected unit damage">
      <div><dt>Health threshold</dt><dd>{props.unitDamage.healthThreshold}</dd></div>
      <div><dt>Current unit damage</dt><dd>{props.unitDamage.currentDamage} / {props.unitDamage.healthThreshold}</dd></div>
      <div><dt>Until next model slain</dt><dd>{props.unitDamage.untilNextSlain} more damage</dd></div>
    </dl>}

    {!props.fight && <>
      <dl>
        <div><dt>Combat</dt><dd>{props.availability.inCombat ? 'In combat' : 'Not in combat'}</dd></div>
        <div><dt>Charged</dt><dd>{props.availability.charged ? 'This turn' : 'No'}</dd></div>
        <div><dt>Status</dt><dd>{props.availability.alreadyFought ? 'Fought' : props.availability.eligible ? 'Eligible' : 'Waiting'}</dd></div>
      </dl>
      {props.availability.reason && <p className="smart-warning" role="status">{props.availability.reason}</p>}
      <button type="button" className="primary-panel-action" disabled={!props.availability.eligible} onClick={props.onStartFight}>Fight</button>
    </>}

    {props.fight?.stage === 'PILE_IN' && <section className="combat-stage-card">
      <span className="panel-section-label">1 · PILE-IN</span>
      <p>Move up to 3″ using the existing legal pile-in movement, or remain in place.</p>
      <div className="movement-action-choices">
        <button type="button" onClick={props.onBeginPileIn}>Move / adjust</button>
        <button type="button" className="primary-panel-action" onClick={props.onCompletePileIn}>Continue to attacks</button>
      </div>
    </section>}

    {props.fight?.stage === 'ATTACKS' && <section className="combat-stage-card">
      <span className="panel-section-label">2 · ATTACKS</span>
      {props.profiles.filter((option) => !props.fight?.resolvedProfileIds.includes(option.profile.id)).map((option) => {
        const declaration = props.fight?.declaredAttacks?.find((entry) => entry.profileId === option.profile.id)
        const requestedTarget = targetByProfile[option.profile.id]
        const targetId = declaration?.targetUnitId ?? (requestedTarget && option.eligibleTargetUnitIds.includes(requestedTarget)
          ? requestedTarget : option.eligibleTargetUnitIds[0] ?? '')
        const linkedFromBattlefield = Boolean(props.hoveredModelId && option.profileModelIds.includes(props.hoveredModelId))
        const focused = props.focusedProfileId === option.profile.id
        return <article className={`combat-weapon-card${linkedFromBattlefield ? ' model-linked' : ''}${focused ? ' focused' : ''}`}
          key={option.profile.id}
          onMouseEnter={() => props.onProfileFocus(option.profile.id, targetId || null)}
          onMouseLeave={() => props.onProfileFocus(
            requestedTarget && option.eligibleTargetUnitIds.includes(requestedTarget) ? option.profile.id : null,
            requestedTarget && option.eligibleTargetUnitIds.includes(requestedTarget) ? requestedTarget : null,
          )}
          onFocus={() => props.onProfileFocus(option.profile.id, targetId || null)}>
          <strong>{option.profile.name}</strong>
          <small>{option.profile.attacks} Attacks · {option.profile.hit}+ Hit · {option.profile.wound}+ Wound · Rend {option.profile.rend} · Damage {option.profile.damage}</small>
          <small>{option.eligibleModelIds.length} model{option.eligibleModelIds.length === 1 ? '' : 's'} in combat range · {option.maximumAttacks} attack{option.maximumAttacks === 1 ? '' : 's'}</small>
          {option.profile.abilities?.length ? <small className="battle-note">{option.profile.abilities.join(' · ')}</small> : null}
          {option.unsupportedReason ? <p className="smart-warning">{option.unsupportedReason}</p> : declaration ? <small>
            Target locked: {props.targetNames[declaration.targetUnitId] ?? declaration.targetUnitId} · {declaration.attacks} attacks
          </small> : <label>
            Target
            <select value={targetId} onChange={(event) => {
              setTargetByProfile((current) => ({ ...current, [option.profile.id]: event.target.value }))
              props.onProfileFocus(option.profile.id, event.target.value)
            }}>
              {option.eligibleTargetUnitIds.map((id) => <option key={id} value={id}>{props.targetNames[id] ?? id}</option>)}
            </select>
          </label>}
          {props.fight?.declaredAttacks && <button type="button" className="primary-panel-action"
            disabled={Boolean(option.unsupportedReason) || !declaration || !targetId || option.maximumAttacks < 1}
            onClick={() => props.onResolveAttacks(option.profile.id, targetId)}>Resolve attacks</button>}
        </article>
      })}
      {!props.fight.declaredAttacks && <button type="button" className="primary-panel-action"
        disabled={props.profiles.filter((option) => option.maximumAttacks > 0 && !option.unsupportedReason)
          .some((option) => !(targetByProfile[option.profile.id] ?? option.eligibleTargetUnitIds[0]))}
        onClick={() => props.onDeclareAttacks(props.profiles
          .filter((option) => option.maximumAttacks > 0 && !option.unsupportedReason)
          .map((option) => ({
            profileId: option.profile.id,
            targetUnitId: targetByProfile[option.profile.id] ?? option.eligibleTargetUnitIds[0],
            attacks: option.maximumAttacks,
          })))}>Declare all attacks</button>}
      {props.profiles.every((option) => props.fight?.resolvedProfileIds.includes(option.profile.id)) && <p>No unresolved melee profiles remain.</p>}
    </section>}

    {props.diceReview && <CombatDiceReviewView
      mode={props.diceMode}
      stages={diceStages}
      revealedStage={props.revealedDiceStage}
      onNext={props.onNextDiceStage}
    />}

    {props.fight?.stage === 'ALLOCATE_DAMAGE' && pending && !stepping && <section className="combat-stage-card">
      <span className="panel-section-label">3 · DAMAGE</span>
      <dl>
        <div><dt>Attacks</dt><dd>{pending.attacks}</dd></div>
        <div><dt>Hits</dt><dd>{pending.hits}{pending.criticalMortalHits ? ` · ${pending.criticalMortalHits} mortal crit` : ''}</dd></div>
        <div><dt>Wounds</dt><dd>{pending.wounds}</dd></div>
        <div><dt>Saved</dt><dd>{pending.saved}</dd></div>
        <div><dt>Unsaved</dt><dd>{pending.unsaved}</dd></div>
        <div><dt>Ward</dt><dd>{pending.wardPrevented} prevented</dd></div>
        <div><dt>Damage pool</dt><dd>{pending.remaining}</dd></div>
        {props.targetHealth && <>
          <div><dt>Current target unit damage</dt><dd>{props.allocatedDamage} / {props.targetHealth}</dd></div>
          <div><dt>Until next target model slain</dt><dd>{Math.max(0, props.targetHealth - props.allocatedDamage)}</dd></div>
        </>}
      </dl>
      <div className="combat-casualty-options">
        <span className="movement-choice-label">{pending.coherencyCorrection
          ? 'RESTORE COHERENCY — CHOOSE NEXT MODEL'
          : nonlethal
            ? 'CONFIRM DAMAGE ON UNIT' : 'CHOOSE ONE SLAIN MODEL'}</span>
        {nonlethal ? <>
          <small>No model is slain yet; this damage remains on the unit.</small>
          <button type="button" className="primary-panel-action" onClick={props.onConfirmUnitDamage}>Allocate damage to unit</button>
        </> : <>
        <small>Pick a highlighted model on the battlefield, or use this compact list.</small>
        <div className="combat-casualty-list">
          {props.casualtyCandidateModelIds.map((modelId) => <button type="button" key={modelId}
            className={`${props.hoveredModelId === modelId ? 'model-linked' : ''}${props.selectedCasualtyModelId === modelId ? ' selected' : ''}`}
            onMouseEnter={() => props.onCasualtyModelHover(modelId)}
            onMouseLeave={() => props.onCasualtyModelHover(null)}
            onFocus={() => props.onCasualtyModelHover(modelId)}
            onBlur={() => props.onCasualtyModelHover(null)}
            onClick={() => props.onCasualtyModelChoose(modelId)}>
            {props.modelNames[modelId] ?? modelId}
          </button>)}
        </div>
        {pending.coherencyCorrection && <small role="status">
          Remove the fewest additional models needed for one coherent group ({pending.coherencyCorrection.minimumAdditionalRemovals} remaining). These are slain by incoherency, separately from the attack damage pool.
        </small>}
        {!pending.coherencyCorrection && <small>
          The defender may choose any model. If its removal breaks coherency, resolve the minimum extra removals next.
        </small>}
        </>}
      </div>
    </section>}
  </aside>
}

function CombatDiceReviewView(props: {
  mode: AosCombatDiceMode
  stages: AosCombatDiceStageView[]
  revealedStage: number
  onNext: () => void
}) {
  if (props.stages.length === 0) return null
  if (props.mode === 'step' && props.revealedStage < props.stages.length) {
    const stage = props.stages[props.revealedStage]
    return <section className="combat-stage-card combat-dice-review" aria-live="polite">
      <span className="panel-section-label">DICE · {props.revealedStage + 1} / {props.stages.length}</span>
      <CombatDiceStage stage={stage} expanded />
      <button type="button" className="primary-panel-action" onClick={props.onNext}>
        {props.revealedStage + 1 < props.stages.length ? 'Next Pool' : 'Continue'}
      </button>
    </section>
  }
  return <section className="combat-stage-card combat-dice-review">
    <span className="panel-section-label">DICE RESULT</span>
    <div className="combat-dice-chain-summary">
      {props.stages.map((stage) => <span key={stage.id}><strong>{stage.label}</strong> {stage.continuation}</span>)}
    </div>
    <div className="combat-dice-stage-list">
      {props.stages.map((stage) => <details key={stage.id}>
        <summary><strong>{stage.label}</strong><span>{stage.inputDiceCount}D{stage.sides} · {stage.continuation} {stage.continuationLabel}</span></summary>
        <CombatDiceStage stage={stage} expanded />
      </details>)}
    </div>
  </section>
}

function CombatDiceStage({ stage, expanded }: { stage: AosCombatDiceStageView; expanded?: boolean }) {
  return <div className={`combat-dice-stage${expanded ? ' expanded' : ''}`}>
    <div className="combat-dice-stage-heading">
      <strong>{stage.label}</strong>
      <span>{stage.inputDiceCount}D{stage.sides}{stage.effectiveThreshold === undefined ? '' : ` · ${stage.effectiveThreshold}+`}</span>
    </div>
    {stage.effectiveThreshold !== undefined && <small>
      Threshold {stage.effectiveThreshold}+
      {stage.thresholdModifier ? ` · base ${stage.baseThreshold}+ · ${stage.modifierLabel ?? `modifier ${stage.thresholdModifier > 0 ? '+' : ''}${stage.thresholdModifier}`}` : ' · no modifier'}
    </small>}
    <div className="combat-dice-results" aria-label={`${stage.label} dice results`}>
      {stage.results.map((value, index) => <span key={index}>{value}</span>)}
    </div>
    <div className="combat-dice-outcome">
      {stage.successes !== undefined && <span>{stage.successes} success{stage.successes === 1 ? '' : 'es'}</span>}
      {stage.failures !== undefined && <span>{stage.failures} failure{stage.failures === 1 ? '' : 's'}</span>}
      <strong>{stage.continuation} {stage.continuationLabel}</strong>
    </div>
  </div>
}
