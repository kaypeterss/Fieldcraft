import { describe, expect, it } from 'vitest'
import { millimetersToInches } from '../engine/units'
import { ageOfSigmarGameSystemRegistration } from '../gameSystem/registeredGameSystems'
import { prepareAgeOfSigmarMatch } from '../gameSystem/ageOfSigmar/prepareAgeOfSigmarMatch'
import { initialGameState } from '../game/initialState'
import {
  defaultBoardOverlayPreferences,
  deploymentZonesVisible,
  deriveUnitBattlefieldPresentations,
  movementStatusPresentation,
  objectiveControlAreaPresentation,
  PRESENTATION_ANNOTATION_EVENT_MODE,
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
})
