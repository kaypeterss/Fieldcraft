import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AosMovementPanel } from './AosMovementPanel'

afterEach(() => cleanup())

describe('Age of Sigmar movement panel', () => {
  it('separates the declared action from manual and Smart movement methods', () => {
    const onMethodChange = vi.fn()
    render(<AosMovementPanel
      unitName="Liberators"
      moveCharacteristic={5}
      availability={{
        available: ['NORMAL_MOVE', 'RUN'], inCombat: false,
        selected: {
          actionId: 'RUN', unitId: 'liberators', playerId: 'player-1',
          turnId: 'turn-1', phase: 'MOVEMENT_PHASE', rollResult: 4, rollRecordId: 'dice-1',
        },
      }}
      summary={null}
      activeMethod="manual"
      onChoose={vi.fn()}
      onMethodChange={onMethodChange}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(screen.getByText('Base Move').parentElement?.textContent).toContain('5″')
    expect(screen.getByText('Run Roll').parentElement?.textContent).toContain('+4″')
    expect(screen.getByText('Allowance').parentElement?.textContent).toContain('9″')
    expect(screen.getByText('Remaining').parentElement?.textContent).toContain('9″')
    expect(screen.getByText('RAN THIS TURN')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Smart Move' }))
    expect(onMethodChange).toHaveBeenCalledWith('smart')
  })

  it('keeps movement methods unavailable until an action is declared', () => {
    render(<AosMovementPanel
      unitName="Liberators"
      moveCharacteristic={5}
      availability={{ available: ['NORMAL_MOVE', 'RUN'], inCombat: false }}
      summary={null}
      onChoose={vi.fn()}
      onMethodChange={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onClose={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: 'Manual Move' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Smart Move' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows individual Charge dice and a selectable Pile-in target', () => {
    const onTargetUnitChange = vi.fn()
    const { rerender } = render(<AosMovementPanel
      unitName="Liberators" moveCharacteristic={5}
      availability={{ available: ['CHARGE'], inCombat: false, selected: {
        actionId: 'CHARGE', unitId: 'liberators', playerId: 'player-1', turnId: 'turn-1',
        phase: 'CHARGE_PHASE', rollResult: 7, rollResults: [3, 4], rollRecordId: 'dice-1',
      } }} summary={null} onChoose={vi.fn()} onMethodChange={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}
    />)
    expect(screen.getByText('Charge Roll').parentElement?.textContent).toContain('3 + 4 = 7″')
    expect(screen.getByText('Allowance').parentElement?.textContent).toContain('7″')

    rerender(<AosMovementPanel
      unitName="Liberators" moveCharacteristic={5}
      availability={{ available: ['PILE_IN'], inCombat: true, eligibleTargetUnitIds: ['enemy'], selected: {
        actionId: 'PILE_IN', unitId: 'liberators', playerId: 'player-1', turnId: 'turn-1',
        phase: 'COMBAT_PHASE', targetUnitId: 'enemy',
      } }} targetUnits={[{ id: 'enemy', name: 'Clanrats' }]} summary={null}
      onChoose={vi.fn()} onMethodChange={vi.fn()} onTargetUnitChange={onTargetUnitChange}
      onConfirm={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}
    />)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('enemy')
  })
})
