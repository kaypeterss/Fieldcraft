import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialGameState } from '../game/initialState'
import { ageOfSigmarGameSystemRegistration, developmentGameSystemRegistration } from '../gameSystem/registeredGameSystems'
import { prepareAgeOfSigmarMatch } from '../gameSystem/ageOfSigmar/prepareAgeOfSigmarMatch'
import { BattlefieldSizeBadge } from './BattlefieldSizeBadge'
import { MatchControls } from './MatchControls'
import { MatchIdentityHeader } from './MatchIdentityHeader'
import { MatchInfoPanel } from './MatchInfoPanel'
import { SaveAsDialog } from './SaveAsDialog'
import { Scoreboard } from './Scoreboard'

afterEach(() => cleanup())

describe('generic Fieldcraft game shell', () => {
  it('uses authoritative prepared and Development battlefield dimensions', () => {
    const setup = ageOfSigmarGameSystemRegistration.createMatch()
    const prepared = prepareAgeOfSigmarMatch(setup)
    const view = render(<BattlefieldSizeBadge battlefield={setup.battlefield} />)
    expect(screen.getByLabelText('Battlefield size').textContent).toContain('44 × 30 IN')
    view.rerender(<BattlefieldSizeBadge battlefield={prepared.battlefield} />)
    expect(screen.getByLabelText('Battlefield size').textContent).toContain('44 × 30 IN')
    view.rerender(<BattlefieldSizeBadge battlefield={initialGameState.battlefield} />)
    expect(screen.getByLabelText('Battlefield size').textContent).toContain('60 × 44 IN')
  })

  it('keeps AoS and Development identity contributions isolated', () => {
    const view = render(<MatchIdentityHeader gameSystemName="Warhammer Age of Sigmar"
      matchName="Alpha" ui={ageOfSigmarGameSystemRegistration.ui} />)
    expect(screen.getByText('Age of Sigmar')).toBeTruthy()
    expect(screen.getByText("What's Yours Is Ours")).toBeTruthy()
    view.rerender(<MatchIdentityHeader gameSystemName="Development Sandbox"
      matchName="QA" ui={developmentGameSystemRegistration.ui} />)
    expect(screen.getByText('Development Sandbox')).toBeTruthy()
    expect(screen.queryByText("What's Yours Is Ours")).toBeNull()
  })

  it('reserves an optional projected-score presentation without changing confirmed score', () => {
    render(<Scoreboard players={initialGameState.players} events={[]}
      projectedScores={{ 'player-1': 5 }} showControls={false} />)
    expect(screen.getAllByText('0 VP')).toHaveLength(2)
    expect(screen.getByText('+5 projected')).toBeTruthy()
  })

  it('opens a visible Save As naming workflow and confirms the entered name', () => {
    const onConfirm = vi.fn()
    render(<SaveAsDialog initialName="Match A Copy" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByLabelText('New match name')
    fireEvent.change(input, { target: { value: 'Match B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Copy' }))
    expect(onConfirm).toHaveBeenCalledWith('Match B')
  })

  it('keeps persistence commands in one compact Match menu', () => {
    const onMatchInfo = vi.fn()
    render(<MatchControls onNewMatch={vi.fn()} onSave={vi.fn()} onLoad={vi.fn()} onSaveAs={vi.fn()}
      onMatchInfo={onMatchInfo} matchName="Match A" gameSystemName="Age of Sigmar"
      missionName="What's Yours Is Ours" />)
    expect(screen.getByText('Match ▾')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save As…' })).toBeTruthy()
    expect(screen.getByText(/Age of Sigmar · What's Yours Is Ours/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Match Info' }))
    expect(onMatchInfo).toHaveBeenCalledOnce()
  })

  it('shows adapter-contributed AoS match facts in the generic Match Info panel', () => {
    const state = ageOfSigmarGameSystemRegistration.createMatch()
    render(<MatchInfoPanel gameSystemName="Warhammer Age of Sigmar" gameState={state}
      ui={ageOfSigmarGameSystemRegistration.ui} onClose={vi.fn()} />)
    expect(screen.getByText("General's Handbook 2026–27")).toBeTruthy()
    expect(screen.getByText("What's Yours Is Ours")).toBeTruthy()
    expect(screen.getByText('24 September 2026')).toBeTruthy()
    expect(screen.getByText('44 × 30″')).toBeTruthy()
    expect(screen.getByText('Stormcast Eternals')).toBeTruthy()
    expect(screen.getByText('Skaven')).toBeTruthy()
  })
})
