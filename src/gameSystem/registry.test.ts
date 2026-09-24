import { describe, expect, it } from 'vitest'
import type { GameState } from '../domain/types'
import { initialGameState } from '../game/initialState'
import { developmentGameSystem } from './developmentGameSystem'
import { GameSystemRegistry, type RegisteredGameSystem } from './registry'

function registration(version: string): RegisteredGameSystem {
  const gameSystem = { ...developmentGameSystem, id: 'coexisting-system', version }
  return {
    gameSystem,
    installedContent: [{ kind: 'core-rules', id: 'core', version, name: `Core ${version}` }],
    defaultContentManifest: [{ kind: 'core-rules', id: 'core', version }],
    createMatch: () => structuredClone(initialGameState),
    ui: {
      description: 'test', developmentControls: false, gameplayImplemented: false,
      setupSummary: [], status: { eyebrow: 'TEST', title: version, details: [] },
    },
  }
}

function identityState(version: string): GameState {
  const state = structuredClone(initialGameState)
  state.matchIdentity = {
    gameSystem: { id: 'coexisting-system', version },
    contentManifest: [{ kind: 'core-rules', id: 'core', version }],
  }
  return state
}

describe('GameSystemRegistry', () => {
  it('resolves exact adapter versions and permits versions to coexist', () => {
    const registry = new GameSystemRegistry([registration('adapter-v1'), registration('adapter-v2')])
    expect(registry.resolveIdentity(identityState('adapter-v1').matchIdentity!).gameSystem.version).toBe('adapter-v1')
    expect(registry.resolveIdentity(identityState('adapter-v2').matchIdentity!).gameSystem.version).toBe('adapter-v2')
  })

  it('fails clearly for an unavailable adapter without a fallback', () => {
    const registry = new GameSystemRegistry([registration('adapter-v1')])
    expect(() => registry.resolveIdentity(identityState('adapter-v999').matchIdentity!))
      .toThrow(/adapter-v999.*not installed/)
  })

  it('requires every pinned content package at the exact version', () => {
    const registry = new GameSystemRegistry([registration('adapter-v1')])
    const state = identityState('adapter-v1')
    state.matchIdentity!.contentManifest![0].version = 'missing-version'
    expect(() => registry.resolveIdentity(state.matchIdentity!)).toThrow(/content.*missing-version.*not installed/)
    state.matchIdentity!.contentManifest = undefined
    expect(() => registry.resolveIdentity(state.matchIdentity!)).toThrow(/no immutable content manifest/)
  })
})
