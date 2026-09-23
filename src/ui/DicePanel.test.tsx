import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RandomSource } from '../engine/dice'
import type { DiceSequenceResolution } from '../domain/types'
import { DicePanel } from './DicePanel'

afterEach(() => cleanup())

describe('DicePanel', () => {
  it('rolls, displays successes, and updates the same history roll on reroll', () => {
    const values = [0, .5, .99, ...Array(17).fill(.5), .8]
    let index = 0
    const randomSource: RandomSource = { next: () => values[index++] }
    const onRecord = vi.fn(() => 'dice-1')
    const onUpdate = vi.fn()
    render(<DicePanel players={[{ id: 'p1', displayName: 'Player 1' }]}
      activePlayerId="p1" history={[]} onClose={vi.fn()} onRecord={onRecord}
      onUpdate={onUpdate} onRecordSequence={vi.fn()} randomSource={randomSource} />)

    fireEvent.change(screen.getByLabelText('Success threshold'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Roll 20D6' }))
    expect(onRecord).toHaveBeenCalledOnce()
    expect(screen.getByText(/19 successes/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^1\s*1$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Reroll 1/ }))
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0]).toBe('dice-1')
    expect(onUpdate.mock.calls[0][1].originalResults[0]).toBe(1)
    expect(onUpdate.mock.calls[0][1].finalResults[0]).toBe(5)
  })

  it('supports Next Stage and Resolve All for a chained sequence', () => {
    const randomSource: RandomSource = { next: () => .99 }
    const onRecordSequence = vi.fn()
    render(<DicePanel players={[{ id: 'p1', displayName: 'Player 1' }]}
      activePlayerId="p1" history={[]} onClose={vi.fn()} onRecord={vi.fn(() => 'dice-1')}
      onUpdate={vi.fn()} onRecordSequence={onRecordSequence} randomSource={randomSource} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sequence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next Stage' }))
    expect(screen.getByText('20 dice → 20 passed')).toBeTruthy()
    expect(screen.getByText('Next: Stage B')).toBeTruthy()
    expect(onRecordSequence).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Resolve All' }))
    expect(screen.getByText('Final').parentElement?.textContent).toContain('0')
    expect(onRecordSequence).toHaveBeenCalledOnce()
    const resolution = onRecordSequence.mock.calls[0][1] as DiceSequenceResolution
    expect(resolution.stageResults.map((stage) => stage.inputDiceCount))
      .toEqual([20, 20, 20, 0])
  })
})
