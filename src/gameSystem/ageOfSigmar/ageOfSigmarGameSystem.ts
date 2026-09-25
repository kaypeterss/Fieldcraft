import type { ContentManifestEntry } from '../../domain/types'
import type { InstalledContentPackage } from '../registry'
import type { GameSystem } from '../types'
import { AOS_BATTLESCROLL_SNAPSHOT, AOS_RULES_SNAPSHOT } from './content/snapshot'
import { aosSetupData } from './prepareAgeOfSigmarMatch'
import { isAosMatchStateData } from './deployment'
import { AOS_TURN_PHASES } from './battleRound'
import { commitAosMovementAction, resolveAosMovementContext } from './movement'

export const AGE_OF_SIGMAR_RULES_SNAPSHOT = AOS_RULES_SNAPSHOT

export const ageOfSigmarInstalledContent: readonly InstalledContentPackage[] = [
  {
    kind: 'core-rules', id: 'age-of-sigmar-fourth-edition', version: AGE_OF_SIGMAR_RULES_SNAPSHOT,
    name: 'Age of Sigmar Core Rules · September 2026',
  },
  {
    kind: 'rules-update', id: 'age-of-sigmar-battlescroll', version: AOS_BATTLESCROLL_SNAPSHOT,
    name: 'Quarterly Battlescroll · 23 September 2026',
  },
  {
    kind: 'battlepack', id: 'generals-handbook', version: '2026-27',
    name: "General's Handbook 2026–27",
  },
  { kind: 'mission', id: 'whats-yours-is-ours', version: '2026-27', name: "What's Yours Is Ours" },
  { kind: 'warscroll-set', id: 'stormcast-eternals-alpha-roster', version: AGE_OF_SIGMAR_RULES_SNAPSHOT, name: 'Stormcast Eternals Alpha Profiles' },
  { kind: 'warscroll-set', id: 'skaven-alpha-roster', version: AGE_OF_SIGMAR_RULES_SNAPSHOT, name: 'Skaven Alpha Profiles' },
]

export const ageOfSigmarContentManifest: readonly ContentManifestEntry[] = ageOfSigmarInstalledContent
  .map(({ kind, id, version, hash }) => ({ kind, id, version, ...(hash ? { hash } : {}) }))
export const ageOfSigmarM91RequiredContentManifest = ageOfSigmarContentManifest.slice(0, 3)

const blocked = { canEnter: false, canCross: false, canFinish: false }

/** The adapter owns AoS timing and each implemented named-rules policy. */
export const ageOfSigmarGameSystem: GameSystem = {
  id: 'age-of-sigmar',
  name: 'Warhammer Age of Sigmar',
  version: 'adapter-v1',
  movement: {
    permissions: {
      actionLimit: { type: 'limited', maximumActions: 1, scope: 'phase' },
      allowance: { type: 'reset-per-action' },
    },
    cost: { type: 'movement-envelope' },
    resolveActionContext: ({ state, unitId }) => resolveAosMovementContext(state, unitId),
    commitAction: commitAosMovementAction,
  },
  coherency: { type: 'unit-definition' },
  terrain: { defaultBase: blocked, defaultObject: blocked, rules: [] },
  visibility: { mode: 'any-to-any', terrainPolicy: 'nothing-blocks' },
  objectives: { qualification: 'intersects' },
  turns: { phases: AOS_TURN_PHASES.map((phase) => ({
    id: phase.id,
    name: phase.name,
    allowsMovement: phase.id === 'MOVEMENT_PHASE',
  })) },
  matchState: {
    schemaId: 'fieldcraft.age-of-sigmar.alpha-match-state',
    schemaVersion: 1,
    createInitialData: () => ({ status: 'setup', setup: aosSetupData() }),
    validate: isAosMatchStateData,
  },
  authorizeCommand: ({ kind }) => kind === 'MOVE',
  authorizeUndo: ({ operation }) => operation.type === 'GAME_SYSTEM' || operation.type === 'MOVE',
}
