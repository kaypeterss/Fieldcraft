import { useMemo, useState } from 'react'
import type { Player, ScoreEvent } from '../domain/types'
import { scoreTotalForPlayer } from '../game/scoring'

interface ScoreboardProps {
  players: readonly Player[]
  events: readonly ScoreEvent[]
  onRecord: (playerId: string, pointsDelta: number, reason: string) => void
  onUndoLast: () => void
}

export function Scoreboard({ players, events, onRecord, onUndoLast }: ScoreboardProps) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '')
  const [pointsDraft, setPointsDraft] = useState('1')
  const [reason, setReason] = useState('Manual adjustment')
  const pointsDelta = Number(pointsDraft)
  const valid = Boolean(playerId && Number.isFinite(pointsDelta) && pointsDelta !== 0 && reason.trim())
  const totals = useMemo(() => new Map(players.map((player) => [
    player.id, scoreTotalForPlayer(events, player.id),
  ])), [events, players])

  return <div className="scoreboard" aria-label="Scoreboard">
    <div className="scoreboard-totals">
      {players.map((player) => <span key={player.id}>
        <small>{player.displayName}</small><strong>{totals.get(player.id) ?? 0} VP</strong>
      </span>)}
    </div>
    <details className="score-controls">
      <summary>Score</summary>
      <div className="status-popover score-popover">
        <span className="popover-title">MANUAL SCORE ADJUSTMENT</span>
        <label><span>Player</span><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
          {players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}
        </select></label>
        <label><span>Points (+/−)</span><input aria-label="Points adjustment" type="number" step="1"
          value={pointsDraft} onChange={(event) => setPointsDraft(event.target.value)} /></label>
        <label><span>Reason</span><input aria-label="Score reason" value={reason}
          onChange={(event) => setReason(event.target.value)} /></label>
        <div className="score-actions">
          <button type="button" disabled={!valid} onClick={() => {
            if (valid) onRecord(playerId, pointsDelta, reason)
          }}>Record</button>
          <button type="button" disabled={events.length === 0} onClick={onUndoLast}>Undo last</button>
        </div>
        <div className="score-event-list">
          {[...events].reverse().slice(0, 8).map((event) => {
            const player = players.find((candidate) => candidate.id === event.playerId)
            return <div key={event.id}>
              <strong>{event.payload.pointsDelta > 0 ? '+' : ''}{event.payload.pointsDelta}</strong>
              <span>{player?.displayName ?? event.playerId} · {event.payload.reason}</span>
              <small>R{event.round}/T{event.turn}{event.phase ? ` · ${event.phase}` : ''}</small>
            </div>
          })}
        </div>
      </div>
    </details>
  </div>
}
