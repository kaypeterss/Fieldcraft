import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { initialGameState } from '../game/initialState'
import { getPlayerForModel } from '../game/selectors'
import { DebugPanel } from './DebugPanel'

afterEach(cleanup)

describe('DebugPanel ownership display', () => {
  it('renders the Player display name instead of the raw owner ID', () => {
    const model = initialGameState.models[0]
    render(<DebugPanel model={model} selectedCount={1} ownerDisplayName="Player 1" />)
    expect(screen.getByText('Player 1')).toBeTruthy()
    expect(screen.queryByText('player-1')).toBeNull()
  })

  it('reflects a renamed Player without changing model ownership', () => {
    const state = structuredClone(initialGameState)
    state.players[0].displayName = 'Kay'
    const model = state.models[0]
    render(<DebugPanel model={model} selectedCount={1} ownerDisplayName={getPlayerForModel(state, model)?.displayName} />)
    expect(screen.getByText('Kay')).toBeTruthy()
    expect(model.ownerId).toBe('player-1')
  })
})
