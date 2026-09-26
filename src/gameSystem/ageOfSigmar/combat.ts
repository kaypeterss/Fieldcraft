import type {
  DiceRollRecord,
  DiceSequenceDefinition,
  DiceSequenceRecord,
  GameState,
  JsonValue,
  TabletopModel,
  Unit,
} from '../../domain/types'
import { evaluateUnitCoherency, isCoherencyResultValid } from '../../engine/coherency'
import { distanceBetweenBases } from '../../engine/spatial'
import { commitOperation, createCommittedOperation } from '../../game/committedOperations'
import { activeBattlefieldModels } from '../../game/modelPresence'
import { getUnitDefinition } from '../../game/selectors'
import type { GameSystemCommand } from '../types'
import { currentAosPhase } from './battleRound'
import { aosWarscrollById, aosWarscrollIdFromDefinitionId } from './content/profiles'
import type { AosWeaponProfile, AosWarscrollProfile } from './content/types'
import type { AosMatchStateData } from './deployment'
import { AOS_COMBAT_RANGE, ensureAosMovementState, unitIsInCombat } from './movement'

export type AosFightStage = 'PILE_IN' | 'ATTACKS' | 'ALLOCATE_DAMAGE'

export interface AosPendingDamage {
  attackerUnitId: string
  targetUnitId: string
  profileId: string
  sequenceRecordId: string
  wardRecordId?: string
  randomDamageRecordId?: string
  attacks: number
  hits: number
  criticalMortalHits: number
  wounds: number
  saved: number
  unsaved: number
  grossDamage: number
  wardPrevented: number
  remaining: number
  slainModelIds: string[]
  /** Models slain solely to restore coherency, not by another Health threshold. */
  coherencySlainModelIds?: string[]
  /** Resolve this before allocating any more damage from the pool. */
  coherencyCorrection?: { minimumAdditionalRemovals: number }
}

export interface AosActiveFight {
  unitId: string
  playerId: string
  turnId: string
  stage: AosFightStage
  pileInComplete: boolean
  resolvedProfileIds: string[]
  declaredAttacks?: AosDeclaredAttack[]
  pendingDamage?: AosPendingDamage
}

export interface AosDeclaredAttack {
  profileId: string
  targetUnitId: string
  attacks: number
}

export interface AosFightFact {
  sequence: number
  type: 'UNIT_FOUGHT'
  turnId: string
  playerId: string
  unitId: string
  attackResolutions: AosAttackResolutionFact[]
}

export type AosAttackResolutionFact = Omit<AosPendingDamage, 'remaining'>

export interface AosUnitDestroyedFact {
  sequence: number
  type: 'UNIT_DESTROYED'
  turnId: string
  playerId: string
  unitId: string
  sourceUnitId: string
}

export interface AosCombatState {
  turnId?: string
  opportunityPlayerId?: string
  foughtUnitIds: string[]
  allocatedDamageByUnitId: Record<string, number>
  activeFight?: AosActiveFight
  fightFacts: AosFightFact[]
  destroyedUnitFacts: AosUnitDestroyedFact[]
  /** Completed resolutions for the active Fight are retained here until Fight completion. */
  activeAttackFacts?: AosAttackResolutionFact[]
}

export interface AosFightAvailability {
  eligible: boolean
  reason?: string
  opportunityPlayerId?: string
  alreadyFought: boolean
  inCombat: boolean
  charged: boolean
}

export interface AosAttackProfileOption {
  profile: AosWeaponProfile
  profileModelIds: string[]
  eligibleModelIds: string[]
  eligibleTargetUnitIds: string[]
  maximumAttacks: number
  unsupportedReason?: string
}

export function initialAosCombatState(): AosCombatState {
  return { foughtUnitIds: [], allocatedDamageByUnitId: {}, fightFacts: [], destroyedUnitFacts: [] }
}

export function ensureAosCombatState(data: AosMatchStateData, state?: GameState): AosCombatState {
  const combat = data.combat ?? initialAosCombatState()
  if (!state || combat.turnId === state.gameContext.turnId) return combat
  return {
    ...combat,
    turnId: state.gameContext.turnId,
    opportunityPlayerId: state.gameContext.activePlayerId,
    foughtUnitIds: [],
    activeFight: undefined,
    activeAttackFacts: undefined,
  }
}

