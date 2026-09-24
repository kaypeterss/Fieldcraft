import { initialGameState } from '../game/initialState'
import { createAgeOfSigmarAlphaMatch } from './ageOfSigmar/ageOfSigmarMatch'
import {
  ageOfSigmarGameSystem,
  ageOfSigmarInstalledContent,
  ageOfSigmarM91RequiredContentManifest,
} from './ageOfSigmar/ageOfSigmarGameSystem'
import { prepareAgeOfSigmarMatch } from './ageOfSigmar/prepareAgeOfSigmarMatch'
import { executeAosCommand } from './ageOfSigmar/deployment'
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
    shell: { shortName: 'Development Sandbox' },
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
  defaultContentManifest: ageOfSigmarM91RequiredContentManifest,
  createMatch: createAgeOfSigmarAlphaMatch,
  prepareMatch: prepareAgeOfSigmarMatch,
  executeCommand: executeAosCommand,
  ui: {
    description: 'Versioned runtime shell for the first real Fieldcraft GameSystem.',
    developmentControls: false,
    gameplayImplemented: false,
    shell: {
      shortName: 'Age of Sigmar',
      missionName: "What's Yours Is Ours",
      formatName: "GHB 2026–27",
    },
    matchInfo: {
      facts: [
        { label: 'Battlepack', value: "General's Handbook 2026–27" },
        { label: 'Battleplan', value: "What's Yours Is Ours" },
        { label: 'Rules Snapshot', value: '24 September 2026' },
        { label: 'Battlescroll', value: '23 September 2026' },
      ],
      playerLabels: { 'player-1': 'Stormcast Eternals', 'player-2': 'Skaven' },
    },
    setupSummary: [
      { label: 'Rules snapshot', value: '24 September 2026' },
      { label: 'Battlepack', value: "General's Handbook 2026–27" },
      { label: 'Battlescroll', value: '23 September 2026' },
      { label: 'Mission', value: "What's Yours Is Ours" },
      { label: 'Battlefield', value: '44 × 30 mission board' },
      { label: 'Player 1', value: 'Stormcast Eternals Test Roster' },
      { label: 'Player 2', value: 'Skaven Test Roster' },
    ],
    status: {
      eyebrow: 'AGE OF SIGMAR',
      title: 'September 2026',
      details: [
        { label: 'Adapter', value: 'adapter-v1' },
        { label: 'Battlepack', value: "General's Handbook 2026–27" },
        { label: 'Battlescroll', value: '23 September 2026' },
        { label: 'Mission', value: "What's Yours Is Ours" },
        { label: 'Battlefield', value: '44 × 30 mission board' },
        { label: 'Player 1', value: 'Stormcast Eternals Test Roster' },
        { label: 'Stormcast units', value: 'Knight-Questor · Liberators · Vanguard-Raptors · Dracothian Guard' },
        { label: 'Player 2', value: 'Skaven Test Roster' },
        { label: 'Skaven units', value: 'Clawlord · Clanrats · Rat Ogors · Warplock Jezzails' },
      ],
      message: 'Gameplay is not implemented in the current AoS Alpha.',
    },
  },
}

export const gameSystemRegistry = new GameSystemRegistry([
  developmentGameSystemRegistration,
  ageOfSigmarGameSystemRegistration,
])
