import { describe, expect, it } from 'vitest'
import { millimetersToInches } from '../engine/units'
import type { TabletopModel } from '../domain/types'
import { ageOfSigmarGameSystemRegistration } from '../gameSystem/registeredGameSystems'
import { prepareAgeOfSigmarMatch } from '../gameSystem/ageOfSigmar/prepareAgeOfSigmarMatch'
import { initialGameState } from '../game/initialState'
import {
  defaultBoardOverlayPreferences,
  fightRangeAssistanceVisible,
  deploymentZonesVisible,
  deriveActionFocusPresentation,
  deriveUnitBattlefieldPresentations,
  movementStatusPresentation,
  objectiveControlAreaPresentation,
  PRESENTATION_ANNOTATION_EVENT_MODE,
  targetUnitFootprintEnvelopes,
} from './battlefieldPresentation'

describe('objective control-zone presentation', () => {
  it('always uses the authoritative objective area and only changes visual emphasis', () => {
    const prepared = prepareAgeOfSigmarMatch(ageOfSigmarGameSystemRegistration.createMatch())
    const feature = prepared.battlefieldFeatures!.find((candidate) => candidate.capabilities.objective)!
    const permanent = objectiveControlAreaPresentation(feature)
    const selected = objectiveControlAreaPresentation(feature, true, true)
    expect(permanent?.footprint).toEqual(feature.capabilities.objective?.area.type === 'local-footprint'
      ? feature.capabilities.objective.area.footprint : undefined)
    expect(permanent?.footprint.shape).toBe('circle')
    if (permanent?.footprint.shape === 'circle') {
      expect(millimetersToInches(permanent.footprint.diameterMm)).toBeCloseTo((40 / 25.4) + 6)
    }
    expect(selected?.footprint).toEqual(permanent?.footprint)
    expect(selected!.strokeAlpha).toBeGreaterThan(permanent!.strokeAlpha)
  })
})

