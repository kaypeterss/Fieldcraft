import type { GameState, JsonValue, Pose } from '../../domain/types'
import { validateModelPlacements, type PlacementAreaConstraint } from '../../engine/placement'
import { commitOperation, createCommittedOperation } from '../../game/committedOperations'
import { modelPresence } from '../../game/modelPresence'
import type { GameSystemCommand } from '../types'
import { aosSetupData } from './prepareAgeOfSigmarMatch'
import { executeAosBattleCommand, isAosBattleState, type AosBattleState } from './battleRound'

export type AosDeploymentPhase = 'ROLL_OFF' | 'CHOOSE_ROLES' | 'CHOOSE_TERRITORY' | 'DEPLOYING' | 'READY_FOR_BATTLE'

export interface AosDeploymentRoll {
  player1: number
  player2: number
}

export interface AosDeploymentFact {
  sequence: number
  type: 'UNIT_DEPLOYED'
  playerId: string
  unitId: string
  ability: 'DEPLOY_UNIT'
}

export interface AosDeploymentState {
  phase: AosDeploymentPhase
  rolls: AosDeploymentRoll[]
  rollWinnerPlayerId?: string
  attackerPlayerId?: string
  defenderPlayerId?: string
  territoryByPlayerId: Record<string, string>
  currentPlayerId?: string
  deployedUnitIds: string[]
  facts: AosDeploymentFact[]
  /** Reserved for real Deploy Regiment once authored regiment membership exists. */
  activeRegimentId?: string
}

export interface AosMatchStateData {
  status: 'setup' | 'deployment' | 'battle' | 'rules-not-implemented'
  setup: ReturnType<typeof aosSetupData>
  deployment?: AosDeploymentState
  battle?: AosBattleState
}

export interface AosDeploymentPlacementRules {
  ownZoneId: string
  enemyZoneId: string
  enemyTerritoryExclusionDistance: number
  ownAreas: Array<Array<{ x: number; y: number }>>
  enemyAreas: Array<Array<{ x: number; y: number }>>
  areaConstraints: PlacementAreaConstraint[]
}

export function initialAosDeploymentState(): AosDeploymentState {
  return {
    phase: 'ROLL_OFF',
    rolls: [],
    territoryByPlayerId: {},
    deployedUnitIds: [],
    facts: [],
  }
}

export function aosMatchStateData(state: GameState): AosMatchStateData | null {
  const data = state.gameSystemState?.data
  return isAosMatchStateData(data) ? data : null
}

export function aosDeploymentState(state: GameState): AosDeploymentState | null {
  const data = aosMatchStateData(state)
  return data && (data.status === 'deployment' || data.status === 'battle')
    ? data.deployment ?? initialAosDeploymentState() : null
}

export function executeAosCommand(state: GameState, command: GameSystemCommand): GameState {
  const data = aosMatchStateData(state)
  if (!data) return state
  if (command.type.startsWith('aos/battle/')) return executeAosBattleCommand(state, data, command)
  if (data.status !== 'deployment') return state
  const normalizedData: AosMatchStateData = { ...data, deployment: data.deployment ?? initialAosDeploymentState() }
  switch (command.type) {
    case 'aos/deployment/roll-off':
      return recordRollOff(state, normalizedData, command)
    case 'aos/deployment/choose-attacker':
      return chooseAttacker(state, normalizedData, command)
    case 'aos/deployment/choose-territory':
      return chooseTerritory(state, normalizedData, command)
    case 'aos/deployment/deploy-unit':
      return deployUnit(state, normalizedData, command)
    default:
      return state
  }
}

export function validateAosDeploymentPlacements(
  state: GameState,
  unitId: string,
  placements: Readonly<Record<string, Pose>>,
) {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  const rules = aosDeploymentPlacementRules(state, unitId)
  if (!unit || !rules) return null
  return validateModelPlacements({
    state,
    placements,
    constraints: {
      requireBattlefieldContainment: true,
      requireCollisionLegality: true,
      requireTerrainFinish: true,
      requireCoherency: true,
    },
    areaConstraints: rules.areaConstraints,
  })
}

