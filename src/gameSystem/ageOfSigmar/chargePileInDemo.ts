import type { GameState, JsonValue } from '../../domain/types'
import { createAgeOfSigmarAlphaMatch } from './ageOfSigmarMatch'
import { executeAosCommand, initialAosDeploymentState, type AosDeploymentFact } from './deployment'
import { prepareAgeOfSigmarMatch } from './prepareAgeOfSigmarMatch'

/** Small deterministic browser-QA board; normal AoS match creation is unchanged. */
export function createAosChargePileInDemo(startInCombat = false): GameState {
  let state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch({
    matchId: 'aos-charge-pile-in-preview', matchName: 'Charge & Pile-in QA',
  }))
  let sequence = 1
  const facts: AosDeploymentFact[] = state.players.flatMap((player) => state.units
    .filter((unit) => unit.ownerId === player.id)
    .map((unit) => ({ sequence: sequence++, type: 'UNIT_DEPLOYED' as const, playerId: player.id,
      unitId: unit.id, ability: 'DEPLOY_UNIT' as const })))
  const deployment = { ...initialAosDeploymentState(), phase: 'READY_FOR_BATTLE' as const,
    deployedUnitIds: state.units.map((unit) => unit.id), facts,
    attackerPlayerId: 'player-1', defenderPlayerId: 'player-2',
    territoryByPlayerId: { 'player-1': 'attacker-territory', 'player-2': 'defender-territory' } }
  const combatPositions: Record<string, { x: number; y: number }> = {
    'sce-knight-questor-1': { x: 7, y: 8 },
    'skv-clawlord-1': { x: startInCombat ? 10 : 15, y: 8 },
    'sce-liberators-1': { x: 17, y: 18 },
    'sce-liberators-2': { x: 18.9, y: 18 },
    'sce-liberators-3': { x: 20.8, y: 18 },
    'sce-liberators-4': { x: 17.95, y: 19.9 },
    'sce-liberators-5': { x: 19.85, y: 19.9 },
    'skv-rat-ogors-1': { x: startInCombat ? 23 : 29, y: 18.8 },
    'skv-rat-ogors-2': { x: startInCombat ? 25.4 : 31.4, y: 18.8 },
    'skv-rat-ogors-3': { x: startInCombat ? 27.8 : 33.8, y: 18.8 },
  }
  const active = new Set(Object.keys(combatPositions))
  state = { ...state, models: state.models.map((model) => ({ ...model,
    presence: active.has(model.id) ? 'ON_BATTLEFIELD' as const : 'OFF_BOARD' as const,
    position: combatPositions[model.id] ?? model.position })),
    unitDefinitions: startInCombat ? state.unitDefinitions.map((definition) => definition.id === 'aos-clawlord-on-gnaw-beast'
      ? { ...definition, id: 'aos-qa-ward-guard', name: 'Ward Guard QA' } : definition) : state.unitDefinitions,
    units: startInCombat ? state.units.map((unit) => unit.id === 'skv-clawlord'
      ? { ...unit, definitionId: 'aos-qa-ward-guard' } : unit) : state.units,
    gameSystemState: { ...state.gameSystemState!, data: { status: 'deployment',
      setup: (state.gameSystemState!.data as Record<string, JsonValue>).setup, deployment } as unknown as JsonValue } }
  const issue = (type: string, actorPlayerId: string, payload?: JsonValue) => {
    state = executeAosCommand(state, { type, actorPlayerId, payload })
  }
  issue('aos/battle/start', 'player-1')
  issue('aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-1' })
  issue('aos/battle/continue', 'player-1')
  for (let index = 0; index < 4; index += 1) issue('aos/battle/end-phase', 'player-1')
  if (startInCombat) issue('aos/battle/end-phase', 'player-1')
  return state
}
