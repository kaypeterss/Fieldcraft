import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gameSystemRegistry } from '../gameSystem/registeredGameSystems'
import { NewMatchDialog } from './NewMatchDialog'

afterEach(() => cleanup())

describe('NewMatchDialog', () => {
  it('creates the exact selected adapter and exposes its registered setup metadata', () => {
    const onCreate = vi.fn()
    render(<NewMatchDialog registrations={gameSystemRegistry.list()} onCreate={onCreate} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Warhammer Age of Sigmar/ }))
    expect(screen.getByText('24 September 2026')).toBeTruthy()
    expect(screen.getByText("General's Handbook 2026–27")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create Match' }))
    expect(onCreate).toHaveBeenCalledWith('age-of-sigmar', 'adapter-v1', '')
  })
})
