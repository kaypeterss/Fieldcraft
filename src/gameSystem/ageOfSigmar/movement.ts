import type { DiceRollRecord, GameState, JsonValue, MovementDestinationConstraint, ResolvedMovementActionContext, TabletopModel, Unit } from '../../domain/types'
import { distanceBetweenBases } from '../../engine/spatial'
import { rollDice, systemRandomSource, type RandomSource } from '../../engine/dice'
import { activeBattlefieldModels } from '../../game/modelPresence'
import { getMovementAllowance, getUnitDefinition } from '../../game/selectors'
import type { MovementActionCommitRequest, MovementActionContextResolution } from '../types'
import { currentAosPhase, type AosPhaseId } from './battleRound'
import type { AosMatchStateData } from './deployment'

export type AosMovementActionId = 'NORMAL_MOVE' | 'RUN' | 'RETREAT' | 'CHARGE' | 'PILE_IN'
type MovementPhaseId = Extract<AosPhaseId, 'MOVEMENT_PHASE' | 'CHARGE_PHASE' | 'COMBAT_PHASE'>

export interface AosMovementDeclaration {
  actionId: AosMovementActionId; unitId: string; playerId: string; turnId: string; phase: MovementPhaseId
  rollRecordId?: string; rollResult?: number; rollResults?: number[]; targetUnitId?: string
}
export interface AosMovementFact extends AosMovementDeclaration { sequence: number; movementActionId: string; retreatMortalDamage?: number }
export interface AosMovementState {
  selectedByUnitId: Record<string, AosMovementDeclaration>
  revealedByKey: Record<string, { rollRecordId: string; result: number; results?: number[] }>
  facts: AosMovementFact[]
}
export interface AosMovementAvailability {
  available: AosMovementActionId[]; inCombat: boolean; eligibleTargetUnitIds?: string[]
  reason?: string; selected?: AosMovementDeclaration
}
export interface AosUnitMovementStatus {
  unitId: string; kind: 'READY' | AosMovementActionId; label: string; baseMove: number; rollResult?: number; allowance: number
}

export const AOS_COMBAT_RANGE = 3
export const AOS_CHARGE_FINISH_RANGE = 0.5
export const AOS_PILE_IN_DISTANCE = 3

export function initialAosMovementState(): AosMovementState { return { selectedByUnitId: {}, revealedByKey: {}, facts: [] } }
export function ensureAosMovementState(data: AosMatchStateData): AosMovementState { return data.movement ?? initialAosMovementState() }
export function isAosMovementState(value: unknown): value is AosMovementState {
  if (!isRecord(value) || !isRecord(value.selectedByUnitId) || !isRecord(value.revealedByKey) || !Array.isArray(value.facts)) return false
  return Object.values(value.selectedByUnitId).every(isDeclaration)
    && Object.values(value.revealedByKey).every((entry) => isRecord(entry) && typeof entry.rollRecordId === 'string' && validRoll(entry.result, 12)
      && (entry.results === undefined || (Array.isArray(entry.results) && entry.results.every((result) => validRoll(result, 6)))))
    && value.facts.every((fact) => isRecord(fact) && isDeclaration(fact) && Number.isInteger(fact.sequence) && typeof fact.movementActionId === 'string')
}