export function isAosCombatState(value: unknown): value is AosCombatState {
  const candidate = record(value)
  if (!candidate || !Array.isArray(candidate.foughtUnitIds) || !record(candidate.allocatedDamageByUnitId)
    || !Array.isArray(candidate.fightFacts) || !Array.isArray(candidate.destroyedUnitFacts)) return false
  if (!candidate.foughtUnitIds.every((id: unknown) => typeof id === 'string')) return false
  const damage = record(candidate.allocatedDamageByUnitId)!
  if (!Object.values(damage).every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)) return false
  const fight = candidate.activeFight === undefined ? null : record(candidate.activeFight)
  if (candidate.activeFight !== undefined && (!fight || typeof fight.unitId !== 'string'
    || !['PILE_IN', 'ATTACKS', 'ALLOCATE_DAMAGE'].includes(String(fight.stage)))) return false
  return true
}

export function aosUnitProfile(state: GameState, unit: Unit): AosWarscrollProfile | undefined {
  const definition = getUnitDefinition(state, unit)
  const profileId = definition ? aosWarscrollIdFromDefinitionId(definition.id) : null
  return profileId ? aosWarscrollById(profileId) : undefined
}

export function aosUnitAllocatedDamage(state: GameState, unitId: string): number {
  const data = aosData(state)
  return data ? ensureAosCombatState(data, state).allocatedDamageByUnitId[unitId] ?? 0 : 0
}

export function aosFightAvailability(state: GameState, unitId: string): AosFightAvailability {
  const data = aosData(state)
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const inCombat = unit ? unitIsInCombat(state, unit) : false
  const combat = data ? ensureAosCombatState(data, state) : initialAosCombatState()
  const alreadyFought = combat.foughtUnitIds.includes(unitId)
  const charged = Boolean(data && unit && ensureAosMovementState(data).facts.some((fact) => fact.unitId === unit.id
    && fact.turnId === state.gameContext.turnId && fact.actionId === 'CHARGE'))
  const opportunityPlayerId = data && unit ? currentFightOpportunity(state, data) : undefined
  if (!unit || !data || data.status !== 'battle' || !data.battle || currentAosPhase(data.battle)?.id !== 'COMBAT_PHASE') {
    return { eligible: false, reason: 'Fight is only available in the Combat Phase.', opportunityPlayerId, alreadyFought, inCombat, charged }
  }
  if (combat.activeFight && combat.activeFight.unitId !== unitId) {
    return { eligible: false, reason: 'Resolve the active Fight first.', opportunityPlayerId, alreadyFought, inCombat, charged }
  }
  if (alreadyFought) return { eligible: false, reason: 'This unit already used a Fight ability this phase.', opportunityPlayerId, alreadyFought, inCombat, charged }
  if (unit.ownerId !== opportunityPlayerId) return { eligible: false, reason: `${playerName(state, opportunityPlayerId)} has the next Fight opportunity.`, opportunityPlayerId, alreadyFought, inCombat, charged }
  if (!inCombat && !charged) return { eligible: false, reason: 'A unit must be in combat or have charged this turn to Fight.', opportunityPlayerId, alreadyFought, inCombat, charged }
  if (!activeUnitModels(state, unit.id).length) return { eligible: false, reason: 'This unit has no models on the battlefield.', opportunityPlayerId, alreadyFought, inCombat, charged }
  if (!aosUnitProfile(state, unit)?.weapons.some((weapon) => weapon.type === 'melee' && !weaponUnsupportedReason(weapon))) {
    return { eligible: false, reason: 'No supported melee weapon profile is installed for this unit.', opportunityPlayerId, alreadyFought, inCombat, charged }
  }
  return { eligible: true, opportunityPlayerId, alreadyFought, inCombat, charged }
}

export function currentFightOpportunity(state: GameState, data = aosData(state)): string | undefined {
  if (!data) return undefined
  const combat = ensureAosCombatState(data, state)
  const preferred = combat.opportunityPlayerId ?? state.gameContext.activePlayerId
  if (eligibleFightUnitsForPlayer(state, preferred, combat).length) return preferred
  return state.players.map((player) => player.id)
    .find((playerId) => playerId !== preferred && eligibleFightUnitsForPlayer(state, playerId, combat).length)
}

