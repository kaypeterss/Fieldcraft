import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ageOfSigmarGameSystemRegistration } from '../gameSystem/registeredGameSystems'
import { GameSystemStatusPanel } from './GameSystemStatusPanel'

afterEach(() => cleanup())

describe('GameSystemStatusPanel setup action', () => {
  it('offers Prepare Match during setup and invokes the adapter-owned transition', () => {
    const onPrepare = vi.fn()
    render(<GameSystemStatusPanel ui={ageOfSigmarGameSystemRegistration.ui}
      gameState={ageOfSigmarGameSystemRegistration.createMatch({ matchName: 'AoS Alpha' })}
      onPrepare={onPrepare} />)
    expect(screen.getByText('SETUP')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Match' }))
    expect(onPrepare).toHaveBeenCalledOnce()
  })

  it('renders an adapter-supplied authoritative progression action', () => {
    const onAction = vi.fn()
    render(<GameSystemStatusPanel ui={ageOfSigmarGameSystemRegistration.ui}
      gameState={ageOfSigmarGameSystemRegistration.createMatch()}
      progression={{ lifecycle: 'ROUND 2 · TURN 1', title: 'Player 2 · Movement Phase',
        actionLabel: 'End Movement Phase', onAction }} />)
    expect(screen.getByText('ROUND 2 · TURN 1')).toBeTruthy()
    expect(screen.getByText('Player 2 · Movement Phase')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'End Movement Phase' }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('shows compact adapter-derived player resource metrics without owning their state', () => {
    render(<GameSystemStatusPanel ui={ageOfSigmarGameSystemRegistration.ui}
      gameState={ageOfSigmarGameSystemRegistration.createMatch()}
      playerMetrics={{
        'player-1': [{ label: 'CP', value: 4 }, { label: 'Fury', value: 1 }],
        'player-2': [{ label: 'CP', value: 5 }, { label: 'Fury', value: 2 }],
      }} />)
    expect(screen.getByText('CP 4')).toBeTruthy()
    expect(screen.getByText('Fury 1')).toBeTruthy()
    expect(screen.getByText('CP 5')).toBeTruthy()
    expect(screen.getByText('Fury 2')).toBeTruthy()
  })
})
