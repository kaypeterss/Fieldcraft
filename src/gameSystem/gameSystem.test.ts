import { describe, expect, it } from 'vitest'
import type { BattlefieldFeatureObject, TabletopModel } from '../domain/types'
import type { GameAction } from '../domain/types'
import type { ModelAreaRelationship } from '../engine/areaRelationships'
import type { GameSystem } from './types'
import {
  coherencyPolicyFor,
  evaluateMovementPermission,
  objectiveRelationshipQualifies,
  movementPermissionForUnit,
  terrainPolicyFor,
  turnConfigurationFor,
} from './policies'

const allow = { canEnter: true, canCross: true, canFinish: true }
const block = { canEnter: false, canCross: false, canFinish: false }

const permissiveSystem: GameSystem = {
  id: 'mock-permissive', name: 'Mock Permissive', version: '1',
  movement: {
    permissions: { actionLimit: { type: 'unlimited' }, allowance: { type: 'reset-per-action' } },
    cost: { type: 'free-rotation' },
  },
  coherency: { type: 'unit-definition' },
  terrain: { defaultBase: allow, defaultObject: block, rules: [] },
  visibility: { mode: 'any-to-any', terrainPolicy: 'objects-block' },
  objectives: { qualification: 'intersects' },
  turns: { phases: [] },
}

const constrainedSystem: GameSystem = {
  id: 'mock-constrained', name: 'Mock Constrained', version: '1',
  movement: {
    permissions: {
      actionLimit: { type: 'limited', maximumActions: 1, scope: 'phase' },
      allowance: { type: 'shared', scope: 'turn' },
    },
    cost: { type: 'fixed-rotation-charge', rotationCharge: 2 },
  },
  coherency: {
    type: 'game-system-default',
    policy: { distance: 2, requiredNeighbors: 2, requireConnected: true },
  },
  terrain: { defaultBase: block, defaultObject: block, rules: [] },
  visibility: { mode: 'any-to-all', terrainPolicy: 'base-blocks' },
  objectives: { qualification: 'wholly-within', control: { type: 'model-or-unit-value', defaultValue: 0 } },
  turns: { phases: [
    { id: 'move', name: 'Movement', allowsMovement: true },
    { id: 'resolve', name: 'Resolution', allowsMovement: false },
  ] },
}

describe('GameSystem policy boundary', () => {
  it('lets two systems configure different movement permissions and allowance accounting', () => {
    const facts = { baseAllowance: 6, actionsUsed: 1, movementUsed: 2.5 }
    expect(evaluateMovementPermission(permissiveSystem.movement.permissions, facts)).toEqual({
      canStartAction: true, remainingAllowance: 6, actionsRemaining: null,
    })
    expect(evaluateMovementPermission(constrainedSystem.movement.permissions, facts)).toEqual({
      canStartAction: false, remainingAllowance: 3.5, actionsRemaining: 0,
    })
    expect(evaluateMovementPermission(constrainedSystem.movement.permissions, {
      ...facts, additionalActions: 1, additionalAllowance: 2,
    })).toEqual({ canStartAction: true, remainingAllowance: 5.5, actionsRemaining: 1 })
  })

  it('interprets the same objective geometry through different qualifications', () => {
    const touchingOnly: ModelAreaRelationship = {
      placement: 'intersecting', intersects: true, centerWithin: false,
      whollyWithin: false, distanceInches: 0,
    }
    expect(objectiveRelationshipQualifies(permissiveSystem.objectives.qualification, touchingOnly)).toBe(true)
    expect(objectiveRelationshipQualifies(constrainedSystem.objectives.qualification, touchingOnly)).toBe(false)
  })

  it('supplies distinct visibility, terrain, coherency, movement-cost and phase configuration', () => {
    expect(permissiveSystem.visibility).toEqual({ mode: 'any-to-any', terrainPolicy: 'objects-block' })
    expect(constrainedSystem.visibility).toEqual({ mode: 'any-to-all', terrainPolicy: 'base-blocks' })
    expect(permissiveSystem.movement.cost.type).toBe('free-rotation')
    expect(constrainedSystem.movement.cost.type).toBe('fixed-rotation-charge')
    expect(terrainPolicyFor(permissiveSystem).defaultBase).toEqual(allow)
    expect(terrainPolicyFor(constrainedSystem).defaultBase).toEqual(block)
    expect(coherencyPolicyFor(permissiveSystem.coherency, {
      distance: 1, requiredNeighbors: 1,
    })).toEqual({ distance: 1, requiredNeighbors: 1 })
    expect(coherencyPolicyFor(constrainedSystem.coherency, undefined)?.requiredNeighbors).toBe(2)
    expect(turnConfigurationFor(constrainedSystem, ['p1', 'p2'])).toEqual({
      playerOrder: ['p1', 'p2'], phases: ['move', 'resolve'],
    })
  })

  it('prevents a second action only when a configured action limit requires it', () => {
    const priorMove = {
      type: 'MOVE', turnId: 'turn-1', phase: 'move', round: 1, turn: 1, turnSequence: 1,
      id: 'action-1', sequence: 1, playerId: 'p1',
      payload: { unitIds: ['u'], modelIds: ['m'], ownerIds: ['p1'], movementUsed: { m: 6 },
        startingPoses: {}, finalPoses: {}, trajectories: {}, startingPositions: {}, finalPositions: {},
        translationDistance: {}, angularRotation: {} },
    } as GameAction
    const constrained = movementPermissionForUnit({
      policy: constrainedSystem.movement.permissions, actions: [priorMove],
      gameContext: { round: 1, turn: 1, turnSequence: 1, turnId: 'turn-1', activePlayerId: 'p1', phase: 'move' },
      unitId: 'u', modelIds: ['m'], baseAllowance: 6,
    })
    const permissive = movementPermissionForUnit({
      policy: permissiveSystem.movement.permissions, actions: [priorMove],
      gameContext: { round: 1, turn: 1, turnSequence: 1, turnId: 'turn-1', activePlayerId: 'p1', phase: 'move' },
      unitId: 'u', modelIds: ['m'], baseAllowance: 6,
    })
    expect(constrained.canStartAction).toBe(false)
    expect(permissive.canStartAction).toBe(true)
  })

  it('keeps model and terrain-object keywords passive and JSON-safe', () => {
    const model: TabletopModel = {
      id: 'm', unitId: 'u', ownerId: 'p', position: { x: 0, y: 0 }, rotation: 0,
      base: { shape: 'circle', diameterMm: 32 }, canPassOverModels: false,
      keywords: ['infantry', 'fly'],
    }
    const object: BattlefieldFeatureObject = {
      id: 'wall', name: 'Wall', keywords: ['wall'],
      footprint: { shape: 'rectangle', widthMm: 100, heightMm: 10 },
      localPose: { position: { x: 0, y: 0 }, rotation: 0 },
    }
    expect(structuredClone({ model, object })).toEqual({ model, object })
  })
})