export function aosAttackProfileOptions(state: GameState, unitId: string): AosAttackProfileOption[] {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const profile = unit ? aosUnitProfile(state, unit) : undefined
  if (!unit || !profile) return []
  const enemies = state.units.filter((candidate) => candidate.ownerId !== unit.ownerId && activeUnitModels(state, candidate.id).length)
  return profile.weapons.filter((weapon) => weapon.type === 'melee').map((weapon) => {
    const attackRange = aosMeleeAttackRange(weapon)
    const armed = aosProfileModelIds(state, unit.id, weapon.id)
      .flatMap((id) => activeUnitModels(state, unit.id).filter((model) => model.id === id))
    const targets = enemies.filter((target) => armed.some((model) => activeUnitModels(state, target.id)
      .some((enemy) => distanceBetweenBases(model, enemy) <= attackRange + 1e-9)))
    const eligibleModels = armed.filter((model) => targets.some((target) => activeUnitModels(state, target.id)
      .some((enemy) => distanceBetweenBases(model, enemy) <= attackRange + 1e-9)))
    const attacks = fixedCharacteristic(weapon.attacks)
    const unsupportedReason = weaponUnsupportedReason(weapon)
    return {
      profile: weapon,
      profileModelIds: armed.map((model) => model.id),
      eligibleModelIds: eligibleModels.map((model) => model.id),
      eligibleTargetUnitIds: targets.map((target) => target.id),
      maximumAttacks: eligibleModels.length * (attacks ?? 0),
      ...(unsupportedReason ? { unsupportedReason } : {}),
    }
  })
}

/** The controlled melee snapshot uses the universal combat range unless a
 * versioned weapon profile explicitly supplies its own attack range.
 * Presentation and authoritative contributor checks share this resolver.
 */
export function aosMeleeAttackRange(weapon: AosWeaponProfile): number {
  return weapon.range ?? AOS_COMBAT_RANGE
}

export function aosAttackCountForTarget(state: GameState, unitId: string, profileId: string, targetUnitId: string): number {
  const option = aosAttackProfileOptions(state, unitId).find((candidate) => candidate.profile.id === profileId)
  if (!option || option.unsupportedReason || !option.eligibleTargetUnitIds.includes(targetUnitId)) return 0
  return aosAttackingModelIdsForTarget(state, unitId, profileId, targetUnitId).length
    * (fixedCharacteristic(option.profile.attacks) ?? 0)
}

/** Authoritative contributors for one profile/target allocation; rendering consumes these exact IDs. */
export function aosAttackingModelIdsForTarget(
  state: GameState,
  unitId: string,
  profileId: string,
  targetUnitId: string,
): string[] {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const profile = unit ? aosUnitProfile(state, unit) : undefined
  const weapon = profile?.weapons.find((candidate) => candidate.id === profileId && candidate.type === 'melee')
  if (!weapon) return []
  const targets = activeUnitModels(state, targetUnitId)
  return activeUnitModels(state, unitId)
    .filter((model) => modelArmedWith(model, weapon)
      && targets.some((enemy) => distanceBetweenBases(model, enemy) <= aosMeleeAttackRange(weapon) + 1e-9))
    .map((model) => model.id)
}

export function aosProfileModelIds(state: GameState, unitId: string, profileId: string): string[] {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const profile = unit ? aosUnitProfile(state, unit) : undefined
  const weapon = profile?.weapons.find((candidate) => candidate.id === profileId)
  return weapon ? activeUnitModels(state, unitId).filter((model) => modelArmedWith(model, weapon)).map((model) => model.id) : []
}

export function effectiveAosRend(weapon: AosWeaponProfile, target: AosWarscrollProfile): number {
  const antiHero = weapon.abilities?.includes('Anti-HERO (+1 Rend)') && target.keywords.includes('HERO') ? 1 : 0
  return weapon.rend + antiHero
}

export function effectiveAosSave(save: number, rend: number): number { return save + rend }

