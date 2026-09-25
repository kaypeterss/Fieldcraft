import type { DiceHistoryEntry, Player } from '../domain/types'

interface DiceHistoryProps {
  history: readonly DiceHistoryEntry[]
  players: readonly Player[]
}

export function DiceHistory({ history, players }: DiceHistoryProps) {
  return <details className="dice-history">
    <summary>Dice history ({history.length})</summary>
    <div className="dice-history-list">
      {[...history].reverse().slice(0, 10).map((entry) => {
        const player = players.find((candidate) => candidate.id === entry.playerId)
        const context = `R${entry.round}/T${entry.turn} · ${player?.displayName ?? entry.playerId}${entry.phase ? ` · ${entry.phase}` : ''}`
        if (entry.type === 'DICE_SEQUENCE') {
          return <details key={entry.id}>
            <summary>
              <strong>{entry.definition.label}</strong>
              <span>{context}</span>
              <small>Final {entry.finalResult}</small>
            </summary>
            {entry.stageResults.map((result) => <div className="dice-history-stage" key={result.stage.id}>
              <strong>{result.stage.label}</strong>
              <span>{result.inputDiceCount}D{result.stage.sides} · {result.effectiveThreshold}+</span>
              <small>{continuationText(result.stage.continuation, result.continuationCount)}</small>
              <p>Original: {displayResults(result.roll.originalResults)}</p>
              {result.roll.rerolls.map((reroll, index) => <p key={index}>
                Reroll {reroll.values.join(', ')}: {displayResults(reroll.previousResults)} → {displayResults(reroll.replacementResults)}
              </p>)}
              <p>Final: {displayResults(result.roll.finalResults)}</p>
            </div>)}
          </details>
        }
        return <details key={entry.id}>
          <summary>
            <strong>{entry.label ?? `${entry.count}D${entry.sides}`}</strong>
            <span>{context} · total {entry.total}</span>
            {entry.successThreshold !== undefined && <small>{entry.successes} at {entry.successThreshold}+</small>}
          </summary>
          <p>Original: {displayResults(entry.originalResults)}</p>
          {entry.rerolls.map((reroll, index) => <p key={index}>
            Reroll {reroll.values.join(', ')}: {displayResults(reroll.previousResults)} → {displayResults(reroll.replacementResults)}
          </p>)}
          <p>Final: {displayResults(entry.finalResults)}</p>
        </details>
      })}
      {history.length === 0 && <p>No rolls yet.</p>}
    </div>
  </details>
}

function continuationText(continuation: 'successes' | 'failures', count: number): string {
  return `${count} ${continuation === 'successes' ? 'passed' : 'failed'} continue`
}

function displayResults(results: readonly number[]): string {
  return results.length ? results.join(' ') : 'none'
}
