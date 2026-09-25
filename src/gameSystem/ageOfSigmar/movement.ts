import type {
  DiceRollRecord,
  GameState,
  JsonValue,
  ResolvedMovementActionContext,
  TabletopModel,
  Unit,
} from '../../domain/types'
import { distanceBetweenBases } from '../../engine/spatial'
import { rollDice, systemRandomSource, type RandomSource } from '../../engine/dice'
import { activeBattlefieldModels } from '../../game/modelPresence'
import { getMovementAllowance, getUnitDefinition } from '../../game/selectors'
import type { MovementActionCommitRequest, MovementActionContextResolution } from '../types'
import { currentAosPhase } from './battleRound'
import type { AosMatchStateData } from './deployment'

export type AosMovementActionId = 'NORMAL_MOVE' | 'RUN' | 'RETREAT'

export interface AosMovementDeclaration {
  actionId: AosMovementActionId
  unitId: string
  playerId: string
  turnId: string
  phase: 'MOVEMENT_PHASE'
  rollRecordId?: string
  rollResult?: number
}

export interface AosMovementFact extends AosMovementDeclaration {
  sequence: number
  movementActionId: string
  retreatMortalDamage?: number
}

export interface AosMovementState {
  selectedByUnitId: Record<string, AosMovementDeclaration>
  revealedByKey: Record<string, { rollRecordId: string; result: number }>
  facts: AosMovementFact[]
}

export interface AosMovementAvailability {
  available: AosMovementActionId[]
  inCombat: boolean
  reason?: string
  selected?: AosMovementDeclaration
}

export interface AosUnitMovementStatus {
  unitId: string
  kind: 'READY' | 'NORMAL_MOVE' | 'RUN' | 'RETREAT'
  label: string
  baseMove: number
  rollResult?: number
  allowance: number
}

const COMBAT_RANGE = 3

export function initialAosMovementState(): AosMovementState {
  return { selectedByUnitId: {}, revealedByKey: {}, facts: [] }
}

export function ensureAosMovementState(data: AosMatchStateData): AosMovementState {
  return data.movement ?? initialAosMovementState()
}

export function isAosMovementState(value: unknown): value is AosMovementState {
  if (!isRecord(value) || !isRecord(value.selectedByUnitId)
    || !isRecord(value.revealedByKey) || !Array.isArray(value.facts)) return false
  return Object.values(value.selectedByUnitId).every(isDeclaration)
    && Object.values(value.revealedByKey).every((entry) => isRecord(entry)
      && typeof entry.rollRecordId === 'string' && validRoll(entry.result, 6))
    && value.facts.every((fact) => isRecord(fact) && isDeclaration(fact)
      && Number.isInteger(fact.sequence) && typeof fact.movementActionId === 'string')
}

export function aosMovementAvailability(state: GameState, unitId: string): AosMovementAvailability {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const data = aosData(state)
  const movement = data ? ensureAosMovementState(data) : initialAosMovementState()
  const selected = movement.selectedByUnitId[unitId]
  if (!unit) return { available: [], inCombat: false, reason: 'Unit data is incomplete.', selected }
  if (!data?.battle || data.status !== 'battle' || data.battle.stage !== 'TURN_PHASE'
    || currentAosPhase(data.battle)?.id !== 'MOVEMENT_PHASE') {
    return { available: [], inCombat: unitIsInCombat(state, unit), reason: 'Movement abilities are only available in your Movement Phase.', selected }
  }
  if (unit.ownerId !== state.gameContext.activePlayerId) {
    return { available: [], inCombat: unitIsInCombat(state, unit), reason: 'Only the active player can move a unit.', selected }
  }
  if (movement.facts.some((fact) => fact.unitId === unit.id
    && fact.turnId === state.gameContext.turnId && fact.phase === 'MOVEMENT_PHASE')) {
    return { available: [], inCombat: unitIsInCombat(state, unit), reason: 'Unit already used a Core movement ability this phase.', selected }
  }
  const inCombat = unitIsInCombat(state, unit)
  return { available: inCombat ? ['RETREAT'] : ['NORMAL_MOVE', 'RUN'], inCombat, selected }
}

export function aosMovementRevealedRoll(
  state: GameState,
  unitId: string,
  actionId: AosMovementActionId,
): { rollRecordId: string; result: number } | undefined {
  const data = aosData(state)
  return data ? ensureAosMovementState(data).revealedByKey[
    revealedKey(unitId, state.gameContext.turnId, actionId)
  ] : undefined
}

/** One production/test seam for AoS movement dice; retained rolls are handled by declaration state. */
export function rollAosMovementActionDie(
  actionId: Extract<AosMovementActionId, 'RUN' | 'RETREAT'>,
  random: RandomSource = systemRandomSource,
) {
  return rollDice({ count: 1, sides: actionId === 'RUN' ? 6 : 3 }, random)
}

