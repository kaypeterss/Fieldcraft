import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareAgeOfSigmarMatch } from '../gameSystem/ageOfSigmar/prepareAgeOfSigmarMatch'
import { createAgeOfSigmarAlphaMatch } from '../gameSystem/ageOfSigmar/ageOfSigmarMatch'
import type { AosDeploymentState } from '../gameSystem/ageOfSigmar/deployment'
import { DeploymentPanel, type DeploymentPlacementView } from './DeploymentPanel'

afterEach(cleanup)

const callbacks = {
  onRollOff: vi.fn(), onChooseAttacker: vi.fn(), onChooseTerritory: vi.fn(), onHoverTerritory: vi.fn(),
  onBeginUnit: vi.fn(), onConfirmPlacement: vi.fn(), onCancelPlacement: vi.fn(), onAdjustModel: vi.fn(),
  onHoverModel: vi.fn(), onSelectFormationPreset: vi.fn(), onRotateFormation: vi.fn(),
  onCycleFormation: vi.fn(), onMoveFormation: vi.fn(),
}

describe('DeploymentPanel M9.3 presentation', () => {
  it('shows every roll-off attempt with player dice and the winner', () => {
    const state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch())
    const deployment: AosDeploymentState = {
      phase: 'CHOOSE_ROLES', rolls: [{ player1: 4, player2: 4 }, { player1: 6, player2: 2 }],
      rollWinnerPlayerId: 'player-1', territoryByPlayerId: {}, deployedUnitIds: [], facts: [],
    }
    render(<DeploymentPanel state={state} deployment={deployment} placement={null} {...callbacks} />)
    expect(screen.getByText('Player 1 won the roll-off')).toBeTruthy()
    expect(screen.getByText('Tie')).toBeTruthy()
    expect(screen.getByText('Decisive roll')).toBeTruthy()
    expect(screen.getAllByText('Player 1:')).toHaveLength(2)
    expect(screen.getAllByText('Player 2:')).toHaveLength(2)
  })

  it('links territory hover/focus to the battlefield preview callback', () => {
    const state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch())
    const deployment: AosDeploymentState = {
      phase: 'CHOOSE_TERRITORY', rolls: [{ player1: 6, player2: 2 }], rollWinnerPlayerId: 'player-1',
      attackerPlayerId: 'player-1', defenderPlayerId: 'player-2', territoryByPlayerId: {}, deployedUnitIds: [], facts: [],
    }
    const onHoverTerritory = vi.fn()
    render(<DeploymentPanel state={state} deployment={deployment} placement={null}
      {...callbacks} onHoverTerritory={onHoverTerritory} />)
    const territory = screen.getByRole('button', { name: 'Choose Territory A' })
    fireEvent.pointerEnter(territory)
    expect(onHoverTerritory).toHaveBeenCalledWith('attacker-territory')
    fireEvent.pointerLeave(territory)
    expect(onHoverTerritory).toHaveBeenLastCalledWith(null)
  })

  it('distinguishes formation validity from placement validity and disables unavailable presets', () => {
    const state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch())
    const deployment: AosDeploymentState = {
      phase: 'DEPLOYING', rolls: [{ player1: 6, player2: 2 }], rollWinnerPlayerId: 'player-1',
      attackerPlayerId: 'player-1', defenderPlayerId: 'player-2', currentPlayerId: 'player-1',
      territoryByPlayerId: { 'player-1': 'attacker-territory', 'player-2': 'defender-territory' },
      deployedUnitIds: [], facts: [],
    }
    const placement: DeploymentPlacementView = {
      unitId: 'sce-liberators', placements: {}, valid: false, locked: true, adjustingModelId: null,
      hoveredModelId: null, reasons: ['Outside territory'], formationPreset: 'compact', formationRotation: 0,
      formationValid: true,
      formationOptions: [
        { id: 'compact', label: 'Compact', available: true },
        { id: 'ranks', label: 'Ranks', available: true },
        { id: 'line', label: 'Line', available: false, reason: 'Endpoints fail coherency.' },
      ],
    }
    render(<DeploymentPanel state={state} deployment={deployment} placement={placement} {...callbacks} />)
    expect(screen.getByText('Illegal placement')).toBeTruthy()
    expect(screen.getByText(/Formation coherency valid/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Line' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
