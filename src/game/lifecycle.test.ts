import { describe, expect, it } from 'vitest'
import { validateModelPlacement, validateModelPlacements } from '../engine/placement'
import { developmentGameSystem } from '../gameSystem/developmentGameSystem'
import { authorizeMovement, loadMatchRuntime } from '../gameSystem/runtime'
import { evaluateUnitCoherency } from '../engine/coherency'
import { reduceGameCommand } from '../state/commandBoundary'
import { initialGameState } from './initialState'
import { activeBattlefieldModels, modelPresence } from './modelPresence'

function setup() {
  const state = structuredClone(initialGameState)
  return { state, runtime: loadMatchRuntime(state, developmentGameSystem) }
}

describe('model presence, placement and atomic Undo', () => {
  it('removes and restores a whole selected unit as one atomic operation', () => {
    const { state } = setup()
    const unit = state.units.find((candidate) => candidate.id === 'unit-cavalry')!
    const original = Object.fromEntries(state.models
      .filter((model) => unit.modelIds.includes(model.id))
      .map((model) => [model.id, { position: { ...model.position }, rotation: model.rotation }]))
    const removed = reduceGameCommand(loadMatchRuntime(state, developmentGameSystem), state, {
      type: 'lifecycle/modelsPresenceSet', modelIds: unit.modelIds, presence: 'DESTROYED',
    })
    expect(removed.committedOperations).toHaveLength(1)
    expect(removed.committedOperations?.[0].entityIds).toEqual(expect.arrayContaining(unit.modelIds))
    expect(unit.modelIds.every((id) => modelPresence(removed.models.find((model) => model.id === id)!) === 'DESTROYED')).toBe(true)

    const removalUndone = reduceGameCommand(loadMatchRuntime(removed, developmentGameSystem), removed, {
      type: 'history/undoLastCommitted',
    })
    expect(unit.modelIds.every((id) => modelPresence(removalUndone.models.find((model) => model.id === id)!) === 'ON_BATTLEFIELD')).toBe(true)

    const removedAgain = reduceGameCommand(loadMatchRuntime(removalUndone, developmentGameSystem), removalUndone, {
      type: 'lifecycle/modelsPresenceSet', modelIds: unit.modelIds, presence: 'OFF_BOARD',
    })
    const restored = reduceGameCommand(loadMatchRuntime(removedAgain, developmentGameSystem), removedAgain, {
      type: 'lifecycle/modelsPlaced', placements: original, requireCoherency: true,
    })
    expect(restored.committedOperations).toHaveLength(2)
    expect(unit.modelIds.every((id) => modelPresence(restored.models.find((model) => model.id === id)!) === 'ON_BATTLEFIELD')).toBe(true)
    const restoreUndone = reduceGameCommand(loadMatchRuntime(restored, developmentGameSystem), restored, {
      type: 'history/undoLastCommitted',
    })
    expect(unit.modelIds.every((id) => modelPresence(restoreUndone.models.find((model) => model.id === id)!) === 'OFF_BOARD')).toBe(true)
  })

  it('validates optional coherency against the complete resulting active unit', () => {
    const { state } = setup()
    const modelId = 'mdl-cav-001'
    const original = state.models.find((model) => model.id === modelId)!
    const removed = reduceGameCommand(loadMatchRuntime(state, developmentGameSystem), state, {
      type: 'lifecycle/modelPresenceSet', modelId, presence: 'DESTROYED',
    })
    const farPose = { position: { x: 39, y: 41 }, rotation: original.rotation }
    expect(validateModelPlacement({ state: removed, modelId, pose: farPose, requireCoherency: false }).valid).toBe(true)
    expect(validateModelPlacement({ state: removed, modelId, pose: farPose, requireCoherency: true }).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'COHERENCY_FAILED' })]))
    expect(validateModelPlacement({
      state: removed, modelId,
      pose: { position: original.position, rotation: original.rotation },
      requireCoherency: true,
    }).valid).toBe(true)
  })

  it('evaluates group coherency only after all selected placements are projected', () => {
    const { state } = setup()
    const unit = state.units.find((candidate) => candidate.id === 'unit-cavalry')!
    let removed = state
    for (const modelId of unit.modelIds.slice(0, 2)) {
      removed = reduceGameCommand(loadMatchRuntime(removed, developmentGameSystem), removed, {
        type: 'lifecycle/modelPresenceSet', modelId, presence: 'OFF_BOARD',
      })
    }
    const placements = Object.fromEntries(unit.modelIds.slice(0, 2).map((modelId) => {
      const model = state.models.find((candidate) => candidate.id === modelId)!
      return [modelId, { position: model.position, rotation: model.rotation }]
    }))
    expect(validateModelPlacements({
      state: removed, placements, constraints: { requireCoherency: true },
    }).valid).toBe(true)
  })

  it('rejects mixed-presence removal and an invalid group restore without partial mutation', () => {
    const { state } = setup()
    const inactiveId = 'mdl-a-001'
    const activeId = 'mdl-a-002'
    const removed = reduceGameCommand(loadMatchRuntime(state, developmentGameSystem), state, {
      type: 'lifecycle/modelPresenceSet', modelId: inactiveId, presence: 'OFF_BOARD',
    })
    const mixed = reduceGameCommand(loadMatchRuntime(removed, developmentGameSystem), removed, {
      type: 'lifecycle/modelsPresenceSet', modelIds: [inactiveId, activeId], presence: 'DESTROYED',
    })
    expect(mixed).toBe(removed)
    expect(modelPresence(mixed.models.find((model) => model.id === activeId)!)).toBe('ON_BATTLEFIELD')

    const secondRemoved = reduceGameCommand(loadMatchRuntime(removed, developmentGameSystem), removed, {
      type: 'lifecycle/modelPresenceSet', modelId: activeId, presence: 'OFF_BOARD',
    })
    const blocker = secondRemoved.models.find((model) => model.id === 'mdl-a-003')!
    const invalid = reduceGameCommand(loadMatchRuntime(secondRemoved, developmentGameSystem), secondRemoved, {
      type: 'lifecycle/modelsPlaced',
      placements: {
        [inactiveId]: { position: blocker.position, rotation: 0 },
        [activeId]: { position: { x: 50, y: 38 }, rotation: 0 },
      },
    })
    expect(invalid).toBe(secondRemoved)
    expect([inactiveId, activeId].every((id) => modelPresence(invalid.models.find((model) => model.id === id)!) === 'OFF_BOARD')).toBe(true)
  })

  it('removes an entity from the canonical battlefield view without losing identity and Undo restores it', () => {
    const { state, runtime } = setup()
    const count = activeBattlefieldModels(state).length
    const removed = reduceGameCommand(runtime, state, {
      type: 'lifecycle/modelPresenceSet', modelId: 'mdl-a-001', presence: 'OFF_BOARD',
    })
    const entity = removed.models.find((model) => model.id === 'mdl-a-001')!
    expect(modelPresence(entity)).toBe('OFF_BOARD')
    expect(activeBattlefieldModels(removed)).toHaveLength(count - 1)
    expect(removed.committedOperations?.at(-1)).toMatchObject({ type: 'MODEL_PRESENCE' })

    const undone = reduceGameCommand(loadMatchRuntime(removed, developmentGameSystem), removed, {
      type: 'history/undoLastCommitted',
    })
    expect(modelPresence(undone.models.find((model) => model.id === entity.id)!)).toBe('ON_BATTLEFIELD')
    expect(activeBattlefieldModels(undone)).toHaveLength(count)
  })

  it('restores the same model through placement validation and rejects an illegal pose atomically', () => {
    const { state, runtime } = setup()
    const original = state.models.find((model) => model.id === 'mdl-a-001')!
    const removed = reduceGameCommand(runtime, state, {
      type: 'lifecycle/modelPresenceSet', modelId: original.id, presence: 'DESTROYED',
    })
    const removedRuntime = loadMatchRuntime(removed, developmentGameSystem)
    const legal = validateModelPlacement({
      state: removed, modelId: original.id, pose: { position: original.position, rotation: original.rotation },
    })
    expect(legal.valid).toBe(true)
    const restored = reduceGameCommand(removedRuntime, removed, {
      type: 'lifecycle/modelPlaced', modelId: original.id,
      pose: { position: original.position, rotation: original.rotation },
    })
    expect(restored.models.find((model) => model.id === original.id)?.id).toBe(original.id)
    expect(modelPresence(restored.models.find((model) => model.id === original.id)!)).toBe('ON_BATTLEFIELD')

    const removedAgain = reduceGameCommand(loadMatchRuntime(restored, developmentGameSystem), restored, {
      type: 'lifecycle/modelPresenceSet', modelId: original.id, presence: 'OFF_BOARD',
    })
    const blocker = removedAgain.models.find((model) => model.id === 'mdl-a-002')!
    const rejected = reduceGameCommand(loadMatchRuntime(removedAgain, developmentGameSystem), removedAgain, {
      type: 'lifecycle/modelPlaced', modelId: original.id,
      pose: { position: blocker.position, rotation: original.rotation },
    })
    expect(rejected).toBe(removedAgain)
    expect(modelPresence(rejected.models.find((model) => model.id === original.id)!)).toBe('OFF_BOARD')
  })

  it('uses the same transaction Undo for manual score changes', () => {
    const { state, runtime } = setup()
    const scored = reduceGameCommand(runtime, state, {
      type: 'score/eventRecorded', playerId: 'player-1', pointsDelta: 3, reason: 'Development check',
    })
    expect(scored.scoreHistory).toHaveLength(1)
    expect(scored.committedOperations?.at(-1)?.type).toBe('SCORE')
    const nextSequence = scored.nextActionSequence
    const undone = reduceGameCommand(loadMatchRuntime(scored, developmentGameSystem), scored, {
      type: 'history/undoLastCommitted',
    })
    expect(undone.scoreHistory).toBeUndefined()
    expect(undone.committedOperations).toEqual([])
    expect(undone.nextActionSequence).toBe(nextSequence)
  })

  it('keeps a unit with no active models safe for coherency and movement consumers', () => {
    const { state } = setup()
    const unit = state.units.find((candidate) => candidate.id === 'unit-a')!
    let current = state
    for (const modelId of unit.modelIds) {
      current = reduceGameCommand(loadMatchRuntime(current, developmentGameSystem), current, {
        type: 'lifecycle/modelPresenceSet', modelId, presence: 'DESTROYED',
      })
    }
    const active = activeBattlefieldModels(current)
    expect(active.some((model) => model.unitId === unit.id)).toBe(false)
    expect(evaluateUnitCoherency(unit, active, { distance: 1, requiredNeighbors: 1, requireConnected: true }).models)
      .toEqual([])
    expect(authorizeMovement(loadMatchRuntime(current, developmentGameSystem), current, unit.modelIds).allowed)
      .toBe(false)
  })

  it('undoes only the latest Smart Move or restoration after earlier casualties', () => {
    const { state } = setup()
    const unit = state.units.find((candidate) => candidate.id === 'unit-a')!
    const destroyedIds = unit.modelIds.slice(0, 3)
    let casualties = state
    for (const modelId of destroyedIds) {
      casualties = reduceGameCommand(loadMatchRuntime(casualties, developmentGameSystem), casualties, {
        type: 'lifecycle/modelPresenceSet', modelId, presence: 'DESTROYED',
      })
    }

    const survivors = activeBattlefieldModels(casualties).filter((model) => model.unitId === unit.id)
    expect(survivors).toHaveLength(7)
    const startingPositions = Object.fromEntries(survivors.map((model) => [model.id, { ...model.position }]))
    const finalPositions = Object.fromEntries(survivors.map((model) => [model.id, {
      x: model.position.x + 0.25, y: model.position.y,
    }]))
    const moved = reduceGameCommand(loadMatchRuntime(casualties, developmentGameSystem), casualties, {
      type: 'movement/validatedCandidateApplied', startingPositions, finalPositions,
      movementUsed: Object.fromEntries(survivors.map((model) => [model.id, 0.25])),
    })
    expect(moved.committedOperations?.at(-1)?.type).toBe('MOVE')

    const movementUndone = reduceGameCommand(loadMatchRuntime(moved, developmentGameSystem), moved, {
      type: 'history/undoLastCommitted',
    })
    expect(destroyedIds.every((id) => modelPresence(movementUndone.models.find((model) => model.id === id)! ) === 'DESTROYED')).toBe(true)
    expect(movementUndone.models.find((model) => model.id === survivors[0].id)?.position)
      .toEqual(startingPositions[survivors[0].id])

    const restoredId = destroyedIds[0]
    const restoredModel = movementUndone.models.find((model) => model.id === restoredId)!
    const restored = reduceGameCommand(loadMatchRuntime(movementUndone, developmentGameSystem), movementUndone, {
      type: 'lifecycle/modelPlaced', modelId: restoredId,
      pose: { position: restoredModel.position, rotation: restoredModel.rotation },
    })
    expect(modelPresence(restored.models.find((model) => model.id === restoredId)!)).toBe('ON_BATTLEFIELD')
    const restorationUndone = reduceGameCommand(loadMatchRuntime(restored, developmentGameSystem), restored, {
      type: 'history/undoLastCommitted',
    })
    expect(modelPresence(restorationUndone.models.find((model) => model.id === restoredId)!)).toBe('DESTROYED')
  })
})