/** One authoritative source for both deployment validation and its assistance overlay. */
export function aosDeploymentPlacementRules(state: GameState, unitId: string): AosDeploymentPlacementRules | null {
  const deployment = aosDeploymentState(state)
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (!deployment || !unit) return null
  const ownZoneId = deployment.territoryByPlayerId[unit.ownerId]
  const enemyId = state.players.find((player) => player.id !== unit.ownerId)?.id
  const enemyZoneId = enemyId ? deployment.territoryByPlayerId[enemyId] : undefined
  const ownZone = state.resolvedMatchConfiguration?.deploymentZones.find((zone) => zone.id === ownZoneId)
  const enemyZone = state.resolvedMatchConfiguration?.deploymentZones.find((zone) => zone.id === enemyZoneId)
  if (!ownZone?.areas?.length || !enemyZone?.areas?.length) return null
  const enemyTerritoryExclusionDistance = 9
  const ownAreas = ownZone.areas.map((area) => area.vertices)
  const enemyAreas = enemyZone.areas.map((area) => area.vertices)
  const areaConstraints: PlacementAreaConstraint[] = [
    { type: 'wholly-within-area-union', id: ownZone.id, areas: ownAreas },
    { type: 'minimum-distance-from-area-union', id: enemyZone.id, distance: enemyTerritoryExclusionDistance, areas: enemyAreas },
  ]
  return { ownZoneId: ownZone.id, enemyZoneId: enemyZone.id, enemyTerritoryExclusionDistance, ownAreas, enemyAreas, areaConstraints }
}

export function isAosMatchStateData(value: unknown): value is AosMatchStateData {
  if (!isRecord(value) || typeof value.status !== 'string') return false
  if (value.status === 'rules-not-implemented') return true
  if (!isRecord(value.setup)) return false
  if (value.status === 'setup') return true
  if (value.status === 'battle') return isAosBattleState(value.battle)
  if (value.status !== 'deployment') return false
  if (value.deployment === undefined) return true
  if (!isRecord(value.deployment)) return false
  const deployment = value.deployment
  return typeof deployment.phase === 'string'
    && ['ROLL_OFF', 'CHOOSE_ROLES', 'CHOOSE_TERRITORY', 'DEPLOYING', 'READY_FOR_BATTLE'].includes(deployment.phase)
    && Array.isArray(deployment.rolls)
    && isRecord(deployment.territoryByPlayerId)
    && Array.isArray(deployment.deployedUnitIds)
    && Array.isArray(deployment.facts)
}

function recordRollOff(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const deployment = data.deployment!
  if (deployment.phase !== 'ROLL_OFF') return state
  const payload = record(command.payload)
  const player1 = payload?.player1
  const player2 = payload?.player2
  if (!validDie(player1) || !validDie(player2)) return state
  const rolls = [...deployment.rolls, { player1, player2 }]
  const winner = player1 === player2 ? undefined : player1 > player2 ? state.players[0]?.id : state.players[1]?.id
  return replaceDeployment(state, data, {
    ...deployment,
    rolls,
    ...(winner ? { phase: 'CHOOSE_ROLES' as const, rollWinnerPlayerId: winner } : {}),
  }, true)
}

function chooseAttacker(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const deployment = data.deployment!
  if (deployment.phase !== 'CHOOSE_ROLES' || command.actorPlayerId !== deployment.rollWinnerPlayerId) return state
  const chosen = record(command.payload)?.attackerPlayerId
  if (typeof chosen !== 'string' || !state.players.some((player) => player.id === chosen)) return state
  const defender = state.players.find((player) => player.id !== chosen)?.id
  if (!defender) return state
  return replaceDeployment(state, data, {
    ...deployment,
    phase: 'CHOOSE_TERRITORY',
    attackerPlayerId: chosen,
    defenderPlayerId: defender,
    currentPlayerId: chosen,
  }, true)
}

function chooseTerritory(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const deployment = data.deployment!
  if (deployment.phase !== 'CHOOSE_TERRITORY' || command.actorPlayerId !== deployment.attackerPlayerId) return state
  const zoneId = record(command.payload)?.zoneId
  const zones = state.resolvedMatchConfiguration?.deploymentZones ?? []
  if (typeof zoneId !== 'string' || !zones.some((zone) => zone.id === zoneId)) return state
  const other = zones.find((zone) => zone.id !== zoneId)?.id
  if (!other || !deployment.attackerPlayerId || !deployment.defenderPlayerId) return state
  const next = replaceDeployment(state, data, {
    ...deployment,
    phase: 'DEPLOYING',
    territoryByPlayerId: {
      [deployment.attackerPlayerId]: zoneId,
      [deployment.defenderPlayerId]: other,
    },
    currentPlayerId: deployment.attackerPlayerId,
  }, true)
  return {
    ...next,
    resolvedMatchConfiguration: next.resolvedMatchConfiguration ? {
      ...next.resolvedMatchConfiguration,
      deploymentZones: next.resolvedMatchConfiguration.deploymentZones.map((zone) => ({
        ...zone,
        ownerRole: zone.id === zoneId ? 'attacker' as const : 'defender' as const,
      })),
    } : undefined,
  }
}

