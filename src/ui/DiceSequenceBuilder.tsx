import { useRef, useState } from 'react'
import type {
  DiceContinuation,
  DiceSequenceDefinition,
  DiceSequenceResolution,
  DiceStageDefinition,
  Player,
} from '../domain/types'
import { systemRandomSource, type RandomSource } from '../engine/dice'
import {
  beginDiceSequence,
  resolveNextDiceStage,
  resolveRemainingDiceSequence,
} from '../engine/diceSequence'

interface DiceSequenceBuilderProps {
  players: readonly Player[]
  activePlayerId: string
  onRecord: (playerId: string, resolution: DiceSequenceResolution) => void
  randomSource?: RandomSource
}

const DIE_TYPES = [4, 6, 8, 10, 12, 20]
const DEFAULT_DEFINITION: DiceSequenceDefinition = {
  id: 'manual-four-stage-check',
  label: 'Four-stage check',
  startingDiceCount: 20,
  stages: [
    stage('stage-a', 'Stage A', 3, 'successes', [1]),
    stage('stage-b', 'Stage B', 4, 'successes'),
    stage('stage-c', 'Stage C', 4, 'failures'),
    stage('stage-d', 'Stage D', 5, 'failures'),
  ],
}

export function DiceSequenceBuilder({
  players,
  activePlayerId,
  onRecord,
  randomSource = systemRandomSource,
}: DiceSequenceBuilderProps) {
  const [definition, setDefinition] = useState<DiceSequenceDefinition>(DEFAULT_DEFINITION)
  const [playerId, setPlayerId] = useState(activePlayerId)
  const [resolution, setResolution] = useState<DiceSequenceResolution | null>(null)
  const nextStageNumber = useRef(5)

  const changeDefinition = (update: (current: DiceSequenceDefinition) => DiceSequenceDefinition) => {
    setDefinition(update)
    setResolution(null)
  }
  const updateStage = (stageId: string, update: (current: DiceStageDefinition) => DiceStageDefinition) => {
    changeDefinition((current) => ({
      ...current,
      stages: current.stages.map((currentStage) => currentStage.id === stageId
        ? update(currentStage) : currentStage),
    }))
  }
  const recordIfComplete = (next: DiceSequenceResolution) => {
    setResolution(next)
    if (next.complete) onRecord(playerId, next)
  }
  const nextStage = () => {
    const current = !resolution || resolution.complete ? beginDiceSequence(definition) : resolution
    recordIfComplete(resolveNextDiceStage(current, randomSource))
  }
  const resolveAll = () => {
    const current = !resolution || resolution.complete ? beginDiceSequence(definition) : resolution
    recordIfComplete(resolveRemainingDiceSequence(current, randomSource))
  }

  return <section className="dice-sequence-builder" aria-label="Chained dice sequence">
    <div className="dice-sequence-header-fields">
      <label><span>Player</span><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
        {players.map((player) => <option value={player.id} key={player.id}>{player.displayName}</option>)}
      </select></label>
      <label><span>Sequence</span><input aria-label="Sequence label" value={definition.label}
        onChange={(event) => changeDefinition((current) => ({ ...current, label: event.target.value }))} /></label>
      <label><span>Starting dice</span><input aria-label="Starting dice count" type="number" min="0" max="1000"
        value={definition.startingDiceCount} onChange={(event) => changeDefinition((current) => ({
          ...current, startingDiceCount: clampInteger(event.target.value, 0, 1000),
        }))} /></label>
    </div>

    <div className="dice-stage-list">
      {definition.stages.map((configuredStage, index) => <div className="dice-stage-config" key={configuredStage.id}>
        <div className="dice-stage-config-heading">
          <strong>Stage {index + 1}</strong>
          {definition.stages.length > 1 && <button type="button" aria-label={`Remove ${configuredStage.label}`}
            onClick={() => changeDefinition((current) => ({
              ...current, stages: current.stages.filter((candidate) => candidate.id !== configuredStage.id),
            }))}>×</button>}
        </div>
        <input aria-label={`Stage ${index + 1} label`} value={configuredStage.label}
          onChange={(event) => updateStage(configuredStage.id, (current) => ({ ...current, label: event.target.value }))} />
        <select aria-label={`Stage ${index + 1} die`} value={configuredStage.sides}
          onChange={(event) => updateStage(configuredStage.id, (current) => {
            const sides = Number(event.target.value)
            return {
              ...current,
              sides,
              threshold: Math.min(current.threshold, sides),
              ...(current.reroll?.values.some((value) => value > sides) ? { reroll: undefined } : {}),
            }
          })}>
          {DIE_TYPES.map((sides) => <option value={sides} key={sides}>D{sides}</option>)}
        </select>
        <select aria-label={`Stage ${index + 1} threshold`} value={configuredStage.threshold}
          onChange={(event) => updateStage(configuredStage.id, (current) => ({
            ...current, threshold: Number(event.target.value),
          }))}>
          {Array.from({ length: configuredStage.sides }, (_, threshold) => threshold + 1).map((threshold) => (
            <option value={threshold} key={threshold}>{threshold}+</option>
          ))}
        </select>
        <select aria-label={`Stage ${index + 1} continuation`} value={configuredStage.continuation}
          onChange={(event) => updateStage(configuredStage.id, (current) => ({
            ...current, continuation: event.target.value as DiceContinuation,
          }))}>
          <option value="successes">Successes continue</option>
          <option value="failures">Failures continue</option>
        </select>
        <select aria-label={`Stage ${index + 1} reroll`} value={configuredStage.reroll?.values[0] ?? 0}
          onChange={(event) => updateStage(configuredStage.id, (current) => {
            const value = Number(event.target.value)
            return { ...current, ...(value === 0 ? { reroll: undefined } : { reroll: { values: [value] } }) }
          })}>
          <option value="0">No reroll</option>
          {Array.from({ length: configuredStage.sides }, (_, value) => value + 1).map((value) => (
            <option value={value} key={value}>Reroll {value}s</option>
          ))}
        </select>
      </div>)}
    </div>
    <button type="button" className="dice-add-stage" onClick={() => {
      const number = nextStageNumber.current
      nextStageNumber.current += 1
      changeDefinition((current) => ({
        ...current,
        stages: [...current.stages, stage(`stage-${number}`, `Stage ${number}`, 4, 'successes')],
      }))
    }}>+ Add stage</button>

    <div className="dice-sequence-actions">
      <button type="button" onClick={nextStage}>{resolution?.complete ? 'Start Again' : 'Next Stage'}</button>
      <button type="button" onClick={resolveAll}>Resolve All</button>
    </div>

    {resolution && <div className="dice-sequence-results" aria-live="polite">
      {resolution.stageResults.map((result) => <details open key={result.stage.id}>
        <summary><strong>{result.stage.label}</strong><span>
          {result.inputDiceCount} dice → {result.continuationCount} {result.stage.continuation === 'successes' ? 'passed' : 'failed'}
        </span></summary>
        <p>D{result.stage.sides} · {result.effectiveThreshold}+ · {result.successCount} passed · {result.failureCount} failed</p>
        <small>{displayResults(result.roll.finalResults)}</small>
        {result.roll.rerolls.length > 0 && <small>
          Rerolled {result.roll.rerolls.reduce((total, reroll) => total + reroll.indices.length, 0)} dice
        </small>}
      </details>)}
      {!resolution.complete && <p className="dice-sequence-pending">
        Next: {resolution.definition.stages[resolution.stageResults.length]?.label}
      </p>}
      {resolution.complete && <div className="dice-sequence-final">Final <strong>{resolution.finalResult}</strong></div>}
    </div>}
  </section>
}

function stage(
  id: string,
  label: string,
  threshold: number,
  continuation: DiceContinuation,
  rerollValues?: number[],
): DiceStageDefinition {
  return {
    id, label, sides: 6, threshold, continuation,
    ...(rerollValues ? { reroll: { values: rerollValues } } : {}),
  }
}

function clampInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)))
}

function displayResults(results: readonly number[]): string {
  return results.length ? results.join(' ') : 'No dice'
}
