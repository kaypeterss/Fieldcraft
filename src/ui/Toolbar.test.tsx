import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from './Toolbar'

afterEach(() => cleanup())

describe('Toolbar interaction layers', () => {
  it('keeps Select active while Spatial is independently enabled', () => {
    render(<Toolbar
      activeTool="select"
      spatialEnabled
      onToolChange={vi.fn()}
      onSpatialToggle={vi.fn()}
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
      onToolChange={onToolChange}
      onSpatialToggle={onSpatialToggle}
      onResetCamera={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Spatial/ }))
    expect(onSpatialToggle).toHaveBeenCalledOnce()
    expect(onToolChange).not.toHaveBeenCalled()
  })
})
