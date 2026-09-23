import { useMemo, useState } from 'react'
import type { DiceHistoryEntry, DicePoolResult, DiceSequenceResolution, Player } from '../domain/types'
import {
  rerollDiceValues,
  rollDice,
  systemRandomSource,
  type RandomSource,
} from '../engine/dice'
import { DiceHistory } from './DiceHistory'
import { DiceSequenceBuilder } from './DiceSequenceBuilder'

interface DicePanelProps {
  players: readonly Player[]
  activePlayerId: string
  history: readonly DiceHistoryEntry[]
  onClose: () => void
  onRecord: (playerId: string, result: DicePoolResult) => string
  onUpdate: (rollId: string, result: DicePoolResult) => void
  onRecordSequence: (playerId: string, resolution: DiceSequenceResolution) => void
  randomSource?: RandomSource
}

const DIE_TYPES = [4, 6, 8, 10, 12, 20]

export function DicePanel({
  players,
  activePlayerId,
  history,
  onClose,
  onRecord,
  onUpdate,
  onRecordSequence,
  randomSource = systemRandomSource,
}: DicePanelProps) {
  const [mode, setMode] = useState<'pool' | 'sequence'>('pool')
  const [countDraft, setCountDraft] = useState('20')
  const [sides, setSides] = useState(6)
  const [threshold, setThreshold] = useState<number | null>(null)
  const [playerId, setPlayerId] = useState(activePlayerId)
  const [current, setCurrent] = useState<DicePoolResult | null>(null)
  const [currentRollId, setCurrentRollId] = useState<string | null>(null)
  const [rerollValues, setRerollValues] = useState<Set<number>>(new Set())
  const count = Number(countDraft)
  const validCount = Number.isInteger(count) && count >= 1 && count <= 1000
  const rerolledIndices = useMemo(() => new Set(
    current?.rerolls.flatMap((reroll) => reroll.indices) ?? [],
  ), [current])

  const performRoll = () => {
    if (!validCount || !playerId) return
    const result = rollDice({
      count,
      sides,
      ...(threshold === null ? {} : { successThreshold: threshold }),
    }, randomSource)
    setCurrent(result)
    setCurrentRollId(onRecord(playerId, result))
    setRerollValues(new Set())
  }

  const performReroll = () => {
    if (!current || !currentRollId || rerollValues.size === 0) return
    const result = rerollDiceValues(current, [...rerollValues], randomSource)
    setCurrent(result)
    onUpdate(currentRollId, result)
    setRerollValues(new Set())
  }

  return (
    <aside className="dice-panel" aria-label="Dice roller">
      <div className="dice-panel-heading">
        <div><span className="eyebrow">GENERIC DICE</span><h2>Dice Roller</h2></div>
        <button type="button" onClick={onClose} aria-label="Close dice panel">×</button>
      </div>

      <div className="dice-mode-tabs" aria-label="Dice mode">
        <button type="button" className={mode === 'pool' ? 'active' : ''} onClick={() => setMode('pool')}>Pool</button>
        <button type="button" className={mode === 'sequence' ? 'active' : ''} onClick={() => setMode('sequence')}>Sequence</button>
      </div>

      {mode === 'pool' ? <><div className="dice-controls">
        <label><span>Player</span><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
          {players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}
        </select></label>
        <label><span>Count</span><input aria-label="Dice count" type="number" min="1" max="1000" step="1"
          value={countDraft} onChange={(event) => setCountDraft(event.target.value)} /></label>
        <label><span>Die</span><select aria-label="Die type" value={sides} onChange={(event) => {
          const nextSides = Number(event.target.value)
          setSides(nextSides)
          setThreshold((currentThreshold) => currentThreshold !== null && currentThreshold > nextSides
            ? null : currentThreshold)
        }}>
          {DIE_TYPES.map((dieSides) => <option key={dieSides} value={dieSides}>D{dieSides}</option>)}
        </select></label>
        <label><span>Success</span><select aria-label="Success threshold"
          value={threshold ?? ''} onChange={(event) => setThreshold(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Off</option>
          {Array.from({ length: sides - 1 }, (_, index) => index + 2).map((value) => (
            <option key={value} value={value}>{value}+</option>
          ))}
        </select></label>
      </div>
      <div className="dice-quick-counts" aria-label="Quick dice counts">
        {[1, 5, 10, 20, 100].map((value) => <button type="button" key={value}
          className={count === value ? 'active' : ''} onClick={() => setCountDraft(String(value))}>{value}</button>)}
      </div>
      {!validCount && <p className="dice-error">Choose between 1 and 1,000 dice.</p>}
      <button type="button" className="dice-roll-button" disabled={!validCount || !playerId} onClick={performRoll}>
        Roll {validCount ? `${count}D${sides}` : ''}
      </button>

      {current && <div className="dice-current" aria-live="polite">
        <div className="dice-result-summary">
          <strong>{current.count}D{current.sides}</strong>
          <span>Total {current.total}</span>
          {current.successThreshold !== undefined && <span className="dice-successes">
            {current.successes} successes · {current.successThreshold}+
          </span>}
        </div>
        <div className="dice-results" aria-label="Final dice results">
          {current.finalResults.map((value, index) => <span
            className={rerolledIndices.has(index) ? 'rerolled' : ''} key={index}>{value}</span>)}
        </div>
        <div className="dice-distribution" aria-label="Result distribution">
          {Object.entries(current.distribution).map(([value, amount]) => <button type="button" key={value}
            className={rerollValues.has(Number(value)) ? 'active' : ''}
            disabled={amount === 0}
            aria-pressed={rerollValues.has(Number(value))}
            onClick={() => setRerollValues((selected) => toggleValue(selected, Number(value)))}>
            <span>{value}</span><strong>{amount}</strong>
          </button>)}
        </div>
        <button type="button" className="dice-reroll-button" disabled={rerollValues.size === 0}
          onClick={performReroll}>
          Reroll {rerollValues.size === 0 ? 'selected values' : [...rerollValues].sort((a, b) => a - b).join(', ')}
        </button>
        {current.rerolls.length > 0 && <small className="dice-reroll-note">
          {current.rerolls.reduce((sum, reroll) => sum + reroll.indices.length, 0)} dice rerolled across {current.rerolls.length} pass{current.rerolls.length === 1 ? '' : 'es'}
        </small>}
      </div>}</> : <DiceSequenceBuilder players={players} activePlayerId={activePlayerId}
        onRecord={onRecordSequence} randomSource={randomSource} />}

      <DiceHistory history={history} players={players} />
    </aside>
  )
}

function toggleValue(values: Set<number>, value: number): Set<number> {
  const next = new Set(values)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
