import type { GameState } from '../domain/types'
import type { AosDeploymentState } from '../gameSystem/ageOfSigmar/deployment'
import { currentAosPhase, type AosBattleState } from '../gameSystem/ageOfSigmar/battleRound'

export function AosBattleRoundPanel({ state, deployment, battle, onClose, onStart, onRollPriority,
  onChooseFirstPlayer, onContinue, onEndPhase }: {
  state: GameState
  deployment: AosDeploymentState
  battle: AosBattleState | null
  onClose: () => void
  onStart: () => void
  onRollPriority: () => void
  onChooseFirstPlayer: (playerId: string) => void
  onContinue: () => void
  onEndPhase: () => void
}) {
  const playerName = (id?: string) => state.players.find((player) => player.id === id)?.displayName ?? id ?? '—'
  const phase = battle ? currentAosPhase(battle) : null
  const firstFinisher = deploymentFirstFinisher(state, deployment)
  const doubleTurn = battle?.doubleTurns.find((fact) => fact.round === battle.round)?.playerId

  return <aside className="aos-round-panel" aria-label="Age of Sigmar battle round">
    <div className="context-panel-heading">
      <div><span className="eyebrow">AGE OF SIGMAR</span><h2>{battle ? `Battle Round ${battle.round}` : 'Ready for Battle'}</h2></div>
      <button type="button" className="panel-close" aria-label="Close battle round" onClick={onClose}>×</button>
    </div>

    {!battle && <>
      <p>Deployment is complete. {playerName(firstFinisher)} finished setting up first.</p>
      <button type="button" className="primary-panel-action" onClick={onStart}>Start Battle Round 1</button>
    </>}

    {battle?.stage === 'FIRST_PLAYER_CHOICE' && <section className="battle-flow-card">
      <span className="panel-section-label">ROUND 1</span>
      <p><strong>{playerName(battle.chooserPlayerId)}</strong> finished deployment first and chooses the first player.</p>
      <PlayerChoice state={state} onChoose={onChooseFirstPlayer} />
    </section>}

    {battle?.stage === 'PRIORITY_ROLL' && <section className="battle-flow-card">
      <span className="panel-section-label">PRIORITY</span>
      <p>Roll one D6 for each player. The winner chooses who takes the first turn.</p>
      <button type="button" className="primary-panel-action" onClick={onRollPriority}>Roll Round {battle.round} Priority</button>
    </section>}

    {battle?.stage === 'PRIORITY_CHOICE' && battle.priority && <section className="battle-flow-card">
      <span className="panel-section-label">ROUND {battle.round} PRIORITY</span>
      <div className="priority-results">
        {state.players.map((player) => <div key={player.id}><span>{player.displayName}</span>
          <strong>{battle.priority!.resultsByPlayerId[player.id]}</strong></div>)}
      </div>
      {battle.priority.tied && <p className="battle-note">Tie — {playerName(battle.chooserPlayerId)}, who took the first turn last round, chooses.</p>}
      {!battle.priority.tied && <p className="battle-note">{playerName(battle.chooserPlayerId)} won the roll and chooses.</p>}
      <PlayerChoice state={state} onChoose={onChooseFirstPlayer} />
    </section>}

    {battle && ['START_OF_ROUND', 'TURN_PHASE', 'END_OF_ROUND', 'BATTLE_COMPLETE'].includes(battle.stage) && <>
      <dl className="battle-flow-facts">
        <div><dt>First Player</dt><dd>{playerName(battle.firstPlayerId)}</dd></div>
        <div><dt>Underdog</dt><dd>{playerName(battle.underdogPlayerId)}</dd></div>
        {doubleTurn && <div><dt>Double Turn</dt><dd>{playerName(doubleTurn)}</dd></div>}
        {battle.turnIndex !== undefined && <div><dt>Turn</dt><dd>{battle.turnIndex + 1} · {playerName(state.gameContext.activePlayerId)}</dd></div>}
        {phase && <div><dt>Phase</dt><dd>{phase.name}</dd></div>}
      </dl>
      {battle.stage === 'START_OF_ROUND' && <>
        <p>Start of Battle Round window. No supported Alpha abilities are available yet.</p>
        <button type="button" className="primary-panel-action" onClick={onContinue}>Continue to First Turn</button>
      </>}
      {battle.stage === 'TURN_PHASE' && <>
        <p>{phase?.id === 'END_OF_TURN'
          ? 'Objective control and battleplan scoring are not implemented yet.'
          : 'Active-player and opponent ability opportunities are reserved; no supported actions are available yet.'}</p>
        <button type="button" className="primary-panel-action" onClick={onEndPhase}>
          {phase?.id === 'END_OF_TURN' ? 'End Turn' : `End ${phase?.name}`}
        </button>
      </>}
      {battle.stage === 'END_OF_ROUND' && <>
        <p>End of Battle Round window. Future abilities and resources will resolve here.</p>
        <button type="button" className="primary-panel-action" onClick={onContinue}>Continue</button>
      </>}
      {battle.stage === 'BATTLE_COMPLETE' && <p className="battle-complete-note">
        <strong>Battle Complete</strong><br />Final scoring and winner resolution are not implemented yet.
      </p>}
    </>}
  </aside>
}

function PlayerChoice({ state, onChoose }: { state: GameState; onChoose: (playerId: string) => void }) {
  return <div className="player-choice-buttons">
    {state.players.map((player) => <button type="button" key={player.id} onClick={() => onChoose(player.id)}>
      {player.displayName}
    </button>)}
  </div>
}

function deploymentFirstFinisher(state: GameState, deployment: AosDeploymentState): string | undefined {
  return state.players.map((player) => ({
    playerId: player.id,
    sequence: Math.max(...deployment.facts.filter((fact) => fact.playerId === player.id).map((fact) => fact.sequence), -1),
  })).filter((entry) => entry.sequence >= 0)
    .sort((left, right) => left.sequence - right.sequence || left.playerId.localeCompare(right.playerId))[0]?.playerId
}
