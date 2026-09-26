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
  const active = new Set(['sce-knight-questor-1', 'skv-clawlord-1'])
  state = { ...state, models: state.models.map((model) => ({ ...model,
    presence: active.has(model.id) ? 'ON_BATTLEFIELD' as const : 'OFF_BOARD' as const,
    position: model.id === 'sce-knight-questor-1' ? { x: 10, y: 10 }
      : model.id === 'skv-clawlord-1' ? { x: startInCombat ? 14.5 : 18, y: 10 } : model.position })),
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