function deployUnit(state: GameState, data: AosMatchStateData, command: GameSystemCommand): GameState {
  const deployment = data.deployment!
  if (deployment.phase !== 'DEPLOYING' || command.actorPlayerId !== deployment.currentPlayerId) return state
  const payload = record(command.payload)
  const unitId = payload?.unitId
  const rawPlacements = payload?.placements
  if (typeof unitId !== 'string' || !isRecord(rawPlacements)) return state
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (!unit || unit.ownerId !== command.actorPlayerId || deployment.deployedUnitIds.includes(unit.id)) return state
  if (unit.modelIds.some((id) => modelPresence(state.models.find((model) => model.id === id)!) !== 'OFF_BOARD')) return state
  const placements = parsePlacements(rawPlacements)
  if (!placements || !sameIds(Object.keys(placements), unit.modelIds)) return state
  const validation = validateAosDeploymentPlacements(state, unit.id, placements)
  if (!validation?.valid) return state

  const idSet = new Set(unit.modelIds)
  const sequence = state.nextActionSequence
  const deployedUnitIds = [...deployment.deployedUnitIds, unit.id]
  const afterModels = state.models.map((model) => {
    const pose = placements[model.id]
    return pose && idSet.has(model.id)
      ? { ...model, position: { ...pose.position }, rotation: pose.rotation, presence: 'ON_BATTLEFIELD' as const }
      : model
  })
  const nextPlayerId = nextDeploymentPlayer(state, command.actorPlayerId, deployedUnitIds)
  const phase: AosDeploymentPhase = nextPlayerId ? 'DEPLOYING' : 'READY_FOR_BATTLE'
  const nextDeployment: AosDeploymentState = {
    ...deployment,
    phase,
    deployedUnitIds,
    currentPlayerId: nextPlayerId,
    facts: [...deployment.facts, {
      sequence,
      type: 'UNIT_DEPLOYED',
      playerId: command.actorPlayerId,
      unitId: unit.id,
      ability: 'DEPLOY_UNIT',
    }],
  }
  const after: GameState = {
    ...state,
    models: afterModels,
    gameContext: { ...state.gameContext, activePlayerId: nextPlayerId ?? state.gameContext.activePlayerId },
    gameSystemState: { ...state.gameSystemState!, data: { ...data, deployment: nextDeployment } as unknown as JsonValue },
    nextActionSequence: sequence + 1,
  }
  return commitOperation(state, after, createCommittedOperation({
    sequence,
    type: 'GAME_SYSTEM',
    actorPlayerId: command.actorPlayerId,
    state,
    entityIds: [unit.id, ...unit.modelIds],
  }))
}

function nextDeploymentPlayer(state: GameState, actorPlayerId: string, deployed: readonly string[]): string | undefined {
  const remaining = (playerId: string) => state.units.some((unit) => unit.ownerId === playerId && !deployed.includes(unit.id))
  const opponent = state.players.find((player) => player.id !== actorPlayerId)?.id
  if (opponent && remaining(opponent)) return opponent
  return remaining(actorPlayerId) ? actorPlayerId : undefined
}

function replaceDeployment(
  state: GameState,
  data: AosMatchStateData,
  deployment: AosDeploymentState,
  lockUndo: boolean,
): GameState {
  return {
    ...state,
    gameContext: { ...state.gameContext, ...(deployment.currentPlayerId ? { activePlayerId: deployment.currentPlayerId } : {}) },
    gameSystemState: { ...state.gameSystemState!, data: { ...data, deployment } as unknown as JsonValue },
    ...(lockUndo ? { lastCommittedOperationUndo: null, lastConfirmedMovementUndo: null } : {}),
  }
}

function parsePlacements(value: Record<string, JsonValue>): Record<string, Pose> | null {
  const entries: Array<[string, Pose]> = []
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !isRecord(raw.position)
      || typeof raw.position.x !== 'number' || typeof raw.position.y !== 'number'
      || typeof raw.rotation !== 'number') return null
    entries.push([id, { position: { x: raw.position.x, y: raw.position.y }, rotation: raw.rotation }])
  }
  return Object.fromEntries(entries)
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index])
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