export function aosAttackSequenceDefinition(request: {
  id: string
  attacks: number
  weapon: AosWeaponProfile
  target: AosWarscrollProfile
}): DiceSequenceDefinition {
  const effectiveSave = effectiveAosSave(request.target.save, effectiveAosRend(request.weapon, request.target))
  return {
    id: request.id,
    label: `${request.weapon.name} into ${request.target.name}`,
    startingDiceCount: request.attacks,
    stages: [
      { id: 'hit', label: `Hit ${request.weapon.hit}+`, sides: 6, threshold: request.weapon.hit, continuation: 'successes' },
      { id: 'wound', label: `Wound ${request.weapon.wound}+`, sides: 6, threshold: request.weapon.wound, continuation: 'successes' },
      ...(effectiveSave <= 6 ? [{ id: 'save', label: `Save ${effectiveSave}+`, sides: 6, threshold: effectiveSave, continuation: 'failures' } as const] : []),
    ],
  }
}

/** Crit (Mortal) branches out before Wound while keeping the generic roll/result record. */
export function aosAttackSequenceModifiers(weapon: AosWeaponProfile) {
  let criticalAutoWounds = 0
  return {
    resolveContinuationCount: (result: { defaultContinuationCount: number; roll: { finalResults: number[] } }, context: { stage: { id: string } }) => {
      if (context.stage.id === 'hit') {
        const criticals = result.roll.finalResults.filter((value) => value === 6).length
        if (weapon.abilities?.includes('Crit (Auto-wound)')) criticalAutoWounds = criticals
        if (weapon.abilities?.includes('Crit (Mortal)') || weapon.abilities?.includes('Crit (Auto-wound)')) {
          return result.defaultContinuationCount - criticals
        }
      }
      if (context.stage.id === 'wound' && criticalAutoWounds > 0) return result.defaultContinuationCount + criticalAutoWounds
      return result.defaultContinuationCount
    },
  }
}

export function aosDamageAllocationOptions(state: GameState, targetUnitId: string): string[][] {
  const models = activeUnitModels(state, targetUnitId)
  if (!models.length) return []
  return models.map((model) => [model.id])
}

/** Minimum additional removals after a freely chosen slain model has left the unit. */
export function aosCoherencyCorrectionOptions(state: GameState, targetUnitId: string): string[][] {
  const unit = state.units.find((candidate) => candidate.id === targetUnitId)
  const models = activeUnitModels(state, targetUnitId)
  if (!unit || models.length <= 1 || aosSurvivorsCoherent(state, unit, models)) return []
  for (let count = 1; count <= models.length; count += 1) {
    const options = combinations(models.map((model) => model.id), count).filter((removed) => {
      const removedIds = new Set(removed)
      return aosSurvivorsCoherent(state, unit, models.filter((model) => !removedIds.has(model.id)))
    })
    if (options.length) return options
  }
  return [models.map((model) => model.id)]
}

function aosSurvivorsCoherent(state: GameState, unit: Unit, survivors: TabletopModel[]): boolean {
  if (survivors.length <= 1) return true
  const definitionPolicy = getUnitDefinition(state, unit)?.coherencyPolicy
  const policy = { distance: definitionPolicy?.distance ?? 0.5,
    requiredNeighbors: survivors.length >= 7 ? 2 : 1, requireConnected: true }
  return isCoherencyResultValid(evaluateUnitCoherency(unit, survivors, policy), policy)
}

export function executeAosCombatCommand(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  if (command.type === 'aos/combat/start-fight') return startFight(state, data, command)
  if (command.type === 'aos/combat/pile-in-complete') return completePileIn(state, data, command)
  if (command.type === 'aos/combat/declare-attacks') return declareAttacks(state, data, command)
  if (command.type === 'aos/combat/resolve-attacks') return resolveAttacks(state, data, command)
  if (command.type === 'aos/combat/allocate-damage') return allocateDamage(state, data, command)
  return state
}

function declareAttacks(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const payload = record(command.payload)
  const combat = ensureAosCombatState(data, state)
  const fight = combat.activeFight
  if (!fight || fight.stage !== 'ATTACKS' || fight.playerId !== command.actorPlayerId || fight.declaredAttacks || !payload) return state
  const requested = Array.isArray(payload.allocations) ? payload.allocations.map(record) : []
  const available = aosAttackProfileOptions(state, fight.unitId)
    .filter((option) => option.maximumAttacks > 0 && !option.unsupportedReason)
  if (requested.length !== available.length) return state
  const declarations: AosDeclaredAttack[] = []
  for (const option of available) {
    const entries = requested.filter((entry) => entry?.profileId === option.profile.id)
    const targetUnitId = entries[0]?.targetUnitId
    if (entries.length !== 1 || typeof targetUnitId !== 'string' || !option.eligibleTargetUnitIds.includes(targetUnitId)) return state
    const attacks = aosAttackCountForTarget(state, fight.unitId, option.profile.id, targetUnitId)
    if (attacks < 1) return state
    declarations.push({ profileId: option.profile.id, targetUnitId, attacks })
  }
  return replaceCombat(state, data, {
    ...combat,
    activeFight: { ...fight, declaredAttacks: declarations },
  }, true)
}

