import { describe, expect, it } from 'vitest'
import { deserializeMatch, serializeMatch } from '../../game/matchPersistence'
import { gameSystemRegistry, ageOfSigmarGameSystemRegistration, developmentGameSystemRegistration } from '../registeredGameSystems'
import { ageOfSigmarContentManifest } from './ageOfSigmarGameSystem'
import { whatsYoursIsOurs } from './content/battleplans/whatsYoursIsOurs'
import { stormcastWarscrolls } from './content/warscrolls/stormcast'
import { skavenWarscrolls } from './content/warscrolls/skaven'
import { prepareAgeOfSigmarMatch } from './prepareAgeOfSigmarMatch'

describe('Age of Sigmar September 2026 controlled match', () => {
  it('pins the complete immutable content snapshot', () => {
    const state = ageOfSigmarGameSystemRegistration.createMatch({ matchId: 'aos-test' })
    expect(state.battlefield).toEqual({ width: 44, height: 30 })
    expect(state.matchIdentity?.contentManifest).toEqual(ageOfSigmarContentManifest)
    expect(state.matchIdentity?.mission).toEqual({ id: 'whats-yours-is-ours', version: '2026-27' })
    expect(ageOfSigmarContentManifest.map((entry) => entry.kind)).toEqual([
      'core-rules', 'rules-update', 'battlepack', 'mission', 'warscroll-set', 'warscroll-set',
    ])
  })

  it("loads What's Yours Is Ours authored geometry", () => {
    expect(whatsYoursIsOurs.battlefield).toEqual({ width: 44, height: 30 })
    expect(whatsYoursIsOurs.roundLimit).toBe(5)
    expect(whatsYoursIsOurs.territories).toHaveLength(4)
    expect(whatsYoursIsOurs.objectives.map(({ x, y }) => [x, y])).toEqual([
      [32.7, 8], [11, 15], [22, 15], [33, 15], [32.7, 22.5],
    ])
  })

  it('keeps controlled profiles versioned and uses their verified physical bases', () => {
    const profiles = [...stormcastWarscrolls, ...skavenWarscrolls]
    expect(profiles).toHaveLength(8)
    expect(profiles.every((profile) => profile.source.snapshot === '2026-09-24')).toBe(true)
    expect(profiles.find((profile) => profile.id === 'dracothian-guard-concussors')?.footprint)
      .toEqual({ shape: 'ellipse', widthMm: 90, heightMm: 52 })
    expect(profiles.find((profile) => profile.id === 'clanrats')?.footprint)
      .toEqual({ shape: 'circle', diameterMm: 25 })
  })

  it('prepares objectives, terrain, ownership and off-board armies without gameplay', () => {
    const prepared = prepareAgeOfSigmarMatch(ageOfSigmarGameSystemRegistration.createMatch())
    expect(prepared.matchLifecycle).toBe('DEPLOYMENT')
    expect(prepared.battlefield).toEqual({ width: 44, height: 30 })
    expect(prepared.resolvedMatchConfiguration?.deploymentZones).toHaveLength(2)
    expect(prepared.resolvedMatchConfiguration?.deploymentZones.flatMap((zone) => zone.areas ?? [])).toHaveLength(4)
    expect(prepared.battlefieldFeatures?.filter((feature) => feature.capabilities.objective)).toHaveLength(5)
    expect(prepared.battlefieldFeatures?.filter((feature) => feature.capabilities.terrain)).toHaveLength(8)
    expect(prepared.units).toHaveLength(8)
    expect(prepared.models).toHaveLength(38)
    expect(prepared.models.every((model) => model.presence === 'OFF_BOARD')).toBe(true)
    expect(prepared.models.filter((model) => model.ownerId === 'player-1')).toHaveLength(11)
    expect(prepared.models.filter((model) => model.ownerId === 'player-2')).toHaveLength(27)
  })

  it('round-trips the exact prepared match rather than rebuilding current content', () => {
    const prepared = prepareAgeOfSigmarMatch(ageOfSigmarGameSystemRegistration.createMatch({ matchId: 'prepared-aos' }))
    const loaded = deserializeMatch(serializeMatch(prepared), gameSystemRegistry)
    expect(loaded.state).toEqual(prepared)
    expect(loaded.runtime.gameSystem.id).toBe('age-of-sigmar')
  })

  it('keeps Development and AoS match content isolated', () => {
    const development = developmentGameSystemRegistration.createMatch()
    const aos = prepareAgeOfSigmarMatch(ageOfSigmarGameSystemRegistration.createMatch())
    expect(development.matchIdentity?.gameSystem.id).toBe('development-sandbox')
    expect(development.models.some((model) => model.id.startsWith('sce-') || model.id.startsWith('skv-'))).toBe(false)
    expect(aos.models.every((model) => model.id.startsWith('sce-') || model.id.startsWith('skv-'))).toBe(true)
  })
})
