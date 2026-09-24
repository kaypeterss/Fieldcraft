import { describe, expect, it } from 'vitest'
import { millimetersToInches } from '../engine/units'
import { ageOfSigmarGameSystemRegistration } from '../gameSystem/registeredGameSystems'
import { prepareAgeOfSigmarMatch } from '../gameSystem/ageOfSigmar/prepareAgeOfSigmarMatch'
import { objectiveControlAreaPresentation } from './battlefieldPresentation'

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