function startFight(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const unitId = record(command.payload)?.unitId
  if (typeof unitId !== 'string') return state
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const availability = aosFightAvailability(state, unitId)
  if (!unit || command.actorPlayerId !== unit.ownerId || !availability.eligible) return state
  const combat = ensureAosCombatState(data, state)
  return replaceCombat(state, data, {
    ...combat,
    turnId: state.gameContext.turnId,
    opportunityPlayerId: unit.ownerId,
    activeFight: { unitId, playerId: unit.ownerId, turnId: state.gameContext.turnId, stage: 'PILE_IN', pileInComplete: false, resolvedProfileIds: [] },
    activeAttackFacts: [],
  }, true)
}

function completePileIn(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const combat = ensureAosCombatState(data, state)
  const fight = combat.activeFight
  if (!fight || fight.stage !== 'PILE_IN' || fight.playerId !== command.actorPlayerId || fight.turnId !== state.gameContext.turnId
    || !aosFightAvailability(state, fight.unitId).eligible) return state
  return maybeFinishFight(state, data, { ...combat, activeFight: { ...fight, stage: 'ATTACKS', pileInComplete: true } })
}

function resolveAttacks(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const payload = record(command.payload)
  const combat = ensureAosCombatState(data, state)
  const fight = combat.activeFight
  if (!fight || fight.stage !== 'ATTACKS' || fight.playerId !== command.actorPlayerId || !payload) return state
  const profileId = payload.profileId
  const targetUnitId = payload.targetUnitId
  const sequenceRecordId = payload.sequenceRecordId
  if (typeof profileId !== 'string' || typeof targetUnitId !== 'string' || typeof sequenceRecordId !== 'string') return state
  if (fight.resolvedProfileIds.includes(profileId)) return state
  const declaration = fight.declaredAttacks?.find((entry) => entry.profileId === profileId && entry.targetUnitId === targetUnitId)
  if (!declaration) return state
  const attacker = state.units.find((unit) => unit.id === fight.unitId)
  const target = state.units.find((unit) => unit.id === targetUnitId)
  const attackerProfile = attacker ? aosUnitProfile(state, attacker) : undefined
  const targetProfile = target ? aosUnitProfile(state, target) : undefined
  const weapon = attackerProfile?.weapons.find((candidate) => candidate.id === profileId && candidate.type === 'melee')
  const attackCount = declaration.attacks
  const sequence = diceSequenceRecord(state, sequenceRecordId)
  if (!attacker || !target || !activeUnitModels(state, target.id).length || !weapon || !targetProfile || attackCount <= 0 || !sequence
    || sequence.playerId !== attacker.ownerId || sequence.turnId !== state.gameContext.turnId
    || !sameSequenceDefinition(sequence.definition, aosAttackSequenceDefinition({ id: sequence.definition.id, attacks: attackCount, weapon, target: targetProfile }))) return state
  const hit = sequence.stageResults.find((stage) => stage.stage.id === 'hit')
  const wound = sequence.stageResults.find((stage) => stage.stage.id === 'wound')
  const save = sequence.stageResults.find((stage) => stage.stage.id === 'save')
  if (!hit || !wound || !sequence.complete) return state
  const criticalMortalHits = weapon.abilities?.includes('Crit (Mortal)')
    ? hit.roll.finalResults.filter((value) => value === 6).length : 0
  const unsaved = save ? save.continuationCount : wound.continuationCount
  const fixedDamage = fixedCharacteristic(weapon.damage)
  let normalDamage: number
  let randomDamageRecordId: string | undefined
  if (fixedDamage !== null) normalDamage = unsaved * fixedDamage
  else {
    randomDamageRecordId = typeof payload.randomDamageRecordId === 'string' ? payload.randomDamageRecordId : undefined
    const roll = diceRollRecord(state, randomDamageRecordId)
    if (weapon.damage !== 'D3' || !roll || roll.playerId !== attacker.ownerId || roll.count !== unsaved || roll.sides !== 3) return state
    normalDamage = roll.total
  }
  const criticalDamage = criticalMortalHits * (fixedDamage ?? 0)
  if (criticalMortalHits > 0 && fixedDamage === null) return state
  const grossDamage = normalDamage + criticalDamage
  let wardPrevented = 0
  let wardRecordId: string | undefined
  if (targetProfile.ward && grossDamage > 0) {
    wardRecordId = typeof payload.wardRecordId === 'string' ? payload.wardRecordId : undefined
    const ward = diceRollRecord(state, wardRecordId)
    if (!ward || ward.playerId !== target.ownerId || ward.count !== grossDamage || ward.sides !== 6 || ward.successThreshold !== targetProfile.ward) return state
    wardPrevented = ward.successes ?? 0
  }
  const pending: AosPendingDamage = {
    attackerUnitId: attacker.id, targetUnitId: target.id, profileId, sequenceRecordId,
    ...(wardRecordId ? { wardRecordId } : {}), ...(randomDamageRecordId ? { randomDamageRecordId } : {}),
    attacks: attackCount, hits: hit.successCount, criticalMortalHits, wounds: wound.successCount,
    saved: save?.successCount ?? 0, unsaved, grossDamage, wardPrevented,
    remaining: Math.max(0, grossDamage - wardPrevented), slainModelIds: [],
  }
  const nextFight: AosActiveFight = { ...fight, stage: pending.remaining > 0 ? 'ALLOCATE_DAMAGE' : 'ATTACKS',
    resolvedProfileIds: pending.remaining > 0 ? fight.resolvedProfileIds : [...fight.resolvedProfileIds, profileId],
    ...(pending.remaining > 0 ? { pendingDamage: pending } : {}) }
  const nextFacts = pending.remaining > 0 ? combat.activeAttackFacts ?? [] : [...(combat.activeAttackFacts ?? []), completedAttackFact(pending)]
  const nextCombat = { ...combat, activeFight: nextFight, activeAttackFacts: nextFacts }
  return pending.remaining > 0 ? replaceCombat(state, data, nextCombat, true) : maybeFinishFight(state, data, nextCombat)
}

