import type { GameState, MatchLifecycleStatus, MatchIdentity } from '../domain/types'
import type { GameSystemRegistry } from '../gameSystem/registry'
import { loadRegisteredMatchRuntime, type LoadedMatchRuntime } from '../gameSystem/runtime'
import { developmentMatchConfiguration, developmentMatchIdentity } from './initialState'
import { migrateDevelopmentGameStateToV5 } from './migrations'
import { matchDisplayName, randomMatchId, withMatchIdentity } from './matchIdentity'

export const LOCAL_MATCH_SAVE_KEY = 'fieldcraft.m9.1.saved-match'
export const LOCAL_MATCH_INDEX_KEY = 'fieldcraft.m9.1.saved-match-index'
export const MATCH_STORAGE_VERSION = 1

export interface LoadedSavedMatch { state: GameState; runtime: LoadedMatchRuntime }
export interface SavedMatchMetadata {
  matchId: string
  matchName: string
  gameSystemId: string
  gameSystemName?: string
  adapterVersion: string
  lifecycle: MatchLifecycleStatus
  savedAt: string
  contentManifest: MatchIdentity['contentManifest']
  valid: boolean
  error?: string
}
interface SavedMatchIndexEntry extends SavedMatchMetadata { stateKey: string }
interface SavedMatchIndex { version: number; entries: SavedMatchIndexEntry[] }

export function serializeMatch(state: GameState): string { return JSON.stringify(state) }

export function deserializeMatch(serialized: string, registry: GameSystemRegistry): LoadedSavedMatch {
  let parsed: unknown
  try { parsed = JSON.parse(serialized) } catch { throw new Error('Saved match is not valid JSON.') }
  if (!isGameStateShape(parsed)) throw new Error('Saved match does not contain a valid Fieldcraft state envelope.')
  const state = parsed.schemaVersion < 5
    ? migrateDevelopmentGameStateToV5(parsed, developmentMatchIdentity, developmentMatchConfiguration)
    : withMatchIdentity(parsed, parsed.matchIdentity?.matchName)
  const runtime = loadRegisteredMatchRuntime(state, registry)
  return { state, runtime }
}

export function saveMatchToStorage(storage: Storage, state: GameState): GameState {
  const prepared = withMatchIdentity(state, state.matchIdentity?.matchName)
  const id = prepared.matchIdentity!.matchId!
  const index = readIndex(storage)
  const now = new Date().toISOString()
  const entry: SavedMatchIndexEntry = { ...metadataFor(prepared, now), stateKey: stateKey(id) }
  storage.setItem(entry.stateKey, serializeMatch(prepared))
  index.entries = index.entries.some((candidate) => candidate.matchId === id)
    ? index.entries.map((candidate) => candidate.matchId === id ? entry : candidate)
    : [...index.entries, entry]
  writeIndex(storage, index)
  storage.setItem(LOCAL_MATCH_SAVE_KEY, serializeMatch(prepared))
  return prepared
}

export function saveMatchAsToStorage(storage: Storage, state: GameState, name: string, idFactory = randomMatchId): GameState {
  const copy = withMatchIdentity({ ...state, matchIdentity: state.matchIdentity ? { ...state.matchIdentity, matchId: undefined } : undefined }, name, idFactory)
  return saveMatchToStorage(storage, copy)
}

export function listSavedMatches(storage: Storage, registry: GameSystemRegistry): SavedMatchMetadata[] {
  return readIndex(storage).entries.map((entry) => {
    try {
      const serialized = storage.getItem(entry.stateKey)
      if (!serialized) throw new Error('Saved match data is missing.')
      const loaded = deserializeMatch(serialized, registry)
      return { ...metadataFor(loaded.state, entry.savedAt), gameSystemName: loaded.runtime.gameSystem.name }
    } catch (error) { return { ...entry, valid: false, error: errorMessage(error) } }
  })
}

export function loadSavedMatch(storage: Storage, matchId: string, registry: GameSystemRegistry): LoadedSavedMatch {
  const entry = readIndex(storage).entries.find((candidate) => candidate.matchId === matchId)
  if (!entry) throw new Error(`Saved match ${matchId} was not found.`)
  const serialized = storage.getItem(entry.stateKey)
  if (!serialized) throw new Error(`Saved match “${entry.matchName}” is missing its state data.`)
  return deserializeMatch(serialized, registry)
}

export function deleteSavedMatch(storage: Storage, matchId: string): void {
  const index = readIndex(storage)
  const entry = index.entries.find((candidate) => candidate.matchId === matchId)
  if (!entry) return
  storage.removeItem(entry.stateKey)
  writeIndex(storage, { version: MATCH_STORAGE_VERSION, entries: index.entries.filter((candidate) => candidate.matchId !== matchId) })
}

export function loadMatchFromStorage(storage: Storage, registry: GameSystemRegistry): LoadedSavedMatch {
  const index = readIndex(storage)
  if (index.entries.length > 0) return loadSavedMatch(storage, index.entries[0].matchId, registry)
  const legacy = storage.getItem(LOCAL_MATCH_SAVE_KEY)
  if (!legacy) throw new Error('No local Fieldcraft match has been saved yet.')
  const loaded = deserializeMatch(legacy, registry)
  saveMatchToStorage(storage, loaded.state)
  return loaded
}

function metadataFor(state: GameState, savedAt: string): SavedMatchMetadata {
  const identity = state.matchIdentity!
  return {
    matchId: identity.matchId!, matchName: matchDisplayName(identity),
    gameSystemId: identity.gameSystem.id, adapterVersion: identity.gameSystem.version,
    lifecycle: state.matchLifecycle ?? 'SETUP', savedAt,
    contentManifest: identity.contentManifest, valid: true,
  }
}
function stateKey(matchId: string): string { return `fieldcraft.m9.1.saved-match.${matchId}` }
function readIndex(storage: Storage): SavedMatchIndex {
  const raw = storage.getItem(LOCAL_MATCH_INDEX_KEY)
  if (!raw) return { version: MATCH_STORAGE_VERSION, entries: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<SavedMatchIndex>
    if (parsed.version !== MATCH_STORAGE_VERSION || !Array.isArray(parsed.entries)) throw new Error()
    return { version: MATCH_STORAGE_VERSION, entries: parsed.entries as SavedMatchIndexEntry[] }
  } catch { return { version: MATCH_STORAGE_VERSION, entries: [] } }
}
function writeIndex(storage: Storage, index: SavedMatchIndex): void { storage.setItem(LOCAL_MATCH_INDEX_KEY, JSON.stringify(index)) }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Saved match is unavailable.' }
function isGameStateShape(value: unknown): value is GameState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<GameState>
  return (candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5)
    && typeof candidate.battlefield === 'object' && Array.isArray(candidate.players)
    && Array.isArray(candidate.models) && Array.isArray(candidate.units)
    && Array.isArray(candidate.unitDefinitions) && typeof candidate.gameContext === 'object'
}
