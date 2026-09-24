import type { ContentManifestEntry } from '../../domain/types'
import type { InstalledContentPackage } from '../registry'
import type { GameSystem } from '../types'

export const AGE_OF_SIGMAR_RULES_SNAPSHOT = '2026-09-24'

export const ageOfSigmarInstalledContent: readonly InstalledContentPackage[] = [
  {
    kind: 'core-rules', id: 'age-of-sigmar-fourth-edition', version: AGE_OF_SIGMAR_RULES_SNAPSHOT,
    name: 'Age of Sigmar Core Rules · September 2026',
  },
  {
    kind: 'rules-update', id: 'age-of-sigmar-battlescroll', version: '2026-09-23',
    name: 'Quarterly Battlescroll · 23 September 2026',
  },
  {
    kind: 'battlepack', id: 'generals-handbook', version: '2026-27',
    name: "General's Handbook 2026–27",
  },
]

export const ageOfSigmarContentManifest: readonly ContentManifestEntry[] = ageOfSigmarInstalledContent
  .map(({ kind, id, version, hash }) => ({ kind, id, version, ...(hash ? { hash } : {}) }))

const blocked = { canEnter: false, canCross: false, canFinish: false }

/**
 * Identity-only M9.1 shell. Every authoritative command is rejected until its
 * actual current AoS policy is implemented; these required contract values are
 * deliberately non-authoritative and cannot be exercised by this adapter.
 */
export const ageOfSigmarGameSystem: GameSystem = {
  id: 'age-of-sigmar',
  name: 'Warhammer Age of Sigmar',
  version: 'adapter-v1',
  movement: {
    permissions: {
      actionLimit: { type: 'limited', maximumActions: 0, scope: 'turn' },
      allowance: { type: 'shared', scope: 'turn' },
    },
    cost: { type: 'movement-envelope' },
  },
  coherency: { type: 'game-system-default', policy: { distance: 0, requiredNeighbors: 0 } },
  terrain: { defaultBase: blocked, defaultObject: blocked, rules: [] },
  visibility: { mode: 'any-to-any', terrainPolicy: 'nothing-blocks' },
  objectives: { qualification: 'intersects' },
  turns: { phases: [] },
  matchState: {
    schemaId: 'fieldcraft.age-of-sigmar.alpha-match-state',
    schemaVersion: 1,
    createInitialData: () => ({ status: 'rules-not-implemented' }),
    validate: (data) => typeof data === 'object'
      && data !== null
      && !Array.isArray(data)
      && data.status === 'rules-not-implemented',
  },
  authorizeCommand: () => false,
}