function allocateDamage(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const combat = ensureAosCombatState(data, state)
  const fight = combat.activeFight
  const pending = fight?.pendingDamage
  const target = pending ? state.units.find((unit) => unit.id === pending.targetUnitId) : undefined
  const targetProfile = target ? aosUnitProfile(state, target) : undefined
  if (!fight || fight.stage !== 'ALLOCATE_DAMAGE' || !pending || !target || !targetProfile || command.actorPlayerId !== target.ownerId) return state
  const payload = record(command.payload)
  const modelId = typeof payload?.modelId === 'string' ? payload.modelId
    : Array.isArray(payload?.slainModelIds) && payload.slainModelIds.length === 1 && typeof payload.slainModelIds[0] === 'string'
      ? payload.slainModelIds[0] : undefined
  const correctionOptions = pending.coherencyCorrection ? aosCoherencyCorrectionOptions(state, target.id) : []
  if (pending.coherencyCorrection) {
    if (!modelId || !correctionOptions.some((option) => option.includes(modelId))) return state
    return removeAosCombatModel(state, data, combat, fight, pending, target, modelId, true)
  }
  const existing = combat.allocatedDamageByUnitId[target.id] ?? 0
  const total = existing + pending.remaining
  if (total < targetProfile.health) {
    const nextCombat: AosCombatState = {
      ...combat,
      allocatedDamageByUnitId: { ...combat.allocatedDamageByUnitId, [target.id]: total },
      activeAttackFacts: [...(combat.activeAttackFacts ?? []), completedAttackFact({ ...pending, remaining: 0 })],
      activeFight: { ...fight, stage: 'ATTACKS', pendingDamage: undefined, resolvedProfileIds: [...fight.resolvedProfileIds, pending.profileId] },
    }
    return maybeFinishFight(state, data, nextCombat)
  }
  if (!modelId || !aosDamageAllocationOptions(state, target.id).some((option) => option[0] === modelId)) return state
  return removeAosCombatModel(state, data, combat, fight, pending, target, modelId, false, Math.max(0, total - targetProfile.health))
}

