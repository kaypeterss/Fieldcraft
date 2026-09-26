import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DicePoolResult, DiceSequenceResolution } from '../domain/types'
import type { AosActiveFight } from '../gameSystem/ageOfSigmar/combat'
import { aosAttackProfileOptions } from '../gameSystem/ageOfSigmar/combat'
import type { AosCombatDiceReview } from '../gameSystem/ageOfSigmar/combatDicePresentation'
import { createAosChargePileInDemo } from '../gameSystem/ageOfSigmar/chargePileInDemo'
import { AosCombatPanel, type AosCombatPanelProps } from './AosCombatPanel'

afterEach(cleanup)

const pool = (results: number[], threshold: number): DicePoolResult => ({
  count: results.length, sides: 6, originalResults: results, rerolls: [], finalResults: results,
  total: results.reduce((sum, value) => sum + value, 0), distribution: {}, successThreshold: threshold,
  successes: results.filter((value) => value >= threshold).length,
})

const resolution: DiceSequenceResolution = {
  definition: { id: 'attack', label: 'Attack', startingDiceCount: 3, stages: [
    { id: 'hit', label: 'Hit', sides: 6, threshold: 4, continuation: 'successes' },
    { id: 'wound', label: 'Wound', sides: 6, threshold: 3, continuation: 'successes' },
  ] },
  stageResults: [
    { stage: { id: 'hit', label: 'Hit', sides: 6, threshold: 4, continuation: 'successes' }, inputDiceCount: 3,
      effectiveThreshold: 4, roll: pool([6, 4, 1], 4), successCount: 2, failureCount: 1, continuationCount: 2 },
    { stage: { id: 'wound', label: 'Wound', sides: 6, threshold: 3, continuation: 'successes' }, inputDiceCount: 2,
      effectiveThreshold: 3, roll: pool([5, 2], 3), successCount: 1, failureCount: 1, continuationCount: 1 },
  ], complete: true, finalResult: 1,
}

const review: AosCombatDiceReview = {
  attackerUnitId: 'stormcast', profileId: 'hammer', targetUnitId: 'skaven', sequenceRecordId: 'dice-sequence-1', resolution,
}

const fight: AosActiveFight = {
  unitId: 'stormcast', playerId: 'p1', turnId: 'turn-1', stage: 'ALLOCATE_DAMAGE', pileInComplete: true,
  resolvedProfileIds: [], pendingDamage: { attackerUnitId: 'stormcast', targetUnitId: 'skaven', profileId: 'hammer',
    sequenceRecordId: 'dice-sequence-1', attacks: 3, hits: 2, criticalMortalHits: 0, wounds: 1, saved: 0,
    unsaved: 1, grossDamage: 2, wardPrevented: 0, remaining: 2, slainModelIds: [] },
}

function props(overrides: Partial<AosCombatPanelProps> = {}): AosCombatPanelProps {
  return {
    unitName: 'Liberators', playerName: 'Player 1', availability: { eligible: true, alreadyFought: false, inCombat: true, charged: false },
    fight, profiles: [], targetNames: { skaven: 'Clanrats' }, allocatedDamage: 0, targetHealth: 2,
    allocationOptions: [['rat-1'], ['rat-2']], casualtyCandidateModelIds: ['rat-1', 'rat-2'],
    modelNames: { 'rat-1': 'Clanrat 1', 'rat-2': 'Clanrat 2' }, diceMode: 'quick', diceReview: review,
    revealedDiceStage: 0, onStartFight: vi.fn(), onBeginPileIn: vi.fn(), onCompletePileIn: vi.fn(),
    onDeclareAttacks: vi.fn(), onResolveAttacks: vi.fn(), onDiceModeChange: vi.fn(), onNextDiceStage: vi.fn(),
    onCasualtyModelChoose: vi.fn(), onConfirmUnitDamage: vi.fn(), onCasualtyModelHover: vi.fn(), onProfileFocus: vi.fn(), onClose: vi.fn(),
    ...overrides,
  }
}

describe('AoS combat dice and casualty UX', () => {
  it('shows quick summary and the exact authoritative result values', () => {
    render(<AosCombatPanel {...props()} />)
    expect(screen.getByText('DICE RESULT')).toBeTruthy()
    expect(screen.getAllByLabelText(/dice results/)[0].textContent).toBe('641')
    expect(screen.getByText(/2 successes/)).toBeTruthy()
  })

  it('shows one exact pool at a time in Step Through without invoking resolution', () => {
    const onNext = vi.fn()
    render(<AosCombatPanel {...props({ diceMode: 'step', onNextDiceStage: onNext })} />)
    expect(screen.getByText('DICE · 1 / 2')).toBeTruthy()
    expect(screen.getByLabelText('Hit dice results').textContent).toBe('641')
    expect(screen.queryByLabelText('Wound dice results')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next Pool' }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('links compact casualty candidates to battlefield hover and model choice callbacks', () => {
    const onChoose = vi.fn()
    const onHover = vi.fn()
    render(<AosCombatPanel {...props({ hoveredModelId: 'rat-2', onCasualtyModelChoose: onChoose, onCasualtyModelHover: onHover })} />)
    const candidate = screen.getByRole('button', { name: 'Clanrat 2' })
    expect(candidate.className).toContain('model-linked')
    fireEvent.mouseEnter(candidate)
    expect(onHover).toHaveBeenCalledWith('rat-2')
    fireEvent.click(candidate)
    expect(onChoose).toHaveBeenCalledWith('rat-2')
  })

  it('confirms partial damage on the unit without asking for a model recipient', () => {
    const onConfirm = vi.fn()
    render(<AosCombatPanel {...props({ targetHealth: 5, casualtyCandidateModelIds: [], onConfirmUnitDamage: onConfirm })} />)
    expect(screen.queryByRole('button', { name: 'Clanrat 1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Allocate damage to unit' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('shows current damage as a unit fact rather than a wounded model', () => {
    render(<AosCombatPanel {...props({ fight: undefined,
      unitDamage: { healthThreshold: 2, currentDamage: 1, untilNextSlain: 1 } })} />)
    expect(screen.getByText('Current unit damage')).toBeTruthy()
    expect(screen.getByText('Until next model slain')).toBeTruthy()
    expect(screen.getByLabelText('Selected unit damage').textContent).toContain('1 / 2')
    expect(screen.getByLabelText('Selected unit damage').textContent).toContain('1 more damage')
  })

  it('keeps an explicitly selected target as the range focus after leaving its weapon card', () => {
    const state = createAosChargePileInDemo(true)
    const profile = aosAttackProfileOptions(state, 'skv-rat-ogors')[0]
    const onProfileFocus = vi.fn()
    render(<AosCombatPanel {...props({
      fight: { ...fight, stage: 'ATTACKS', pendingDamage: undefined },
      profiles: [{ ...profile, eligibleTargetUnitIds: ['sce-liberators', 'sce-knight-questor'] }],
      targetNames: { 'sce-liberators': 'Liberators', 'sce-knight-questor': 'Knight-Questor' },
      onProfileFocus,
    })} />)
    const target = screen.getByRole('combobox', { name: 'Target' })
    fireEvent.change(target, { target: { value: 'sce-knight-questor' } })
    fireEvent.mouseLeave(target.closest('article')!)
    expect(onProfileFocus).toHaveBeenLastCalledWith(profile.profile.id, 'sce-knight-questor')
  })
})