export function aosMovementAvailability(state: GameState, unitId: string): AosMovementAvailability {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const data = aosData(state)
  const movement = data ? ensureAosMovementState(data) : initialAosMovementState()
  const selected = movement.selectedByUnitId[unitId]
  const unavailable = (reason: string, inCombat = unit ? unitIsInCombat(state, unit) : false): AosMovementAvailability =>
    ({ available: [], inCombat, eligibleTargetUnitIds: [], reason, selected })
  if (!unit) return unavailable('Unit data is incomplete.')
  const phase = data?.battle && data.status === 'battle' && data.battle.stage === 'TURN_PHASE' ? currentAosPhase(data.battle)?.id : undefined
  if (phase !== 'MOVEMENT_PHASE' && phase !== 'CHARGE_PHASE' && phase !== 'COMBAT_PHASE') return unavailable('Movement actions are not available in this phase.')
  const inCombat = unitIsInCombat(state, unit)
  const eligibleTargetUnitIds = inCombat ? enemyUnitsInCombat(state, unit).map((target) => target.id) : []
  if (phase !== 'COMBAT_PHASE' && unit.ownerId !== state.gameContext.activePlayerId) return unavailable('Only the active player can use this movement ability.', inCombat)
  if (movement.facts.some((fact) => fact.unitId === unit.id && fact.turnId === state.gameContext.turnId && fact.phase === phase)) {
    return { available: [], inCombat, eligibleTargetUnitIds, reason: 'Unit already used this Core ability this phase.', selected }
  }
  // A legally declared action remains executable while its preview poses change
  // the very relationships that made the declaration legal.
  if (selected?.turnId === state.gameContext.turnId && selected.phase === phase) {
    return { available: [selected.actionId], inCombat, eligibleTargetUnitIds:
      selected.targetUnitId ? [...new Set([selected.targetUnitId, ...eligibleTargetUnitIds])] : eligibleTargetUnitIds, selected }
  }
  if (phase === 'MOVEMENT_PHASE') return { available: inCombat ? ['RETREAT'] : ['NORMAL_MOVE', 'RUN'], inCombat, eligibleTargetUnitIds, selected }
  if (phase === 'CHARGE_PHASE') {
    const ranOrRetreated = movement.facts.some((fact) => fact.unitId === unit.id && fact.turnId === state.gameContext.turnId && (fact.actionId === 'RUN' || fact.actionId === 'RETREAT'))
    if (inCombat) return { available: [], inCombat, eligibleTargetUnitIds, reason: 'A unit in combat cannot declare a Charge.', selected }
    if (ranOrRetreated) return { available: [], inCombat, eligibleTargetUnitIds, reason: 'A unit that Ran or Retreated this turn cannot declare a Charge.', selected }
    return { available: ['CHARGE'], inCombat, eligibleTargetUnitIds: visibleEnemyUnits(state, unit).map((target) => target.id), selected }
  }
  const charged = movement.facts.some((fact) => fact.unitId === unit.id && fact.turnId === state.gameContext.turnId && fact.actionId === 'CHARGE')
  return inCombat || charged
    ? { available: ['PILE_IN'], inCombat, eligibleTargetUnitIds, selected }
    : { available: [], inCombat, eligibleTargetUnitIds, reason: 'A unit must be in combat or have charged this turn to Fight.', selected }
}

export function aosMovementRevealedRoll(state: GameState, unitId: string, actionId: AosMovementActionId) {
  const data = aosData(state)
  return data ? ensureAosMovementState(data).revealedByKey[revealedKey(unitId, state.gameContext.turnId, actionId)] : undefined
}
export function rollAosMovementActionDie(actionId: Extract<AosMovementActionId, 'RUN' | 'RETREAT'>, random: RandomSource = systemRandomSource) {
  return rollDice({ count: 1, sides: actionId === 'RUN' ? 6 : 3 }, random)
}
export function rollAosCharge(random: RandomSource = systemRandomSource) { return rollDice({ count: 2, sides: 6 }, random) }

export function aosUnitMovementStatus(state: GameState, unitId: string): AosUnitMovementStatus | null {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const data = aosData(state)
  const phase = data?.battle && data.status === 'battle' ? currentAosPhase(data.battle)?.id : undefined
  if (!unit || !phase || !['MOVEMENT_PHASE', 'CHARGE_PHASE', 'COMBAT_PHASE'].includes(phase)) return null
  if (phase !== 'COMBAT_PHASE' && unit.ownerId !== state.gameContext.activePlayerId) return null
  const models = activeBattlefieldModels(state).filter((model) => model.unitId === unitId)
  if (!models.length) return null
  const baseMove = Math.min(...models.map((model) => getMovementAllowance(state, model)))
  const fact = [...ensureAosMovementState(data!).facts].reverse().find((candidate) => candidate.unitId === unitId && candidate.turnId === state.gameContext.turnId && candidate.phase === phase)
  if (!fact && aosMovementAvailability(state, unitId).available.length === 0) return null
  if (!fact) {
    const label = phase === 'CHARGE_PHASE' ? 'READY TO CHARGE' : phase === 'COMBAT_PHASE' ? 'READY TO FIGHT' : 'READY TO MOVE'
    return { unitId, kind: 'READY', label, baseMove, allowance: phase === 'COMBAT_PHASE' ? AOS_PILE_IN_DISTANCE : baseMove }
  }
  const allowance = fact.actionId === 'RUN' ? baseMove + (fact.rollResult ?? 0) : fact.actionId === 'CHARGE' ? fact.rollResult ?? 0 : fact.actionId === 'PILE_IN' ? AOS_PILE_IN_DISTANCE : baseMove
  return { unitId, kind: fact.actionId, label: statusLabel(fact.actionId), baseMove, ...(fact.rollResult !== undefined ? { rollResult: fact.rollResult } : {}), allowance }
}