function removeAosCombatModel(
  state: GameState, data: AosMatchStateData, combat: AosCombatState, fight: AosActiveFight,
  pending: AosPendingDamage, target: Unit, modelId: string, coherencyOnly: boolean, remaining = pending.remaining,
): GameState {
  const updatedModels = state.models.map((model) => model.id === modelId ? { ...model, presence: 'DESTROYED' as const } : model)
  const updatedState = { ...state, models: updatedModels }
  const targetDestroyed = !updatedModels.some((model) => model.unitId === target.id && (model.presence ?? 'ON_BATTLEFIELD') === 'ON_BATTLEFIELD')
  const allocatedDamageByUnitId = { ...combat.allocatedDamageByUnitId, [target.id]: 0 }
  if (targetDestroyed) delete allocatedDamageByUnitId[target.id]
  const additional = targetDestroyed ? [] : aosCoherencyCorrectionOptions(updatedState, target.id)
  const updatedPending: AosPendingDamage = {
    ...pending, remaining: targetDestroyed ? 0 : remaining,
    slainModelIds: [...pending.slainModelIds, modelId],
    ...(coherencyOnly ? { coherencySlainModelIds: [...(pending.coherencySlainModelIds ?? []), modelId] } : {}),
    coherencyCorrection: additional.length ? { minimumAdditionalRemovals: additional[0].length } : undefined,
  }
  const destroyedUnitFacts = targetDestroyed && !combat.destroyedUnitFacts.some((fact) => fact.unitId === target.id)
    ? [...combat.destroyedUnitFacts, { sequence: state.nextActionSequence, type: 'UNIT_DESTROYED' as const,
      turnId: state.gameContext.turnId, playerId: target.ownerId, unitId: target.id, sourceUnitId: fight.unitId }]
    : combat.destroyedUnitFacts
  const nextCombat: AosCombatState = {
    ...combat, allocatedDamageByUnitId, destroyedUnitFacts,
    activeFight: updatedPending.remaining > 0 || updatedPending.coherencyCorrection
      ? { ...fight, pendingDamage: updatedPending }
      : { ...fight, stage: 'ATTACKS', pendingDamage: undefined, resolvedProfileIds: [...fight.resolvedProfileIds, pending.profileId] },
    activeAttackFacts: updatedPending.remaining > 0 || updatedPending.coherencyCorrection
      ? combat.activeAttackFacts
      : [...(combat.activeAttackFacts ?? []), completedAttackFact(updatedPending)],
  }
  return updatedPending.remaining > 0 || updatedPending.coherencyCorrection
    ? replaceCombat(updatedState, data, nextCombat, true) : maybeFinishFight(updatedState, data, nextCombat)
}

function maybeFinishFight(state: GameState, data: AosMatchStateData, combat: AosCombatState): GameState {
  const fight = combat.activeFight
  if (!fight || fight.stage !== 'ATTACKS') return replaceCombat(state, data, combat, true)
  const remainingProfiles = fight.declaredAttacks
    ? fight.declaredAttacks.filter((entry) => !fight.resolvedProfileIds.includes(entry.profileId)
      && activeUnitModels(state, entry.targetUnitId).length > 0)
    : aosAttackProfileOptions(state, fight.unitId)
      .filter((option) => option.maximumAttacks > 0 && !option.unsupportedReason)
  if (remainingProfiles.length > 0) return replaceCombat(state, data, combat, true)
  const sequence = state.nextActionSequence
  const fact: AosFightFact = { sequence, type: 'UNIT_FOUGHT', turnId: state.gameContext.turnId,
    playerId: fight.playerId, unitId: fight.unitId, attackResolutions: combat.activeAttackFacts ?? [] }
  const otherPlayerId = state.players.find((player) => player.id !== fight.playerId)?.id
  const nextCombat: AosCombatState = {
    ...combat,
    foughtUnitIds: [...combat.foughtUnitIds, fight.unitId],
    opportunityPlayerId: otherPlayerId,
    activeFight: undefined,
    activeAttackFacts: undefined,
    fightFacts: [...combat.fightFacts, fact],
  }
  const after = replaceCombat(state, data, nextCombat, true)
  return commitOperation(state, { ...after, nextActionSequence: sequence + 1 }, createCommittedOperation({
    sequence, type: 'GAME_SYSTEM', actorPlayerId: fight.playerId, state,
    entityIds: [fight.unitId, ...fact.attackResolutions.flatMap((entry) => [entry.targetUnitId, ...entry.slainModelIds])],
  }))
}

