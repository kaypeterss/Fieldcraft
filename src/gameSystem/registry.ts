import type {
  ContentManifestEntry,
  GameState,
  MatchIdentity,
} from '../domain/types'
import type { GameSystem, GameSystemCommand } from './types'

export interface InstalledContentPackage extends ContentManifestEntry {
  name: string
}

export interface GameSystemSetupSummaryItem {
  label: string
  value: string
}

export interface GameSystemUiContribution {
  description: string
  developmentControls: boolean
  gameplayImplemented: boolean
  /** Incremental shell capabilities; omitted entries fall back to gameplayImplemented. */
  capabilities?: {
    lifecycle?: boolean
    dice?: boolean
    movement?: boolean
    scoring?: boolean
    gameStatus?: boolean
  }
  /** Compact, presentation-only labels consumed by the generic match shell. */
  shell?: {
    shortName?: string
    missionName?: string
    formatName?: string
  }
  matchInfo?: {
    facts: GameSystemSetupSummaryItem[]
    playerLabels?: Record<string, string>
  }
  setupSummary: GameSystemSetupSummaryItem[]
  status: {
    eyebrow: string
    title: string
    details: GameSystemSetupSummaryItem[]
    message?: string
  }
}

export interface RegisteredGameSystem {
  gameSystem: GameSystem
  installedContent: readonly InstalledContentPackage[]
  defaultContentManifest: readonly ContentManifestEntry[]
  createMatch: (options?: MatchCreationOptions) => GameState
  /** Optional adapter-owned setup transition; generic Fieldcraft does not interpret its content. */
  prepareMatch?: (state: GameState) => GameState
  /** Executes an adapter-owned authoritative command without teaching generic state its rules. */
  executeCommand?: (state: GameState, command: GameSystemCommand) => GameState
  ui: GameSystemUiContribution
}

export interface MatchCreationOptions {
  matchName?: string
  matchId?: string
}

export interface ResolvedGameSystemRegistration {
  registration: RegisteredGameSystem
  gameSystem: GameSystem
}

export class GameSystemRegistry {
  private readonly registrations = new Map<string, RegisteredGameSystem>()

  constructor(registrations: readonly RegisteredGameSystem[] = []) {
    registrations.forEach((registration) => this.register(registration))
  }

  register(registration: RegisteredGameSystem): void {
    const key = adapterKey(registration.gameSystem.id, registration.gameSystem.version)
    if (this.registrations.has(key)) {
      throw new Error(`GameSystem ${registration.gameSystem.id} / ${registration.gameSystem.version} is already registered.`)
    }
    validateInstalledContent(registration)
    this.registrations.set(key, registration)
  }

  list(): RegisteredGameSystem[] {
    return [...this.registrations.values()]
  }

  resolve(gameSystemId: string, adapterVersion: string): RegisteredGameSystem {
    const registration = this.registrations.get(adapterKey(gameSystemId, adapterVersion))
    if (!registration) {
      throw new Error(`This match requires ${gameSystemId} / ${adapterVersion}, which is not installed.`)
    }
    return registration
  }

  resolveIdentity(identity: MatchIdentity): ResolvedGameSystemRegistration {
    const registration = this.resolve(identity.gameSystem.id, identity.gameSystem.version)
    validateContentManifest(identity.contentManifest, registration)
    validateCompatibilityReference(identity.format, ['format', 'battlepack'], identity.contentManifest!)
    validateCompatibilityReference(identity.mission, ['mission'], identity.contentManifest!)
    return { registration, gameSystem: registration.gameSystem }
  }
}

export function validateContentManifest(
  manifest: readonly ContentManifestEntry[] | undefined,
  registration: RegisteredGameSystem,
): void {
  if (!manifest) throw new Error('Saved match has no immutable content manifest.')
  const installedByIdentity = new Map(registration.installedContent.map((entry) => [contentKey(entry), entry]))
  const seen = new Set<string>()
  for (const entry of manifest) {
    const key = contentKey(entry)
    if (seen.has(key)) throw new Error(`Saved match content manifest contains duplicate ${entry.kind} / ${entry.id}.`)
    seen.add(key)
    const installed = installedByIdentity.get(key)
    if (!installed || installed.version !== entry.version || (entry.hash && installed.hash !== entry.hash)) {
      throw new Error(
        `This match requires content ${entry.kind} / ${entry.id} / ${entry.version}, which is not installed.`,
      )
    }
  }

  for (const required of registration.defaultContentManifest) {
    const matching = manifest.find((entry) => contentKey(entry) === contentKey(required))
    if (!matching || matching.version !== required.version || matching.hash !== required.hash) {
      throw new Error(
        `This match requires the registered ${required.kind} / ${required.id} / ${required.version} snapshot.`,
      )
    }
  }

}

function validateCompatibilityReference(
  reference: MatchIdentity['format'],
  kinds: readonly string[],
  manifest: readonly ContentManifestEntry[],
): void {
  if (!reference) return
  const matching = manifest.find((entry) => kinds.includes(entry.kind) && entry.id === reference.id)
  if (!matching || matching.version !== reference.version) {
    throw new Error(`Saved match ${kinds.join('/')} reference is not pinned by its content manifest.`)
  }
}

function validateInstalledContent(registration: RegisteredGameSystem): void {
  const installedKeys = new Set<string>()
  for (const entry of registration.installedContent) {
    const key = contentKey(entry)
    if (installedKeys.has(key)) {
      throw new Error(`Installed content ${entry.kind} / ${entry.id} is registered more than once.`)
    }
    installedKeys.add(key)
  }
  for (const required of registration.defaultContentManifest) {
    const installed = registration.installedContent.find((entry) => contentKey(entry) === contentKey(required))
    if (!installed || installed.version !== required.version || installed.hash !== required.hash) {
      throw new Error(`Default content ${required.kind} / ${required.id} is not installed at the requested version.`)
    }
  }
}

function adapterKey(id: string, version: string): string {
  return `${id}\u0000${version}`
}

function contentKey(entry: Pick<ContentManifestEntry, 'kind' | 'id'>): string {
  return `${entry.kind}\u0000${entry.id}`
}
