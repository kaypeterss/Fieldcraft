import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from './Toolbar'

afterEach(() => cleanup())

describe('Toolbar interaction layers', () => {
  it('keeps Select active while Analysis is independently enabled', () => {
    render(<Toolbar
      activeTool="select"
      spatialEnabled
      diceOpen={false}
      lifecycleOpen={false}
      onToolChange={vi.fn()}
      onSpatialToggle={vi.fn()}
      onDiceToggle={vi.fn()}
      onLifecycleToggle={vi.fn()}
      onResetCamera={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: /Select/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Analysis/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('represents Smart Move, Analysis overlay state, and the viewed panel independently', () => {
    render(<Toolbar
      activeTool="smart-move"
      spatialEnabled
      spatialPanelOpen
      diceOpen={false}
      lifecycleOpen={false}
      onToolChange={vi.fn()}
      onSpatialToggle={vi.fn()}
      onDiceToggle={vi.fn()}
      onLifecycleToggle={vi.fn()}
      onResetCamera={vi.fn()}
    />)

    const spatial = screen.getByRole('button', { name: /Analysis/ })
    expect(screen.getByRole('button', { name: /Smart Move/ }).getAttribute('aria-pressed')).toBe('true')
    expect(spatial.getAttribute('aria-pressed')).toBe('true')
    expect(spatial.classList.contains('panel-open')).toBe(true)
    expect(spatial.classList.contains('state-active')).toBe(true)
  })

  it('toggles Analysis without replacing the primary pointer tool', () => {
    const onToolChange = vi.fn()
    const onSpatialToggle = vi.fn()
    render(<Toolbar
      activeTool="select"
      spatialEnabled={false}
      diceOpen={false}
      lifecycleOpen={false}
      onToolChange={onToolChange}
      onSpatialToggle={onSpatialToggle}
      onDiceToggle={vi.fn()}
      onLifecycleToggle={vi.fn()}
      onResetCamera={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Analysis/ }))
    expect(onSpatialToggle).toHaveBeenCalledOnce()
    expect(onToolChange).not.toHaveBeenCalled()
  })

  it('opens Dice without replacing the primary pointer tool', () => {
    const onToolChange = vi.fn()
    const onDiceToggle = vi.fn()
    render(<Toolbar activeTool="select" spatialEnabled={false} diceOpen={false} lifecycleOpen={false}
      onToolChange={onToolChange} onSpatialToggle={vi.fn()} onDiceToggle={onDiceToggle}
      onLifecycleToggle={vi.fn()}
      onResetCamera={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Dice/ }))
    expect(onDiceToggle).toHaveBeenCalledOnce()
    expect(onToolChange).not.toHaveBeenCalled()
  })

  it('opens Lifecycle without replacing the primary pointer tool', () => {
    const onToolChange = vi.fn()
    const onLifecycleToggle = vi.fn()
    render(<Toolbar activeTool="select" spatialEnabled={false} diceOpen={false} lifecycleOpen={false}
      onToolChange={onToolChange} onSpatialToggle={vi.fn()} onDiceToggle={vi.fn()}
      onLifecycleToggle={onLifecycleToggle} onResetCamera={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Lifecycle/ }))
    expect(onLifecycleToggle).toHaveBeenCalledOnce()
    expect(onToolChange).not.toHaveBeenCalled()
  })

  it('hides unsupported gameplay controls for an identity-only GameSystem shell', () => {
    render(<Toolbar activeTool="select" spatialEnabled={false} diceOpen={false} lifecycleOpen={false}
      gameplayToolsEnabled={false}
      onToolChange={vi.fn()} onSpatialToggle={vi.fn()} onDiceToggle={vi.fn()}
      onLifecycleToggle={vi.fn()} onResetCamera={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Select/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Analysis/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Smart Move/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Dice/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Lifecycle/ })).toBeNull()
  })

  it('can expose Lifecycle without exposing gameplay tools', () => {
    render(<Toolbar activeTool="select" spatialEnabled={false} diceOpen={false} lifecycleOpen={false}
      gameplayToolsEnabled={false} lifecycleEnabled
      onToolChange={vi.fn()} onSpatialToggle={vi.fn()} onDiceToggle={vi.fn()}
      onLifecycleToggle={vi.fn()} onResetCamera={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Smart Move/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Dice/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Lifecycle/ })).toBeTruthy()
  })

  it('keeps Move visible but explains when no movement action is ready', () => {
    render(<Toolbar activeTool="select" spatialEnabled={false} diceOpen={false} lifecycleOpen={false}
      gameplayToolsEnabled moveEnabled={false} moveDisabledReason="Choose an action first."
      smartMoveEnabled={false} smartMoveDisabledReason="Choose an action first."
      onToolChange={vi.fn()} onSpatialToggle={vi.fn()} onDiceToggle={vi.fn()}
      onLifecycleToggle={vi.fn()} onResetCamera={vi.fn()} />)
    const move = screen.getByRole('button', { name: /^Move/ })
    expect(move.hasAttribute('disabled')).toBe(true)
    expect(move.getAttribute('title')).toBe('Choose an action first.')
  })
})