export function declareAosMovementAction(state: GameState, data: AosMatchStateData, unitId: string, actionId: AosMovementActionId, rollRecordId?: string, targetUnitId?: string): GameState {
  const availability = aosMovementAvailability(state, unitId)
  if (!availability.available.includes(actionId)) return state
  const unit = state.units.find((candidate) => candidate.id === unitId)!
  if (actionId === 'PILE_IN' && availability.inCombat && (!targetUnitId || !(availability.eligibleTargetUnitIds ?? []).includes(targetUnitId))) return state
  const movement = ensureAosMovementState(data)
  const key = revealedKey(unitId, state.gameContext.turnId, actionId)
  let revealed = movement.revealedByKey[key]
  const expected = actionId === 'RUN' ? { sides: 6, count: 1 } : actionId === 'RETREAT' ? { sides: 3, count: 1 } : actionId === 'CHARGE' ? { sides: 6, count: 2 } : undefined
  if (expected && !revealed) {
    const record = diceRecord(state, rollRecordId)
    if (!record || record.playerId !== unit.ownerId || record.sides !== expected.sides || record.count !== expected.count || record.turnId !== state.gameContext.turnId) return state
    revealed = { rollRecordId: record.id, result: record.total, ...(actionId === 'CHARGE' ? { results: [...record.finalResults] } : {}) }
  }
  const phase = currentAosPhase(data.battle!)!.id as MovementPhaseId
  const declaration: AosMovementDeclaration = { actionId, unitId, playerId: unit.ownerId, turnId: state.gameContext.turnId, phase,
    ...(revealed ? { rollRecordId: revealed.rollRecordId, rollResult: revealed.result,
      ...(revealed.results ? { rollResults: [...revealed.results] } : {}) } : {}), ...(targetUnitId ? { targetUnitId } : {}) }
  return replaceMovementState(state, data, { ...movement, selectedByUnitId: { ...movement.selectedByUnitId, [unitId]: declaration },
    revealedByKey: revealed ? { ...movement.revealedByKey, [key]: revealed } : movement.revealedByKey }, Boolean(expected && !movement.revealedByKey[key]))
}

export function resolveAosMovementContext(state: GameState, unitId: string): MovementActionContextResolution {
  const data = aosData(state)
  const availability = aosMovementAvailability(state, unitId)
  if (!data) return { allowed: false, reason: 'Age of Sigmar movement state is unavailable.' }
  const declaration = ensureAosMovementState(data).selectedByUnitId[unitId]
  if (!declaration || declaration.turnId !== state.gameContext.turnId) return { allowed: false, reason: availability.reason ?? 'Choose a movement action first.' }
  if (!availability.available.includes(declaration.actionId)) return { allowed: false, reason: availability.reason ?? 'That movement ability is no longer legal.' }
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (!unit) return { allowed: false, reason: 'Movement unit data is incomplete.' }
  const models = activeBattlefieldModels(state).filter((model) => model.unitId === unit.id)
  if (!models.length) return { allowed: false, reason: 'This unit has no models on the battlefield.' }
  const base = Math.min(...models.map((model) => getMovementAllowance(state, model)))
  const allowance = declaration.actionId === 'RUN' ? base + (declaration.rollResult ?? 0) : declaration.actionId === 'CHARGE' ? declaration.rollResult ?? 0 : declaration.actionId === 'PILE_IN' ? AOS_PILE_IN_DISTANCE : base
  const flying = unitHasFly(state, unit, models)
  const enemies = activeBattlefieldModels(state).filter((model) => model.ownerId !== unit.ownerId)
  const separationConstraints = ['NORMAL_MOVE', 'RUN', 'RETREAT'].includes(declaration.actionId)
    ? models.flatMap((model) => enemies.map((enemy) => ({ movingModelId: model.id, obstacleModelId: enemy.id, minimumDistance: AOS_COMBAT_RANGE,
      duringMovement: declaration.actionId !== 'RETREAT' && !flying, atDestination: true }))) : []
  const context: ResolvedMovementActionContext = {
    id: `${declaration.turnId}:${declaration.phase}:${unit.id}:${declaration.actionId}`, label: actionLabel(declaration.actionId), unitId: unit.id, actorPlayerId: unit.ownerId,
    movementAllowanceByModel: Object.fromEntries(models.map((model) => [model.id, allowance])), passOverModelIds: flying ? models.map((model) => model.id) : [],
    separationConstraints, destinationConstraints: movementDestinationConstraints(state, unit, models, declaration), requireCoherency: true,
    details: { actionId: declaration.actionId, phase: declaration.phase, moveCharacteristic: base, ...(declaration.rollResult !== undefined ? { rollResult: declaration.rollResult } : {}),
      ...(declaration.targetUnitId ? { targetUnitId: declaration.targetUnitId } : {}), flying },
  }
  return { allowed: true, context }
}

