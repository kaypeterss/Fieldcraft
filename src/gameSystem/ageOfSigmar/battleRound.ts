import type { GameState, JsonValue } from '../../domain/types'
import { scoreTotals } from '../../game/scoring'
import type { GameSystemCommand } from '../types'
import type { AosMatchStateData } from './deployment'

export type AosPhaseId =
  | 'START_OF_TURN'
  | 'HERO_PHASE'
  | 'MOVEMENT_PHASE'
  | 'SHOOTING_PHASE'
  | 'CHARGE_PHASE'
  | 'COMBAT_PHASE'
  | 'END_OF_TURN'

export interface AosPhaseDefinition {
  id: AosPhaseId
  name: string
  /** Future ability support uses this order; M9.4 has no supported phase actions. */
  abilityWindowOrder: readonly ['ACTIVE_PLAYER', 'OPPONENT']
}

export const AOS_TURN_PHASES: readonly AosPhaseDefinition[] = [
  { id: 'START_OF_TURN', name: 'Start of Turn', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
  { id: 'HERO_PHASE', name: 'Hero Phase', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
  { id: 'MOVEMENT_PHASE', name: 'Movement Phase', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
  { id: 'SHOOTING_PHASE', name: 'Shooting Phase', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
  { id: 'CHARGE_PHASE', name: 'Charge Phase', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
  { id: 'COMBAT_PHASE', name: 'Combat Phase', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
  { id: 'END_OF_TURN', name: 'End of Turn', abilityWindowOrder: ['ACTIVE_PLAYER', 'OPPONENT'] },
]

export type AosBattleStage =
  | 'FIRST_PLAYER_CHOICE'
  | 'PRIORITY_ROLL'
  | 'PRIORITY_CHOICE'
  | 'START_OF_ROUND'
  | 'TURN_PHASE'
  | 'END_OF_ROUND'
  | 'BATTLE_COMPLETE'

export interface AosPriorityRoll {
  round: number
  resultsByPlayerId: Record<string, number>
  tied: boolean
  chooserPlayerId: string
}

export interface AosCompletedRound {
  round: number
  firstPlayerId: string
  secondPlayerId: string
  underdogPlayerId?: string
  doubleTurnTakenByPlayerId?: string
  priority?: AosPriorityRoll
}

export interface AosDoubleTurnFact {
  round: number
  playerId: string
}

export interface AosBattleState {
  stage: AosBattleStage
  round: number
  roundLimit: number
  chooserPlayerId?: string
  firstPlayerId?: string
  secondPlayerId?: string
  underdogPlayerId?: string
  turnIndex?: 0 | 1
  phaseIndex?: number
  priority?: AosPriorityRoll
  completedRounds: AosCompletedRound[]
  doubleTurns: AosDoubleTurnFact[]
}

export function aosBattleState(state: GameState): AosBattleState | null {
  const data = state.gameSystemState?.data
  if (!isRecord(data) || data.status !== 'battle' || !isAosBattleState(data.battle)) return null
  return data.battle
}

export function currentAosPhase(battle: AosBattleState): AosPhaseDefinition | null {
  return battle.stage === 'TURN_PHASE' && battle.phaseIndex !== undefined
    ? AOS_TURN_PHASES[battle.phaseIndex] ?? null
    : null
}

export function executeAosBattleCommand(
  state: GameState,
  data: AosMatchStateData,
  command: GameSystemCommand,
): GameState {
  if (command.type === 'aos/battle/start') return startBattle(state, data, command)
  if (data.status !== 'battle' || !data.battle) return state
  switch (command.type) {
    case 'aos/battle/priority-rolled':
      return recordPriority(state, data, command)
    case 'aos/battle/choose-first-player':
      return chooseFirstPlayer(state, data, command)
    case 'aos/battle/continue':
      return continueBattle(state, data, command)
    case 'aos/battle/end-phase':
      return endPhase(state, data, command)
    default:
      return state
  }
}

export function isAosBattleState(value: unknown): value is AosBattleState {
  if (!isRecord(value)) return false
  return typeof value.stage === 'string'
    && ['FIRST_PLAYER_CHOICE', 'PRIORITY_ROLL', 'PRIORITY_CHOICE', 'START_OF_ROUND', 'TURN_PHASE', 'END_OF_ROUND', 'BATTLE_COMPLETE'].includes(value.stage)
    && typeof value.round === 'number'
    && typeof value.roundLimit === 'number'
    && Array.isArray(value.completedRounds)
    && Array.isArray(value.doubleTurns)
}

function startBattle(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const deployment = data.deployment
  if (data.status !== 'deployment' || deployment?.phase !== 'READY_FOR_BATTLE') return state
  if (!state.players.some((player) => player.id === command.actorPlayerId)) return state
  const chooserPlayerId = deploymentFirstFinisher(state, deployment.facts)
  if (!chooserPlayerId) return state
  const battle: AosBattleState = {
    stage: 'FIRST_PLAYER_CHOICE',
    round: 1,
    roundLimit: state.resolvedMatchConfiguration?.roundLimit ?? 5,
    chooserPlayerId,
    completedRounds: [],
    doubleTurns: [],
  }
  return replaceBattle(state, { ...data, status: 'battle', battle }, battle, {
    activePlayerId: chooserPlayerId,
    turn: 0,
    phase: 'FIRST_PLAYER_CHOICE',
    matchLifecycle: 'IN_PROGRESS',
  })
}

function recordPriority(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const battle = data.battle!
  if (battle.stage !== 'PRIORITY_ROLL' || battle.round < 2) return state
  const payload = record(command.payload)
  const playerIds = state.players.map((player) => player.id)
  if (playerIds.length !== 2) return state
  const firstResult = payload?.[playerIds[0]]
  const secondResult = payload?.[playerIds[1]]
  if (!validDie(firstResult) || !validDie(secondResult)) return state
  const tied = firstResult === secondResult
  const previous = battle.completedRounds.at(-1)
  const chooserPlayerId = tied
    ? previous?.firstPlayerId
    : firstResult > secondResult ? playerIds[0] : playerIds[1]
  if (!chooserPlayerId) return state
  const priority: AosPriorityRoll = {
    round: battle.round,
    resultsByPlayerId: { [playerIds[0]]: firstResult, [playerIds[1]]: secondResult },
    tied,
    chooserPlayerId,
  }
  const next = { ...battle, stage: 'PRIORITY_CHOICE' as const, chooserPlayerId, priority }
  return replaceBattle(state, { ...data, battle: next }, next, {
    activePlayerId: chooserPlayerId,
    turn: 0,
    phase: 'PRIORITY',
  })
}

function chooseFirstPlayer(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const battle = data.battle!
  if (!['FIRST_PLAYER_CHOICE', 'PRIORITY_CHOICE'].includes(battle.stage)
    || command.actorPlayerId !== battle.chooserPlayerId) return state
  const firstPlayerId = record(command.payload)?.firstPlayerId
  if (typeof firstPlayerId !== 'string' || !state.players.some((player) => player.id === firstPlayerId)) return state
  const secondPlayerId = state.players.find((player) => player.id !== firstPlayerId)?.id
  if (!secondPlayerId) return state
  const previous = battle.completedRounds.at(-1)
  const doubleTurnTakenByPlayerId = previous?.secondPlayerId === firstPlayerId ? firstPlayerId : undefined
  const underdogPlayerId = determineUnderdog(state)
  const next: AosBattleState = {
    ...battle,
    stage: 'START_OF_ROUND',
    firstPlayerId,
    secondPlayerId,
    underdogPlayerId,
    turnIndex: undefined,
    phaseIndex: undefined,
    doubleTurns: doubleTurnTakenByPlayerId
      ? [...battle.doubleTurns, { round: battle.round, playerId: doubleTurnTakenByPlayerId }]
      : battle.doubleTurns,
  }
  return replaceBattle(state, { ...data, battle: next }, next, {
    activePlayerId: firstPlayerId,
    turn: 0,
    phase: 'START_OF_BATTLE_ROUND',
  })
}

function continueBattle(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const battle = data.battle!
  if (!state.players.some((player) => player.id === command.actorPlayerId)) return state
  if (battle.stage === 'START_OF_ROUND') return beginTurn(state, data, battle, 0)
  if (battle.stage !== 'END_OF_ROUND' || !battle.firstPlayerId || !battle.secondPlayerId) return state
  const doubleTurnTakenByPlayerId = battle.doubleTurns.find((fact) => fact.round === battle.round)?.playerId
  const completedRound: AosCompletedRound = {
    round: battle.round,
    firstPlayerId: battle.firstPlayerId,
    secondPlayerId: battle.secondPlayerId,
    ...(battle.underdogPlayerId ? { underdogPlayerId: battle.underdogPlayerId } : {}),
    ...(doubleTurnTakenByPlayerId ? { doubleTurnTakenByPlayerId } : {}),
    ...(battle.priority ? { priority: battle.priority } : {}),
  }
  const completedRounds = [...battle.completedRounds, completedRound]
  if (battle.round >= battle.roundLimit) {
    const complete: AosBattleState = { ...battle, stage: 'BATTLE_COMPLETE', completedRounds }
    return replaceBattle(state, { ...data, battle: complete }, complete, {
      activePlayerId: battle.secondPlayerId,
      turn: 2,
      phase: 'BATTLE_COMPLETE',
      matchLifecycle: 'COMPLETED',
    })
  }
  const next: AosBattleState = {
    stage: 'PRIORITY_ROLL',
    round: battle.round + 1,
    roundLimit: battle.roundLimit,
    completedRounds,
    doubleTurns: battle.doubleTurns,
  }
  return replaceBattle(state, { ...data, battle: next }, next, {
    activePlayerId: completedRound.firstPlayerId,
    turn: 0,
    phase: 'PRIORITY',
  })
}

function endPhase(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const battle = data.battle!
  if (battle.stage !== 'TURN_PHASE' || battle.phaseIndex === undefined || battle.turnIndex === undefined
    || command.actorPlayerId !== state.gameContext.activePlayerId) return state
  if (battle.phaseIndex < AOS_TURN_PHASES.length - 1) {
    const phaseIndex = battle.phaseIndex + 1
    const next = { ...battle, phaseIndex }
    return replaceBattle(state, { ...data, battle: next }, next, {
      activePlayerId: state.gameContext.activePlayerId,
      turn: battle.turnIndex + 1,
      phase: AOS_TURN_PHASES[phaseIndex].id,
    })
  }
  if (battle.turnIndex === 0) return beginTurn(state, data, battle, 1)
  const next = { ...battle, stage: 'END_OF_ROUND' as const, phaseIndex: undefined }
  return replaceBattle(state, { ...data, battle: next }, next, {
    activePlayerId: state.gameContext.activePlayerId,
    turn: 2,
    phase: 'END_OF_BATTLE_ROUND',
  })
}

function beginTurn(state: GameState, data: AosMatchStateData, battle: AosBattleState, turnIndex: 0 | 1): GameState {
  const activePlayerId = turnIndex === 0 ? battle.firstPlayerId : battle.secondPlayerId
  if (!activePlayerId) return state
  const next: AosBattleState = { ...battle, stage: 'TURN_PHASE', turnIndex, phaseIndex: 0 }
  return replaceBattle(state, { ...data, battle: next }, next, {
    activePlayerId,
    turn: turnIndex + 1,
    phase: AOS_TURN_PHASES[0].id,
    incrementTurnSequence: true,
  })
}

function replaceBattle(
  state: GameState,
  data: AosMatchStateData,
  battle: AosBattleState,
  context: {
    activePlayerId: string
    turn: number
    phase: string
    matchLifecycle?: GameState['matchLifecycle']
    incrementTurnSequence?: boolean
  },
): GameState {
  const turnSequence = state.gameContext.turnSequence + Number(Boolean(context.incrementTurnSequence))
  return {
    ...state,
    ...(context.matchLifecycle ? { matchLifecycle: context.matchLifecycle } : {}),
    gameContext: {
      ...state.gameContext,
      round: battle.round,
      turn: context.turn,
      turnSequence,
      turnId: context.incrementTurnSequence
        ? `aos-round-${battle.round}-turn-${context.turn}-${turnSequence}`
        : state.gameContext.turnId,
      activePlayerId: context.activePlayerId,
      phase: context.phase,
    },
    gameSystemState: { ...state.gameSystemState!, data: data as unknown as JsonValue },
    lastCommittedOperationUndo: null,
    lastConfirmedMovementUndo: null,
  }
}

function determineUnderdog(state: GameState): string | undefined {
  const playerIds = state.players.map((player) => player.id)
  if (playerIds.length !== 2) return undefined
  const totals = scoreTotals(state.scoreHistory ?? [], playerIds)
  if (totals[playerIds[0]] === totals[playerIds[1]]) return undefined
  return totals[playerIds[0]] < totals[playerIds[1]] ? playerIds[0] : playerIds[1]
}

function deploymentFirstFinisher(
  state: GameState,
  facts: ReadonlyArray<{ sequence: number; playerId: string }>,
): string | undefined {
  const completion = state.players.map((player) => ({
    playerId: player.id,
    sequence: Math.max(...facts.filter((fact) => fact.playerId === player.id).map((fact) => fact.sequence), -1),
  }))
  if (completion.some((entry) => entry.sequence < 0)) return undefined
  return completion.sort((left, right) => left.sequence - right.sequence || left.playerId.localeCompare(right.playerId))[0]?.playerId
}

function validDie(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
