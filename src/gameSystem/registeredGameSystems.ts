import { initialGameState } from '../game/initialState'
import { createAgeOfSigmarAlphaMatch } from './ageOfSigmar/ageOfSigmarMatch'
import {
  ageOfSigmarContentManifest,
  ageOfSigmarGameSystem,
  ageOfSigmarInstalledContent,
} from './ageOfSigmar/ageOfSigmarGameSystem'
import {
  developmentContentManifest,
  developmentGameSystem,
  developmentInstalledContent,
} from './developmentGameSystem'
import { GameSystemRegistry, type RegisteredGameSystem } from './registry'
import { withMatchIdentity } from '../game/matchIdentity'

export const developmentGameSystemRegistration: RegisteredGameSystem = {
  gameSystem: developmentGameSystem,
  installedContent: developmentInstalledContent,
  defaultContentManifest: developmentContentManifest,
  createMatch: (options) => withMatchIdentity(structuredClone(initialGameState), options?.matchName,
    options?.matchId ? () => options.matchId! : undefined),
  ui: {
    description: 'Fieldcraft engine QA, geometry and lifecycle sandbox.',
    developmentControls: true,
    gameplayImplemented: true,
    setupSummary: [
      { label: 'Rules', value: 'Development Rules' },
      { label: 'Board', value: 'Development Sandbox' },
    ],
    status: {
      eyebrow: 'GAME SYSTEM',
      title: 'Development Sandbox',
      details: [
        { label: 'Rules', value: 'M9.1 Development' },
        { label: 'Gameplay', value: 'Engine QA enabled' },
      ],
    },
  },
}

export const ageOfSigmarGameSystemRegistration: RegisteredGameSystem = {
  gameSystem: ageOfSigmarGameSystem,
  installedContent: ageOfSigmarInstalledContent,
  defaultContentManifest: ageOfSigmarContentManifest,
  createMatch: createAgeOfSigmarAlphaMatch,
  ui: {
    description: 'Versioned runtime shell for the first real Fieldcraft GameSystem.',
    developmentControls: false,
    gameplayImplemented: false,
    setupSummary: [
      { label: 'Rules snapshot', value: '24 September 2026' },
      { label: 'Battlepack', value: "General's Handbook 2026–27" },
      { label: 'Battlescroll', value: '23 September 2026' },
      { label: 'Mission', value: 'Not configured yet' },
    ],
    status: {
      eyebrow: 'AGE OF SIGMAR',
      title: 'September 2026',
      details: [
        { label: 'Adapter', value: 'adapter-v1' },
        { label: 'Battlepack', value: "General's Handbook 2026–27" },
        { label: 'Battlescroll', value: '23 September 2026' },
        { label: 'Mission', value: 'Not configured yet' },
        { label: 'Player armies', value: 'Not configured yet' },
      ],
      message: 'Gameplay is not implemented in the current AoS Alpha.',
    },
  },
}

export const gameSystemRegistry = new GameSystemRegistry([
  developmentGameSystemRegistration,
  ageOfSigmarGameSystemRegistration,
])
