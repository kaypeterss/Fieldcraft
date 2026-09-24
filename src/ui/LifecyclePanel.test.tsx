import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LifecyclePanel, type LifecyclePanelEntry } from './LifecyclePanel'

afterEach(cleanup)

const entries: LifecyclePanelEntry[] = [
  { modelId: 'infantry-a1', label: 'Infantry A1', unitId: 'infantry', unitName: 'Standard Infantry', ownerId: 'p1', ownerName: 'Player 1', presence: 'ON_BATTLEFIELD' },
  { modelId: 'infantry-a2', label: 'Infantry A2', unitId: 'infantry', unitName: 'Standard Infantry', ownerId: 'p1', ownerName: 'Player 1', presence: 'ON_BATTLEFIELD' },
  { modelId: 'cavalry-b1', label: 'Cavalry B1', unitId: 'cavalry', unitName: 'Oval Cavalry', ownerId: 'p2', ownerName: 'Player 2', presence: 'OFF_BOARD' },
  { modelId: 'cavalry-b2', label: 'Cavalry B2', unitId: 'cavalry', unitName: 'Oval Cavalry', ownerId: 'p2', ownerName: 'Player 2', presence: 'DESTROYED' },
]

const baseProps = {
  entries,
  selectedIds: new Set<string>(),
  placement: null,
  requireCoherency: false,
  onClose: vi.fn(),
  onInspect: vi.fn(),
  onToggleModel: vi.fn(),
  onSelectModels: vi.fn(),
  onClearSelection: vi.fn(),
  onMoveOffBoard: vi.fn(),
  onDestroy: vi.fn(),
  onPlaceIndividually: vi.fn(),
  onPlaceFormation: vi.fn(),
  onCancelPlacement: vi.fn(),
  onRequireCoherencyChange: vi.fn(),
}

describe('LifecyclePanel', () => {
  it('starts with compact collapsed unit rows and selects an entire unit', () => {
    const onSelectModels = vi.fn()
    render(<LifecyclePanel {...baseProps} onSelectModels={onSelectModels} />)
    expect(screen.getByText('2 models · 2 Battlefield')).toBeTruthy()
    expect(screen.getByText('2 models · 1 Off Board · 1 Destroyed')).toBeTruthy()
    expect(screen.getByText('Player 1')).toBeTruthy()
    expect(screen.getByText('Player 2')).toBeTruthy()
    expect(screen.getByText('ON BATTLEFIELD · 1 units · 2 models')).toBeTruthy()
    expect(screen.queryByText('infantry-a1')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Select Unit' })[0])
    expect(onSelectModels).toHaveBeenCalledWith(['infantry-a1', 'infantry-a2'])
  })

  it('classifies a fully destroyed unit under Destroyed while mixed units stay active-grouped', () => {
    const destroyedUnit: LifecyclePanelEntry = {
      modelId: 'destroyed-c1', label: 'Destroyed C1', unitId: 'destroyed-unit', unitName: 'Destroyed Unit',
      ownerId: 'p2', ownerName: 'Player 2', presence: 'DESTROYED',
    }
    render(<LifecyclePanel {...baseProps} entries={[...entries, destroyedUnit]} />)
    expect(screen.getByText('DESTROYED · 1 units · 1 models')).toBeTruthy()
    expect(screen.getByText('2 models · 1 Off Board · 1 Destroyed')).toBeTruthy()
  })

  it('expands units independently and keeps expansion through entry updates', () => {
    const { rerender } = render(<LifecyclePanel {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Oval Cavalry/ }))
    expect(screen.getByText('cavalry-b1')).toBeTruthy()
    expect(screen.queryByText('infantry-a1')).toBeNull()
    rerender(<LifecyclePanel {...baseProps} entries={entries.map((entry) => entry.modelId === 'cavalry-b1'
      ? { ...entry, presence: 'DESTROYED' as const } : entry)} />)
    expect(screen.getByText('cavalry-b1')).toBeTruthy()
    expect(screen.queryByText('infantry-a1')).toBeNull()
  })

  it('shows counted group actions and coherency control', () => {
    const destroy = vi.fn()
    const coherency = vi.fn()
    render(<LifecyclePanel {...baseProps} selectedIds={new Set(['infantry-a1', 'infantry-a2'])}
      onDestroy={destroy} onRequireCoherencyChange={coherency} />)
    fireEvent.click(screen.getByRole('button', { name: 'Destroy Selected (2)' }))
    expect(destroy).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Require final unit coherency' }))
    expect(coherency).toHaveBeenCalledWith(true)
  })

  it('auto-reveals selected units and distinguishes full versus partial selection', async () => {
    render(<LifecyclePanel {...baseProps} selectedIds={new Set(['infantry-a1'])} />)
    await waitFor(() => expect(screen.getByText('infantry-a1')).toBeTruthy())
    expect(screen.getByText('1 / 2 selected')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Select Unit' }).length).toBeGreaterThan(0)

    cleanup()
    const onSelectModels = vi.fn()
    render(<LifecyclePanel {...baseProps} selectedIds={new Set(['infantry-a1', 'infantry-a2'])} onSelectModels={onSelectModels} />)
    await waitFor(() => expect(screen.getAllByText('✓ Full unit selected').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Selected' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Selected' }))
    expect(onSelectModels).toHaveBeenCalledWith(['infantry-a1', 'infantry-a2'])
  })

  it('auto-reveals off-board selections without requiring battlefield poses', async () => {
    render(<LifecyclePanel {...baseProps} selectedIds={new Set(['cavalry-b1'])} />)
    await waitFor(() => expect(screen.getByText('cavalry-b1')).toBeTruthy())
    expect(screen.getByText('1 / 2 selected')).toBeTruthy()
  })

  it('makes staged atomic placement progress and cancellation explicit', () => {
    const cancel = vi.fn()
    render(<LifecyclePanel {...baseProps} selectedIds={new Set(['cavalry-b1', 'cavalry-b2'])}
      placement={{ mode: 'individual', placedCount: 1, totalCount: 2, coherency: [{ coherent: false, componentCount: 2 }] }} onCancelPlacement={cancel} />)
    expect(screen.getByText('Position 2 of 2 · final commit is atomic')).toBeTruthy()
    expect(screen.getByText('Projected coherency: Invalid · disconnected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel placement' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith()
  })

  it('cancels a fresh formation placement without leaking the click event', () => {
    const cancel = vi.fn()
    render(<LifecyclePanel {...baseProps} selectedIds={new Set(['cavalry-b1', 'cavalry-b2'])}
      placement={{ mode: 'formation', placedCount: 0, totalCount: 2 }} onCancelPlacement={cancel} />)
    expect(screen.getByText('2 models · click to commit formation')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel placement' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith()
  })
})
