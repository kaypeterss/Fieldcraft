import { describe, expect, it } from 'vitest'
import { ageOfSigmarGameSystemRegistration, gameSystemRegistry } from '../gameSystem/registeredGameSystems'
import { initialGameState } from './initialState'
import { deserializeMatch, deleteSavedMatch, listSavedMatches, saveMatchAsToStorage, saveMatchToStorage, serializeMatch } from './matchPersistence'

describe('versioned match persistence', () => {
  it('round-trips Development and AoS using their exact registered adapters', () => {
    const development = deserializeMatch(serializeMatch(initialGameState), gameSystemRegistry)
    expect(development.runtime.gameSystem.id).toBe('development-sandbox')

    const aosState = ageOfSigmarGameSystemRegistration.createMatch()
    const aos = deserializeMatch(serializeMatch(aosState), gameSystemRegistry)
    expect(aos.runtime.gameSystem.id).toBe('age-of-sigmar')
    expect(aos.runtime.gameSystem.version).toBe('adapter-v1')
    expect(aos.runtime.identity.contentManifest).toEqual(aosState.matchIdentity?.contentManifest)
  })

  it('does not replace missing adapters or content while loading', () => {
    const missingAdapter = structuredClone(ageOfSigmarGameSystemRegistration.createMatch())
    missingAdapter.matchIdentity!.gameSystem.version = 'adapter-v999'
    expect(() => deserializeMatch(serializeMatch(missingAdapter), gameSystemRegistry)).toThrow(/adapter-v999/)

    const missingContent = structuredClone(ageOfSigmarGameSystemRegistration.createMatch())
    missingContent.matchIdentity!.contentManifest![0].version = '2099-01-01'
    expect(() => deserializeMatch(serializeMatch(missingContent), gameSystemRegistry)).toThrow(/2099-01-01/)
  })

  it('migrates only legacy Development saves into the manifest schema', () => {
    const legacy = structuredClone(initialGameState)
    legacy.schemaVersion = 4
    legacy.matchIdentity!.contentManifest = undefined
    const loaded = deserializeMatch(serializeMatch(legacy), gameSystemRegistry)
    expect(loaded.state.schemaVersion).toBe(5)
    expect(loaded.state.matchIdentity?.contentManifest?.length).toBeGreaterThan(0)
    expect(loaded.runtime.gameSystem.id).toBe('development-sandbox')
  })

  it('supports independent saves, updates, Save As and deletion', () => {
    const storage = new Map<string, string>()
    const fakeStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } as unknown as Storage
    const a = ageOfSigmarGameSystemRegistration.createMatch({ matchName: 'AoS A', matchId: 'a' })
    const b = ageOfSigmarGameSystemRegistration.createMatch({ matchName: 'AoS B', matchId: 'b' })
    saveMatchToStorage(fakeStorage, a)
    saveMatchToStorage(fakeStorage, b)
    expect(listSavedMatches(fakeStorage, gameSystemRegistry).map((entry) => entry.matchId)).toEqual(['a', 'b'])
    saveMatchToStorage(fakeStorage, { ...a, matchLifecycle: 'IN_PROGRESS' })
    expect(listSavedMatches(fakeStorage, gameSystemRegistry).find((entry) => entry.matchId === 'a')?.lifecycle).toBe('IN_PROGRESS')
    const copy = saveMatchAsToStorage(fakeStorage, a, 'AoS Copy', () => 'copy')
    expect(copy.matchIdentity?.matchId).toBe('copy')
    deleteSavedMatch(fakeStorage, 'b')
    expect(listSavedMatches(fakeStorage, gameSystemRegistry).map((entry) => entry.matchId)).toEqual(['a', 'copy'])
  })
})