describe('battlefield readability presentation', () => {
  it('declares all presentation annotations pointer-transparent', () => {
    expect(PRESENTATION_ANNOTATION_EVENT_MODE).toBe('none')
  })
  it('derives one stable label per active unit instead of one per model', () => {
    const unit = initialGameState.units[0]
    const presentations = deriveUnitBattlefieldPresentations(initialGameState, [{
      unitId: unit.id,
      kind: 'RUN',
      label: 'MOVED — RUN',
      baseMove: 6,
      rollResult: 4,
      allowance: 10,
    }])
    const presentation = presentations.find((entry) => entry.unitId === unit.id)!
    expect(presentation.modelIds).toEqual(unit.modelIds)
    expect(presentation.name).toBeTruthy()
    expect(presentation.statusIcon).toBe('R')
    expect(presentation.statusDetail).toContain('Run roll 4')
  })

  it('uses distinct non-color status symbols and concise details', () => {
    expect(movementStatusPresentation({ unitId: 'u', kind: 'READY', label: '', baseMove: 5, allowance: 5 }))
      .toMatchObject({ statusIcon: '◇', statusLabel: 'Ready to move' })
    expect(movementStatusPresentation({ unitId: 'u', kind: 'NORMAL_MOVE', label: '', baseMove: 5, allowance: 5 }))
      .toMatchObject({ statusIcon: '✓', statusLabel: 'Moved — Normal' })
    expect(movementStatusPresentation({ unitId: 'u', kind: 'RETREAT', label: '', baseMove: 5, rollResult: 2, allowance: 5 }))
      .toMatchObject({ statusIcon: '↩', statusLabel: 'Moved — Retreat' })
  })

  it('automatically shows deployment zones only while deployment is active', () => {
    expect(deploymentZonesVisible(true, false)).toBe(true)
    expect(deploymentZonesVisible(false, false)).toBe(false)
    expect(deploymentZonesVisible(false, true)).toBe(true)
  })

  it('defaults competitive labels off while keeping rule assistance and objectives on', () => {
    expect(defaultBoardOverlayPreferences(false)).toMatchObject({
      terrainLabels: false,
      objectiveLabels: false,
      objectiveAreas: true,
      automaticRuleAssistance: true,
    })
  })

  it('hides Fight assistance without changing its target facts', () => {
    const targetIds = ['target-model']
    expect(fightRangeAssistanceVisible(true, targetIds)).toBe(true)
    expect(fightRangeAssistanceVisible(false, targetIds)).toBe(false)
    expect(targetIds).toEqual(['target-model'])
    expect(fightRangeAssistanceVisible(true, [])).toBe(false)
  })

  it('derives restrained action focus from authoritative IDs and clears it when the action ends', () => {
    const acting = initialGameState.units[0]
    const target = initialGameState.units[1]
    const focus = deriveActionFocusPresentation(initialGameState, {
      actingUnitId: acting.id,
      targetUnitIds: [target.id],
      targetEnvelopeUnitIds: [target.id],
      eligibleModelIds: [acting.modelIds[0]],
      profileModelIds: acting.modelIds.slice(0, 2),
      casualtyCandidateModelIds: target.modelIds.slice(0, 2),
      casualtySelectedModelIds: [target.modelIds[0]],
    })
    expect(focus).toMatchObject({
      actingUnitId: acting.id,
      actingModelIds: acting.modelIds,
      targetUnitIds: [target.id],
      targetEnvelopeUnitIds: [target.id],
      eligibleModelIds: [acting.modelIds[0]],
      profileModelIds: acting.modelIds.slice(0, 2),
      casualtyCandidateModelIds: target.modelIds.slice(0, 2),
      casualtySelectedModelIds: [target.modelIds[0]],
    })
    expect(focus?.targetModelIds).toEqual(target.modelIds)
    expect(deriveActionFocusPresentation(initialGameState)).toBeNull()
  })

  it('unions only active target footprints; visual padding is separate from range', () => {
    const model = (id: string, x: number, presence: TabletopModel['presence'] = 'ON_BATTLEFIELD'): TabletopModel => ({
      id, unitId: 'target', ownerId: 'opponent', position: { x, y: 10 }, rotation: 0,
      base: { shape: 'circle', diameterMm: 25.4 }, canPassOverModels: false, presence,
    })
    const models = [model('a', 10), model('b', 10.8), model('slain', 30, 'DESTROYED')]
    const raw = targetUnitFootprintEnvelopes(models, ['target'])
    expect(raw).toHaveLength(1)
    expect(raw[0].outlines).toHaveLength(1)
    const bounds = (points: { x: number; y: number }[][]) => points.flat().map((point) => point.x)
    expect(Math.min(...bounds(raw[0].outlines))).toBeCloseTo(9.5, 2)
    expect(Math.max(...bounds(raw[0].outlines))).toBeCloseTo(11.3, 2)
    const padded = targetUnitFootprintEnvelopes(models, ['target'], 0.12)
    expect(Math.min(...bounds(padded[0].outlines))).toBeCloseTo(9.38, 2)
    expect(models[0].base).toEqual({ shape: 'circle', diameterMm: 25.4 })
    expect(targetUnitFootprintEnvelopes(models.map((entry) => ({ ...entry, presence: 'DESTROYED' })), ['target']))
      .toEqual([])
  })

  it('replaces target emphasis by stable unit ID and clears it after completion', () => {
    const acting = initialGameState.units[0]
    const first = initialGameState.units[1]
    const second = initialGameState.units[2]
    const focus = (targetId?: string) => deriveActionFocusPresentation(initialGameState, targetId ? {
      actingUnitId: acting.id, targetUnitIds: [targetId], targetEnvelopeUnitIds: [targetId],
    } : undefined)
    expect(focus(first.id)?.targetEnvelopeUnitIds).toEqual([first.id])
    expect(focus(second.id)?.targetEnvelopeUnitIds).toEqual([second.id])
    expect(focus()).toBeNull()
  })
})
