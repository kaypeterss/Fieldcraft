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
})