export function aosMovementRuleAssistance(context: ResolvedMovementActionContext | undefined) {
  if (!context?.details || typeof context.details !== 'object' || Array.isArray(context.details)) return []
  const actionId = (context.details as Record<string, unknown>).actionId
  return actionId === 'NORMAL_MOVE' || actionId === 'RUN' ? context.separationConstraints.filter((constraint) => constraint.atDestination) : []
}

/** Presentation reads the exact authoritative destination facts; legality never depends on rendering. */
export function aosDestinationRuleAssistance(context: ResolvedMovementActionContext | undefined) {
  if (!context?.details || typeof context.details !== 'object' || Array.isArray(context.details)) return []
  const actionId = (context.details as Record<string, unknown>).actionId
  return actionId === 'CHARGE' || actionId === 'PILE_IN' ? context.destinationConstraints : []
}

export function commitAosMovementAction(request: MovementActionCommitRequest): GameState {
  const data = aosData(request.after); const beforeData = aosData(request.before)
  if (!data || !beforeData) return request.after
  const movement = ensureAosMovementState(data); const declaration = movement.selectedByUnitId[request.context.unitId]; const moveAction = request.after.actionHistory.at(-1)
  if (!declaration || !moveAction || moveAction.type !== 'MOVE' || !moveAction.payload.unitIds.includes(request.context.unitId)) return request.after
  const selectedByUnitId = { ...movement.selectedByUnitId }; delete selectedByUnitId[request.context.unitId]
  const fact: AosMovementFact = { ...declaration, sequence: moveAction.sequence, movementActionId: moveAction.id,
    ...(declaration.actionId === 'RETREAT' ? { retreatMortalDamage: declaration.rollResult ?? 0 } : {}) }
  return replaceMovementState(request.after, data, { ...movement, selectedByUnitId, facts: [...movement.facts, fact] }, false)
}

export function unitIsInCombat(state: GameState, unit: Unit): boolean { return enemyUnitsInCombat(state, unit).length > 0 }
export function enemyUnitsInCombat(state: GameState, unit: Unit): Unit[] {
  const models = activeBattlefieldModels(state); const friendly = models.filter((model) => model.unitId === unit.id)
  const ids = new Set(models.filter((enemy) => enemy.ownerId !== unit.ownerId && friendly.some((model) => distanceBetweenBases(model, enemy) <= AOS_COMBAT_RANGE + 1e-9)).map((model) => model.unitId))
  return state.units.filter((candidate) => ids.has(candidate.id))
}
function visibleEnemyUnits(state: GameState, unit: Unit): Unit[] {
  const ids = new Set(activeBattlefieldModels(state).filter((model) => model.ownerId !== unit.ownerId).map((model) => model.unitId))
  return state.units.filter((candidate) => ids.has(candidate.id))
}