/** Unit-level status used by both the movement panel and battlefield presentation. */
export function aosUnitMovementStatus(state: GameState, unitId: string): AosUnitMovementStatus | null {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const data = aosData(state)
  if (!unit || !data?.battle || data.status !== 'battle' || data.battle.stage !== 'TURN_PHASE'
    || currentAosPhase(data.battle)?.id !== 'MOVEMENT_PHASE'
    || unit.ownerId !== state.gameContext.activePlayerId) return null
  const models = activeBattlefieldModels(state).filter((model) => model.unitId === unitId)
  if (models.length === 0) return null
  const baseMove = Math.min(...models.map((model) => getMovementAllowance(state, model)))
  const fact = [...ensureAosMovementState(data).facts].reverse().find((candidate) =>
    candidate.unitId === unitId && candidate.turnId === state.gameContext.turnId)
  if (!fact) return { unitId, kind: 'READY', label: 'READY TO MOVE', baseMove, allowance: baseMove }
  const allowance = baseMove + (fact.actionId === 'RUN' ? fact.rollResult ?? 0 : 0)
  return {
    unitId,
    kind: fact.actionId,
    label: fact.actionId === 'NORMAL_MOVE' ? 'MOVED — NORMAL'
      : fact.actionId === 'RUN' ? 'MOVED — RUN' : 'MOVED — RETREAT',
    baseMove,
    ...(fact.rollResult !== undefined ? { rollResult: fact.rollResult } : {}),
    allowance,
  }
}

export function declareAosMovementAction(
  state: GameState,
  data: AosMatchStateData,
  unitId: string,
  actionId: AosMovementActionId,
  rollRecordId?: string,
): GameState {
  const availability = aosMovementAvailability(state, unitId)
  if (!availability.available.includes(actionId)) return state
  const unit = state.units.find((candidate) => candidate.id === unitId)!
  const movement = ensureAosMovementState(data)
  const key = revealedKey(unitId, state.gameContext.turnId, actionId)
  let revealed = movement.revealedByKey[key]
  const expectedSides = actionId === 'RUN' ? 6 : actionId === 'RETREAT' ? 3 : undefined
  if (expectedSides && !revealed) {
    const record = diceRecord(state, rollRecordId)
    if (!record || record.playerId !== unit.ownerId || record.sides !== expectedSides
      || record.count !== 1 || record.turnId !== state.gameContext.turnId) return state
    revealed = { rollRecordId: record.id, result: record.finalResults[0] }
  }
  const declaration: AosMovementDeclaration = {
    actionId,
    unitId,
    playerId: unit.ownerId,
    turnId: state.gameContext.turnId,
    phase: 'MOVEMENT_PHASE',
    ...(revealed ? { rollRecordId: revealed.rollRecordId, rollResult: revealed.result } : {}),
  }
  const nextMovement: AosMovementState = {
    ...movement,
    selectedByUnitId: { ...movement.selectedByUnitId, [unitId]: declaration },
    revealedByKey: revealed ? { ...movement.revealedByKey, [key]: revealed } : movement.revealedByKey,
  }
  return replaceMovementState(state, data, nextMovement, Boolean(expectedSides && !movement.revealedByKey[key]))
}

export function resolveAosMovementContext(state: GameState, unitId: string): MovementActionContextResolution {
  const data = aosData(state)
  const availability = aosMovementAvailability(state, unitId)
  if (!data) return { allowed: false, reason: 'Age of Sigmar movement state is unavailable.' }
  const declaration = ensureAosMovementState(data).selectedByUnitId[unitId]
  if (!declaration || declaration.turnId !== state.gameContext.turnId) {
    return { allowed: false, reason: availability.reason ?? 'Choose Normal Move, Run, or Retreat first.' }
  }
  if (!availability.available.includes(declaration.actionId)) {
    return { allowed: false, reason: availability.reason ?? 'That movement ability is no longer legal.' }
  }
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (!unit) return { allowed: false, reason: 'Movement unit data is incomplete.' }
  const models = activeBattlefieldModels(state).filter((model) => model.unitId === unit.id)
  if (models.length === 0) return { allowed: false, reason: 'This unit has no models on the battlefield.' }
  const base = Math.min(...models.map((model) => getMovementAllowance(state, model)))
  const allowance = base + (declaration.actionId === 'RUN' ? declaration.rollResult ?? 0 : 0)
  const flying = unitHasFly(state, unit, models)
  const enemies = activeBattlefieldModels(state).filter((model) => model.ownerId !== unit.ownerId)
  const separationConstraints = models.flatMap((model) => enemies.map((enemy) => ({
    movingModelId: model.id,
    obstacleModelId: enemy.id,
    minimumDistance: COMBAT_RANGE,
    duringMovement: declaration.actionId !== 'RETREAT' && !flying,
    atDestination: true,
  })))
  const context: ResolvedMovementActionContext = {
    id: `${declaration.turnId}:${unit.id}:${declaration.actionId}`,
    label: actionLabel(declaration.actionId),
    unitId: unit.id,
    actorPlayerId: unit.ownerId,
    movementAllowanceByModel: Object.fromEntries(models.map((model) => [model.id, allowance])),
    passOverModelIds: flying ? models.map((model) => model.id) : [],
    separationConstraints,
    requireCoherency: true,
    details: {
      actionId: declaration.actionId,
      moveCharacteristic: base,
      ...(declaration.rollResult !== undefined ? { rollResult: declaration.rollResult } : {}),
      flying,
    },
  }
  return { allowed: true, context }
}

