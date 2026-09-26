import { describe, expect, it } from 'vitest'
import type { GameState } from '../../domain/types'
import { exteriorRangeEnvelopeForModels } from '../../engine/spatial'
import { createAosChargePileInDemo } from './chargePileInDemo'
import { aosMeleeAttackRange, aosUnitProfile, type AosActiveFight } from './combat'
import {
  aosAllocationForModel,
  aosCasualtyCandidateModelIds,
  deriveAosFightPresentationFocus,
  targetRangeForProfile,
  type AosFightPresentationFocus,
} from './combatPresentation'

function ratFight(state: GameState, stage: AosActiveFight['stage'] = 'ATTACKS'): AosActiveFight {
  return { unitId: 'skv-rat-ogors', playerId: 'player-2', turnId: state.gameContext.turnId,
    stage, pileInComplete: stage !== 'PILE_IN', resolvedProfileIds: [] }
}

function frontier(state: GameState, focus: AosFightPresentationFocus) {
  const ids = new Set(focus.targetModelIds)
  return exteriorRangeEnvelopeForModels(state.models.filter((model) => ids.has(model.id)), focus.attackRange)
}

function xBounds(loops: ReturnType<typeof frontier>): [number, number] {
  const values = loops.flat().map((point) => point.x)
  return [Math.min(...values), Math.max(...values)]
}

describe('AoS casualty picker presentation', () => {
  const options = [['rat-1', 'rat-3'], ['rat-2', 'rat-3']]

  it('exposes stable authoritative candidate IDs for battlefield and list pickers', () => {
    expect(aosCasualtyCandidateModelIds(options)).toEqual(['rat-1', 'rat-3', 'rat-2'])
  })

  it('selects only the clicked model; coherency correction is a subsequent choice', () => {
    expect(aosAllocationForModel(options, 'rat-2', true)).toEqual(['rat-2'])
    expect(aosAllocationForModel(options, 'not-legal', true)).toBeNull()
  })

  it('uses the same picker to confirm nonlethal unit-level damage without inventing model damage state', () => {
    expect(aosAllocationForModel(options, 'rat-1', false)).toEqual([])
  })
})

describe('target-derived Fight range assistance', () => {
  it('uses active target footprints and the same selected-profile range as eligibility', () => {
    const state = createAosChargePileInDemo(true)
    const focus = deriveAosFightPresentationFocus(state, ratFight(state))!
    expect(focus.targetUnitId).toBe('sce-liberators')
    expect(focus.targetModelIds).toEqual(state.models.filter((model) => model.unitId === 'sce-liberators').map((model) => model.id))
    expect(focus.attackRange).toBe(3)
    expect(frontier(state, focus)).toHaveLength(1)
    const targetBounds = xBounds(frontier(state, focus))
    const attackerBounds = xBounds(exteriorRangeEnvelopeForModels(
      state.models.filter((model) => model.unitId === 'skv-rat-ogors'), focus.attackRange))
    expect(targetBounds[0]).toBeLessThan(attackerBounds[0])
    expect(targetBounds[1]).toBeLessThan(attackerBounds[1])
  })

  it('stays anchored while attackers preview pile-in, but follows target poses and casualties', () => {
    const state = createAosChargePileInDemo(true)
    const fight = ratFight(state, 'PILE_IN')
    const initial = deriveAosFightPresentationFocus(state, fight)!
    const initialFrontier = frontier(state, initial)
    const movedAttacker = { ...state, models: state.models.map((model) => model.id === 'skv-rat-ogors-3'
      ? { ...model, position: { x: 22.8, y: 21 } } : model) }
    const afterPileIn = deriveAosFightPresentationFocus(movedAttacker, fight)!
    expect(frontier(movedAttacker, afterPileIn)).toEqual(initialFrontier)
    expect(afterPileIn.eligibleModelIds).toContain('skv-rat-ogors-3')
    expect(initial.eligibleModelIds).not.toContain('skv-rat-ogors-3')

    const movedTarget = { ...state, models: state.models.map((model) => model.unitId === 'sce-liberators'
      ? { ...model, position: { x: model.position.x + 0.25, y: model.position.y } } : model) }
    const shifted = deriveAosFightPresentationFocus(movedTarget, fight)!
    expect(xBounds(frontier(movedTarget, shifted))[0]).toBeCloseTo(xBounds(initialFrontier)[0] + 0.25)

    const casualty = { ...state, models: state.models.map((model) => model.id === 'sce-liberators-5'
      ? { ...model, presence: 'DESTROYED' as const } : model) }
    const surviving = deriveAosFightPresentationFocus(casualty, fight)!
    expect(surviving.targetModelIds).not.toContain('sce-liberators-5')
    expect(frontier(casualty, surviving)).not.toEqual(initialFrontier)
    const destroyed = { ...state, models: state.models.map((model) => model.unitId === 'sce-liberators'
      ? { ...model, presence: 'DESTROYED' as const } : model) }
    expect(deriveAosFightPresentationFocus(destroyed, fight)).toBeNull()
  })

  it('replaces the frontier when target changes and resolves explicit profile ranges', () => {
    const state = createAosChargePileInDemo(true)
    const withSecondTarget = { ...state, models: state.models.map((model) => model.id === 'sce-knight-questor-1'
      ? { ...model, position: { x: 23, y: 22.5 } } : model) }
    const fight = ratFight(withSecondTarget)
    const defaultFocus = deriveAosFightPresentationFocus(withSecondTarget, fight)!
    const first = deriveAosFightPresentationFocus(withSecondTarget, fight,
      { profileId: defaultFocus.profileId, targetUnitId: 'sce-liberators' })!
    const second = deriveAosFightPresentationFocus(withSecondTarget, fight,
      { profileId: defaultFocus.profileId, targetUnitId: 'sce-knight-questor' })!
    expect(first.targetUnitId).toBe('sce-liberators')
    expect(second.targetUnitId).toBe('sce-knight-questor')
    expect(frontier(withSecondTarget, second)).not.toEqual(frontier(withSecondTarget, first))

    const ratUnit = state.units.find((unit) => unit.id === 'skv-rat-ogors')!
    const profile = aosUnitProfile(state, ratUnit)!.weapons[0]
    expect(aosMeleeAttackRange(profile)).toBe(3)
    const short = targetRangeForProfile(state.models, 'sce-liberators', { ...profile, range: 2 })!
    const long = targetRangeForProfile(state.models, 'sce-liberators', { ...profile, range: 4 })!
    expect(short.attackRange).toBe(2)
    expect(long.attackRange).toBe(4)
    const shortBounds = xBounds(exteriorRangeEnvelopeForModels(state.models.filter((model) => short.targetModelIds.includes(model.id)), short.attackRange))
    const longBounds = xBounds(exteriorRangeEnvelopeForModels(state.models.filter((model) => long.targetModelIds.includes(model.id)), long.attackRange))
    expect(longBounds[0]).toBeCloseTo(shortBounds[0] - 2)
  })

  it('keeps disconnected target components separate', () => {
    const state = createAosChargePileInDemo(true)
    const farTargets = state.models.filter((model) => model.unitId === 'sce-liberators').map((model, index) => ({
      ...model, position: { x: index * 12 + 3, y: 12 },
    }))
    expect(exteriorRangeEnvelopeForModels(farTargets, 3)).toHaveLength(5)
  })
})
