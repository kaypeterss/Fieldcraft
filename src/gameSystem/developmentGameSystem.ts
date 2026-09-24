import type { ContentManifestEntry } from '../domain/types'
import type { InstalledContentPackage } from './registry'
import type { GameSystem } from './types'

export const developmentInstalledContent: readonly InstalledContentPackage[] = [
  { kind: 'core-rules', id: 'fieldcraft-development-rules', version: 'm9.1', name: 'Development Rules' },
  { kind: 'format', id: 'development-open-play', version: '1', name: 'Development Open Play' },
  { kind: 'mission', id: 'development-sandbox-board', version: '1', name: 'Development Sandbox Board' },
  { kind: 'mission', id: 'development-lifecycle-qa', version: '1', name: 'Development Lifecycle QA' },
]

export const developmentContentManifest: readonly ContentManifestEntry[] = developmentInstalledContent
  .map(({ kind, id, version, hash }) => ({ kind, id, version, ...(hash ? { hash } : {}) }))

/** Generic permissive defaults for the prototype and QA boards, not a named ruleset. */
export const developmentGameSystem: GameSystem = {
  id: 'development-sandbox',
  name: 'Development Sandbox',
  version: 'm8.0',
  movement: {
    permissions: {
      actionLimit: { type: 'unlimited' },
      allowance: { type: 'reset-per-action' },
    },
    cost: { type: 'movement-envelope' },
  },
  coherency: { type: 'unit-definition' },
  terrain: {
    defaultBase: { canEnter: true, canCross: true, canFinish: true },
    defaultObject: { canEnter: false, canCross: false, canFinish: false },
    rules: [],
  },
  visibility: { mode: 'any-to-any', terrainPolicy: 'objects-block' },
  objectives: {
    qualification: 'intersects',
    control: { type: 'model-or-unit-value', defaultValue: 0 },
  },
  turns: { phases: [] },
  matchState: {
    schemaId: 'fieldcraft.development-match-state',
    schemaVersion: 1,
    createInitialData: () => ({}),
    validate: (data) => typeof data === 'object' && data !== null && !Array.isArray(data),
  },
}