/** Presentation-only extraction of the active Normal/Run combat-range aid. */
export function aosMovementRuleAssistance(
  context: ResolvedMovementActionContext | undefined,
): ResolvedMovementActionContext['separationConstraints'] {
  if (!context?.details || typeof context.details !== 'object' || Array.isArray(context.details)) return []
  const actionId = (context.details as Record<string, unknown>).actionId
  if (actionId !== 'NORMAL_MOVE' && actionId !== 'RUN') return []
  return context.separationConstraints.filter((constraint) => constraint.atDestination)
}

export function commitAosMovementAction(request: MovementActionCommitRequest): GameState {
  const data = aosData(request.after)
  const beforeData = aosData(request.before)
  if (!data || !beforeData) return request.after
  const movement = ensureAosMovementState(data)
  const declaration = movement.selectedByUnitId[request.context.unitId]
  const moveAction = request.after.actionHistory.at(-1)
  if (!declaration || !moveAction || moveAction.type !== 'MOVE'
    || !moveAction.payload.unitIds.includes(request.context.unitId)) return request.after
  const selectedByUnitId = { ...movement.selectedByUnitId }
  delete selectedByUnitId[request.context.unitId]
  const fact: AosMovementFact = {
    ...declaration,
    sequence: moveAction.sequence,
    movementActionId: moveAction.id,
    ...(declaration.actionId === 'RETREAT' ? { retreatMortalDamage: declaration.rollResult ?? 0 } : {}),
  }
  return replaceMovementState(request.after, data, {
    ...movement,
    selectedByUnitId,
    facts: [...movement.facts, fact],
  }, false)
}

export function unitIsInCombat(state: GameState, unit: Unit): boolean {
  const models = activeBattlefieldModels(state)
  const friendly = models.filter((model) => model.unitId === unit.id)
  const enemies = models.filter((model) => model.ownerId !== unit.ownerId)
  return friendly.some((model) => enemies.some((enemy) =>
    distanceBetweenBases(model, enemy) <= COMBAT_RANGE + 1e-9 && modelsVisible()))
}

function modelsVisible(): boolean {
  // The controlled M9.5 board has no authored 3D occlusion facts. Keeping this
  // seam explicit lets the future AoS visibility adapter replace the current
  // conservative all-visible interpretation without changing combat distance.
  return true
}

function unitHasFly(state: GameState, unit: Unit, models: readonly TabletopModel[]): boolean {
  const definition = getUnitDefinition(state, unit)
  return Boolean(definition?.keywords?.includes('FLY') || models.every((model) => model.keywords?.includes('FLY')))
}

function actionLabel(actionId: AosMovementActionId): string {
  if (actionId === 'NORMAL_MOVE') return 'Normal Move'
  if (actionId === 'RUN') return 'Run'
  return 'Retreat'
}

function revealedKey(unitId: string, turnId: string, actionId: AosMovementActionId): string {
  return `${turnId}:${unitId}:${actionId}`
}

function diceRecord(state: GameState, id?: string): DiceRollRecord | undefined {
  const record = state.diceHistory?.find((entry): entry is DiceRollRecord => entry.type === 'DICE_ROLL' && entry.id === id)
  return record
}

function replaceMovementState(
  state: GameState,
  data: AosMatchStateData,
  movement: AosMovementState,
  lockUndo: boolean,
): GameState {
  return {
    ...state,
    gameSystemState: {
      ...state.gameSystemState!,
      data: { ...data, movement } as unknown as JsonValue,
    },
    ...(lockUndo ? { lastCommittedOperationUndo: null, lastConfirmedMovementUndo: null } : {}),
  }
}

function aosData(state: GameState): AosMatchStateData | null {
  const value = state.gameSystemState?.data
  return isRecord(value) && (value.status === 'battle' || value.status === 'deployment' || value.status === 'setup')
    ? value as unknown as AosMatchStateData : null
}

function isDeclaration(value: unknown): value is AosMovementDeclaration {
  if (!isRecord(value)) return false
  return ['NORMAL_MOVE', 'RUN', 'RETREAT'].includes(String(value.actionId))
    && typeof value.unitId === 'string' && typeof value.playerId === 'string'
    && typeof value.turnId === 'string' && value.phase === 'MOVEMENT_PHASE'
    && (value.rollResult === undefined || validRoll(value.rollResult, 6))
}

function validRoll(value: unknown, sides: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= sides
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
