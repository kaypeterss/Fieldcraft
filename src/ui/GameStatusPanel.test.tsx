import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../domain/types'
import { initialGameState } from '../game/initialState'
import { gameReducer } from '../state/reducer'
import { GameStatusPanel } from './GameStatusPanel'

afterEach(() => cleanup())

function freshState(): GameState {
  return JSON.parse(JSON.stringify(initialGameState)) as GameState
}

describe('game status turn display', () => {
  it('shows configured turn indexes that reset within each round', () => {
    let state = freshState()
    const view = render(<GameStatusPanel gameState={state} blockedMessage={null} onEndTurn={vi.fn()} />)
    for (const expected of ['R1/T1', 'R1/T2', 'R2/T1', 'R2/T2', 'R3/T1', 'R3/T2']) {
      view.rerender(<GameStatusPanel gameState={state} blockedMessage={null} onEndTurn={vi.fn()} />)
      expect(screen.getByText(expected)).toBeTruthy()
      state = gameReducer(state, { type: 'game/turnEnded' })
    }
  })

  it('shows an action with its round and human-readable turn context', () => {
    let state = freshState()
    for (let index = 0; index < 4; index += 1) state = gameReducer(state, { type: 'game/turnEnded' })
    state = gameReducer(state, {
      type: 'movement/sessionStarted', sessionId: 'round-three-move', modelIds: ['mdl-a-001'],
    })
    state = gameReducer(state, {
      type: 'movement/requested', positions: { 'mdl-a-001': { x: 8.5, y: 9 } },
    })
    state = gameReducer(state, { type: 'movement/confirmed' })
    render(<GameStatusPanel gameState={state} blockedMessage={null} onEndTurn={vi.fn()} />)
    expect(screen.getByText('R3/T1')).toBeTruthy()
    expect(screen.getByText(/Line Infantry · Player 1 · R3\/T1/)).toBeTruthy()
  })
})