function eligibleFightUnitsForPlayer(state: GameState, playerId: string, combat: AosCombatState): Unit[] {
  const data = aosData(state)
  if (!data) return []
  return state.units.filter((unit) => unit.ownerId === playerId && activeUnitModels(state, unit.id).length
    && !combat.foughtUnitIds.includes(unit.id)
    && (unitIsInCombat(state, unit) || ensureAosMovementState(data).facts.some((fact) => fact.unitId === unit.id
      && fact.turnId === state.gameContext.turnId && fact.actionId === 'CHARGE'))
    && Boolean(aosUnitProfile(state, unit)?.weapons.some((weapon) => weapon.type === 'melee' && !weaponUnsupportedReason(weapon))))
}

function replaceCombat(state: GameState, data: AosMatchStateData, combat: AosCombatState, lockUndo: boolean): GameState {
  return {
    ...state,
    gameSystemState: { ...state.gameSystemState!, data: { ...data, combat } as unknown as JsonValue },
    ...(lockUndo ? { lastCommittedOperationUndo: null, lastConfirmedMovementUndo: null } : {}),
  }
}

function completedAttackFact(pending: AosPendingDamage): AosAttackResolutionFact {
  return {
    attackerUnitId: pending.attackerUnitId,
    targetUnitId: pending.targetUnitId,
    profileId: pending.profileId,
    sequenceRecordId: pending.sequenceRecordId,
    ...(pending.wardRecordId ? { wardRecordId: pending.wardRecordId } : {}),
    ...(pending.randomDamageRecordId ? { randomDamageRecordId: pending.randomDamageRecordId } : {}),
    attacks: pending.attacks,
    hits: pending.hits,
    criticalMortalHits: pending.criticalMortalHits,
    wounds: pending.wounds,
    saved: pending.saved,
    unsaved: pending.unsaved,
    grossDamage: pending.grossDamage,
    wardPrevented: pending.wardPrevented,
    slainModelIds: [...pending.slainModelIds],
    coherencySlainModelIds: [...(pending.coherencySlainModelIds ?? [])],
  }
}

function activeUnitModels(state: GameState, unitId: string): TabletopModel[] {
  return activeBattlefieldModels(state).filter((model) => model.unitId === unitId)
}

function modelArmedWith(model: TabletopModel, weapon: AosWeaponProfile): boolean {
  if (!weapon.modelIndices?.length) return true
  const ordinal = Number(model.id.match(/-(\d+)$/)?.[1])
  return weapon.modelIndices.includes(ordinal)
}

function fixedCharacteristic(value: string): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function weaponUnsupportedReason(weapon: AosWeaponProfile): string | undefined {
  if (fixedCharacteristic(weapon.attacks) === null) return `Random Attacks ${weapon.attacks} are not in the M9.6.1 melee subset.`
  return undefined
}

function diceSequenceRecord(state: GameState, id: string): DiceSequenceRecord | undefined {
  return state.diceHistory?.find((entry): entry is DiceSequenceRecord => entry.type === 'DICE_SEQUENCE' && entry.id === id)
}

function diceRollRecord(state: GameState, id?: string): DiceRollRecord | undefined {
  return state.diceHistory?.find((entry): entry is DiceRollRecord => entry.type === 'DICE_ROLL' && entry.id === id)
}

function sameSequenceDefinition(left: DiceSequenceDefinition, right: DiceSequenceDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function combinations<T>(values: readonly T[], count: number): T[][] {
  const result: T[][] = []
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === count) { result.push([...chosen]); return }
    for (let index = start; index <= values.length - (count - chosen.length); index += 1) {
      chosen.push(values[index]); visit(index + 1, chosen); chosen.pop()
    }
  }
  visit(0, [])
  return result
}

function playerName(state: GameState, id?: string): string {
  return state.players.find((player) => player.id === id)?.displayName ?? id ?? 'No player'
}

function aosData(state: GameState): AosMatchStateData | null {
  const value = state.gameSystemState?.data
  const candidate = record(value)
  return candidate?.status === 'battle' ? candidate as unknown as AosMatchStateData : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}
