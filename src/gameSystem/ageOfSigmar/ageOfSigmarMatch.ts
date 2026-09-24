import type { GameState, MatchIdentity, ResolvedMatchConfiguration } from '../../domain/types'
import type { MatchCreationOptions } from '../registry'
import { withMatchIdentity } from '../../game/matchIdentity'
import { initialGameSystemOwnedState } from '../runtime'
import {
  ageOfSigmarContentManifest,
  ageOfSigmarGameSystem,
} from './ageOfSigmarGameSystem'

export const ageOfSigmarAlphaIdentity: MatchIdentity = {
  gameSystem: { id: ageOfSigmarGameSystem.id, version: ageOfSigmarGameSystem.version },
  contentManifest: ageOfSigmarContentManifest.map((entry) => ({ ...entry })),
  format: { id: 'generals-handbook', version: '2026-27' },
}

export const ageOfSigmarAlphaConfiguration: ResolvedMatchConfiguration = {
  id: 'aos-alpha-runtime-shell',
  version: 'm9.1',
  roundLimit: 5,
  objectiveFeatureIds: [],
  deploymentZones: [],
  policyReferences: {},
}

export function createAgeOfSigmarAlphaMatch(options?: MatchCreationOptions): GameState {
  return withMatchIdentity({
    schemaVersion: 5,
    matchIdentity: structuredClone(ageOfSigmarAlphaIdentity),
    resolvedMatchConfiguration: structuredClone(ageOfSigmarAlphaConfiguration),
    gameSystemState: initialGameSystemOwnedState(ageOfSigmarGameSystem),
    battlefield: { width: 60, height: 44 },
    players: [
      { id: 'player-1', displayName: 'Player 1' },
      { id: 'player-2', displayName: 'Player 2' },
    ],
    models: [],
    battlefieldFeatures: [],
    terrainPolicy: structuredClone(ageOfSigmarGameSystem.terrain),
    units: [],
    unitDefinitions: [],
    gameContext: {
      round: 1,
      turn: 1,
      turnSequence: 1,
      turnId: 'aos-shell-turn-1',
      activePlayerId: 'player-1',
    },
    turnConfiguration: { playerOrder: ['player-1', 'player-2'] },
    actionHistory: [],
    scoreHistory: [],
    diceHistory: [],
    committedOperations: [],
    nextActionSequence: 1,
    movementSession: null,
    lastCommittedOperationUndo: null,
    lastConfirmedMovementUndo: null,
  }, options?.matchName, options?.matchId ? () => options.matchId! : undefined)
}
