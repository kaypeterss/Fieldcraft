import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoherencyPolicy } from '../engine/coherency'
import { normalizeNumericDraft } from './numberInput'
import { SpatialPanel } from './SpatialPanel'

afterEach(() => cleanup())

const policy: CoherencyPolicy = { distance: 1, requiredNeighbors: 1 }

function renderPanel(overrides: Partial<Parameters<typeof SpatialPanel>[0]> = {}) {
  const props: Parameters<typeof SpatialPanel>[0] = {
    mode: 'range',
    range: 3,
    requiredSeparation: 3,
    targetBaseDiameterMm: 32,
    coherencyPolicy: policy,
    coherency: null,
    sourceCount: 1,
    coherencyUnitAvailable: false,
    onModeChange: vi.fn(),
    onRangeChange: vi.fn(),
    onRequiredSeparationChange: vi.fn(),
    onTargetBaseDiameterChange: vi.fn(),
    onCoherencyPolicyChange: vi.fn(),
    ...overrides,
  }
  render(<SpatialPanel {...props} />)
  return props
}

describe('spatial numeric input editing', () => {
  it('allows a draft to be empty and replaces 3 with 12 without a leading zero', () => {
    const props = renderPanel()
    const input = screen.getByLabelText('Custom range')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.change(input, { target: { value: '12' } })
    expect((input as HTMLInputElement).value).toBe('12')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRangeChange).toHaveBeenLastCalledWith(12)
  })

  it('accepts decimal range values and preserves the active value on empty commit', () => {
    const props = renderPanel()
    const input = screen.getByLabelText('Custom range')
    fireEvent.change(input, { target: { value: '2.5' } })
    fireEvent.blur(input)
    expect(props.onRangeChange).toHaveBeenLastCalledWith(2.5)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(props.onRangeChange).toHaveBeenLastCalledWith(2.5)
  })

  it('normalizes invalid and negative committed values without NaN', () => {
    expect(normalizeNumericDraft('', { min: 0, fallback: 3 })).toBe(3)
    expect(normalizeNumericDraft('not-a-number', { min: 0, fallback: 3 })).toBe(3)
    expect(normalizeNumericDraft('-5', { min: 0, fallback: 3 })).toBe(0)
    expect(normalizeNumericDraft('2.5', { min: 0, fallback: 3 })).toBe(2.5)
    expect(normalizeNumericDraft('1.9', { min: 0, integer: true, fallback: 1 })).toBe(1)
    expect(Number.isNaN(normalizeNumericDraft('', { min: 0, fallback: 3 }))).toBe(false)
  })

  it('updates custom range and allows a preset to replace it', () => {
    const props = renderPanel()
    const input = screen.getByLabelText('Custom range')
    fireEvent.change(input, { target: { value: '7.5' } })
    fireEvent.blur(input)
    expect(props.onRangeChange).toHaveBeenLastCalledWith(7.5)
    fireEvent.click(screen.getByRole('button', { name: '3″' }))
    expect(props.onRangeChange).toHaveBeenLastCalledWith(3)
  })

  it('keeps Enter inside the input instead of bubbling to movement shortcuts', () => {
    const parentKeyDown = vi.fn()
    render(
      <div onKeyDown={parentKeyDown}>
        <SpatialPanel
          mode="range"
          range={3}
          requiredSeparation={3}
          targetBaseDiameterMm={32}
          coherencyPolicy={policy}
          coherency={null}
          sourceCount={1}
          coherencyUnitAvailable={false}
          onModeChange={vi.fn()}
          onRangeChange={vi.fn()}
          onRequiredSeparationChange={vi.fn()}
          onTargetBaseDiameterChange={vi.fn()}
          onCoherencyPolicyChange={vi.fn()}
        />
      </div>,
    )
    const input = screen.getByLabelText('Custom range')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('commits exclusion distance decimals and integer neighbor counts separately', () => {
    const separation = vi.fn()
    renderPanel({ mode: 'exclusion', onRequiredSeparationChange: separation })
    const separationInput = screen.getByLabelText('Required separation')
    fireEvent.change(separationInput, { target: { value: '2.5' } })
    fireEvent.blur(separationInput)
    expect(separation).toHaveBeenLastCalledWith(2.5)

    const coherency = vi.fn()
    cleanup()
    renderPanel({ mode: 'coherency', onCoherencyPolicyChange: coherency })
    const neighborInput = screen.getByLabelText('Required neighbors')
    fireEvent.change(neighborInput, { target: { value: '' } })
    fireEvent.change(neighborInput, { target: { value: '2' } })
    fireEvent.keyDown(neighborInput, { key: 'Enter' })
    expect(coherency).toHaveBeenLastCalledWith({ distance: 1, requiredNeighbors: 2 })
    fireEvent.change(neighborInput, { target: { value: '-2.5' } })
    fireEvent.blur(neighborInput)
    expect(coherency).toHaveBeenLastCalledWith({ distance: 1, requiredNeighbors: 0 })
  })
})
