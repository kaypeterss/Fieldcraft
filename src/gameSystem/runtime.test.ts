import { describe, expect, it } from 'vitest'
import type { GameState } from '../domain/types'
import { createPoseTrajectory } from '../engine/trajectory'
import { initialGameState } from '../game/initialState'
import { developmentMatchConfiguration, developmentMatchIdentity } from '../game/initialState'
import { migrateGameStateToV4 } from '../game/migrations'
import { createMoveAction } from '../game/moveActions'
import { reduceGameCommand } from '../state/commandBoundary'
import { developmentGameSystem } from './developmentGameSystem'
import { authorizeMovement, initialGameSystemOwnedState, loadMatchRuntime } from './runtime'
import type { GameSystem } from './types'

function sharedAllowanceState(): { state: GameState; system: GameSystem } {
  const system: GameSystem = {
    ...developmentGameSystem,
    id: 'shared-test',
    version: '1',
    movement: {
      ...developmentGameSystem.movement,
      permissions: { actionLimit: { type: 'unlimited' }, allowance: { type: 'shared', scope: 'turn' } },
      resolveGrants: () => ({ additionalAllowance: 1 }),
    },
  }
  const state = structuredClone(initialGameState)
  state.matchIdentity = { gameSystem: { id: system.id, version: system.version } }
  state.gameSystemState = initialGameSystemOwnedState(system)
  const model = state.models.find((candidate) => candidate.id === 'mdl-a-001')!
  state.actionHistory = [createMoveAction({
    sequence: 1,
    actorPlayerId: state.gameContext.activePlayerId,
    gameContext: state.gameContext,
    affectedModels: [model],
    startingPoses: { [model.id]: { position: model.position, rotation: model.rotation } },
    finalPoses: { [model.id]: { position: model.position, rotation: model.rotation } },
    trajectories: { [model.id]: createPoseTrajectory({ position: model.position, rotation: model.rotation }) },
    translationDistance: { [model.id]: 2 },
    angularRotation: { [model.id]: 0 },
    movementUsed: { [model.id]: 2 },
  })]
  state.nextActionSequence = 2
  return { state, system }
}

describe('loaded match runtime command boundary', () => {
  it('gives manual and Smart Move the same remaining allowance and authoritative policy', () => {
    const { state, system } = sharedAllowanceState()
    const runtime = loadMatchRuntime(state, system)
    const authorization = authorizeMovement(runtime, state, ['mdl-a-001'])
    expect(authorization.allowed).toBe(true)
    expect(authorization.remainingByModel['mdl-a-001']).toBe(5)

    const manual = reduceGameCommand(runtime, state, {
      type: 'movement/sessionStarted', sessionId: 'manual', modelIds: ['mdl-a-001'],
      movementPolicy: { type: 'free-rotation' },
    })
    expect(manual.movementSession?.movementPolicy).toEqual(system.movement.cost)
    expect(manual.movementSession?.movementAllowanceByModel?.['mdl-a-001']).toBe(5)

    const model = state.models.find((candidate) => candidate.id === 'mdl-a-001')!
    const smart = reduceGameCommand(runtime, state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { [model.id]: model.position },
      finalPositions: { [model.id]: { x: model.position.x - 0.25, y: model.position.y } },
      movementUsed: { [model.id]: 999 },
      paths: { [model.id]: [model.position, { x: model.position.x - 0.25, y: model.position.y }] },
    })
    expect(smart).not.toBe(state)
    expect(smart.actionHistory.at(-1)?.payload.movementUsed[model.id]).toBeCloseTo(0.25)
    expect(smart.committedOperations?.at(-1)?.type).toBe('MOVE')
    const undone = reduceGameCommand(loadMatchRuntime(smart, system), smart, {
      type: 'history/undoLastCommitted',
    })
    expect(undone.models.find((candidate) => candidate.id === model.id)?.position).toEqual(model.position)
    expect(undone.actionHistory).toHaveLength(state.actionHistory.length)
  })

  it('serializes identity and validates the GameSystem-owned state boundary', () => {
    const clone = structuredClone(initialGameState)
    expect(clone.matchIdentity).toEqual(initialGameState.matchIdentity)
    expect(loadMatchRuntime(clone, developmentGameSystem).gameSystemState).toEqual(clone.gameSystemState)
    clone.gameSystemState = { ...clone.gameSystemState!, schemaVersion: 999 }
    expect(() => loadMatchRuntime(clone, developmentGameSystem)).toThrow(/schema validation/)
  })

  it('deterministically migrates legacy v3 models into explicit runtime state', () => {
    const legacy = structuredClone(initialGameState)
    legacy.schemaVersion = 3
    legacy.matchIdentity = undefined
    legacy.resolvedMatchConfiguration = undefined
    legacy.gameSystemState = undefined
    legacy.committedOperations = undefined
    legacy.models = legacy.models.map((model) => {
      const legacyModel = { ...model }
      delete legacyModel.presence
      return legacyModel
    })
    const migrated = migrateGameStateToV4(
      legacy,
      developmentGameSystem,
      developmentMatchIdentity,
      developmentMatchConfiguration,
    )
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.models.every((model) => model.presence === 'ON_BATTLEFIELD')).toBe(true)
    expect(loadMatchRuntime(structuredClone(migrated), developmentGameSystem).identity)
      .toEqual(developmentMatchIdentity)
  })
})
