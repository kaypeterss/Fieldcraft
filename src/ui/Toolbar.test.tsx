import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from './Toolbar'

afterEach(() => cleanup())

describe('Toolbar interaction layers', () => {
  it('keeps Select active while Spatial is independently enabled', () => {
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
    expect(screen.getByRole('button', { name: /Spatial/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('toggles Spatial without replacing the primary pointer tool', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Spatial/ }))
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
})