function movementDestinationConstraints(state: GameState, unit: Unit, models: readonly TabletopModel[], declaration: AosMovementDeclaration): MovementDestinationConstraint[] {
  const battlefieldModels = activeBattlefieldModels(state)
  if (declaration.actionId === 'CHARGE') return [{ id: `${declaration.unitId}:charge-finish`, type: 'ANY_SOURCE_WITHIN_TARGETS', sourceModelIds: models.map((model) => model.id),
    targetModelIds: battlefieldModels.filter((model) => model.ownerId !== unit.ownerId).map((model) => model.id), maximumDistance: AOS_CHARGE_FINISH_RANGE }]
  if (declaration.actionId !== 'PILE_IN' || !declaration.targetUnitId) return []
  const targetIds = battlefieldModels.filter((model) => model.unitId === declaration.targetUnitId).map((model) => model.id)
  const engaged = enemyUnitsInCombat(state, unit)
  return [
    { id: `${declaration.unitId}:pile-in-closer`, type: 'EACH_SOURCE_NO_FARTHER_FROM_TARGETS', sourceModelIds: models.map((model) => model.id), targetModelIds: targetIds,
      maximumDistanceBySourceModelId: Object.fromEntries(models.map((model) => [model.id, Math.min(...targetIds.map((id) => distanceBetweenBases(model, battlefieldModels.find((candidate) => candidate.id === id)!)))])) },
    { id: `${declaration.unitId}:pile-in-remain-engaged`, type: 'ANY_SOURCE_WITHIN_EACH_TARGET_GROUP', sourceModelIds: models.map((model) => model.id), maximumDistance: AOS_COMBAT_RANGE,
      targetGroups: engaged.map((enemy) => ({ id: enemy.id, modelIds: battlefieldModels.filter((model) => model.unitId === enemy.id).map((model) => model.id) })) },
  ]
}

function unitHasFly(state: GameState, unit: Unit, models: readonly TabletopModel[]): boolean {
  const definition = getUnitDefinition(state, unit)
  return Boolean(definition?.keywords?.includes('FLY') || models.every((model) => model.keywords?.includes('FLY')))
}
function actionLabel(actionId: AosMovementActionId): string { return ({ NORMAL_MOVE: 'Normal Move', RUN: 'Run', RETREAT: 'Retreat', CHARGE: 'Charge', PILE_IN: 'Pile-in' } as const)[actionId] }
function statusLabel(actionId: AosMovementActionId): string { return actionId === 'PILE_IN' ? 'PILE-IN COMPLETE — READY TO FIGHT' : actionId === 'CHARGE' ? 'CHARGED THIS TURN' : actionId === 'NORMAL_MOVE' ? 'MOVED — NORMAL' : actionId === 'RUN' ? 'MOVED — RUN' : 'MOVED — RETREAT' }
function revealedKey(unitId: string, turnId: string, actionId: AosMovementActionId): string { return `${turnId}:${unitId}:${actionId}` }
function diceRecord(state: GameState, id?: string): DiceRollRecord | undefined { return state.diceHistory?.find((entry): entry is DiceRollRecord => entry.type === 'DICE_ROLL' && entry.id === id) }
function replaceMovementState(state: GameState, data: AosMatchStateData, movement: AosMovementState, lockUndo: boolean): GameState {
  return { ...state, gameSystemState: { ...state.gameSystemState!, data: { ...data, movement } as unknown as JsonValue }, ...(lockUndo ? { lastCommittedOperationUndo: null, lastConfirmedMovementUndo: null } : {}) }
}
function aosData(state: GameState): AosMatchStateData | null {
  const value = state.gameSystemState?.data
  return isRecord(value) && (value.status === 'battle' || value.status === 'deployment' || value.status === 'setup') ? value as unknown as AosMatchStateData : null
}
function isDeclaration(value: unknown): value is AosMovementDeclaration {
  return isRecord(value) && ['NORMAL_MOVE', 'RUN', 'RETREAT', 'CHARGE', 'PILE_IN'].includes(String(value.actionId)) && typeof value.unitId === 'string'
    && typeof value.playerId === 'string' && typeof value.turnId === 'string' && ['MOVEMENT_PHASE', 'CHARGE_PHASE', 'COMBAT_PHASE'].includes(String(value.phase))
    && (value.rollResult === undefined || validRoll(value.rollResult, 12))
    && (value.rollResults === undefined || (Array.isArray(value.rollResults) && value.rollResults.every((result) => validRoll(result, 6))))
    && (value.targetUnitId === undefined || typeof value.targetUnitId === 'string')
}
function validRoll(value: unknown, sides: number): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= sides }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
