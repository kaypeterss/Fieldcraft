import { describe, expect, it } from 'vitest'
import type { Footprint, GameState, MovementPolicyConfig } from '../domain/types'
import { footprintDemoGameState } from '../game/initialState'
import { gameReducer } from '../state/reducer'
import {
  movementEnvelopeReach,
  poseFitsMovementEnvelope,
  projectPoseIntoMovementEnvelope,
} from './movementEnvelope'
import {
  calculatePathMovementCost,
  maximumAdditionalPathRotation,
  maximumAdditionalPathTranslation,
} from './movementCost'

const ellipse: Footprint = { shape: 'ellipse', widthMm: 101.6, heightMm: 50.8 }
const rectangle: Footprint = { shape: 'rectangle', widthMm: 101.6, heightMm: 50.8 }
const polygon: Footprint = {
  shape: 'polygon',
  verticesMm: [
    { x: -50.8, y: -25.4 }, { x: 50.8, y: -25.4 },
    { x: 50.8, y: 25.4 }, { x: -50.8, y: 25.4 },
  ],
}

const startPose = { position: { x: 20, y: 20 }, rotation: Math.PI / 2 }

describe('Movement Envelope geometry', () => {
  it('preserves the full allowance for translation-only movement', () => {
    const candidate = { position: { x: 30, y: 20 }, rotation: startPose.rotation }
    expect(movementEnvelopeReach(ellipse, startPose, candidate).distance).toBeCloseTo(10)
    expect(poseFitsMovementEnvelope(ellipse, startPose, candidate, 10)).toBe(true)
  })

  it('retreats an oval by the minimum required amount after full translation and rotation', () => {
    const projected = projectPoseIntoMovementEnvelope(
      ellipse, startPose, { position: { x: 30, y: 20 }, rotation: 0 }, 10,
    )
    expect(projected.pose.position.x).toBeCloseTo(29, 4)
    expect(projected.pose.position.y).toBeCloseTo(20, 4)
    expect(projected.retreat.x).toBeCloseTo(-1, 4)
    expect(projected.reach).toBeCloseTo(10, 5)
  })

  it('reduces subsequent center reach when the oval rotates first', () => {
    const rotated = { position: startPose.position, rotation: 0 }
    expect(poseFitsMovementEnvelope(ellipse, startPose, rotated, 10)).toBe(true)
    expect(poseFitsMovementEnvelope(
      ellipse, startPose, { position: { x: 29, y: 20 }, rotation: 0 }, 10,
    )).toBe(true)
    expect(poseFitsMovementEnvelope(
      ellipse, startPose, { position: { x: 29.01, y: 20 }, rotation: 0 }, 10,
    )).toBe(false)
  })

  it('handles partial oval rotation from actual support geometry', () => {
    const projected = projectPoseIntoMovementEnvelope(
      ellipse, startPose, { position: { x: 30, y: 20 }, rotation: Math.PI / 4 }, 10,
    )
    expect(projected.reach).toBeCloseTo(10, 5)
    expect(Math.hypot(projected.retreat.x, projected.retreat.y)).toBeGreaterThan(0)
    const towardRequested = {
      position: {
        x: projected.pose.position.x - projected.retreat.x * 0.001,
        y: projected.pose.position.y - projected.retreat.y * 0.001,
      },
      rotation: projected.pose.rotation,
    }
    expect(poseFitsMovementEnvelope(ellipse, startPose, towardRequested, 10)).toBe(false)
  })

  it.each([
    ['rectangle', rectangle],
    ['convex polygon', polygon],
  ] as const)('uses actual %s geometry', (_name, footprint) => {
    const projected = projectPoseIntoMovementEnvelope(
      footprint, startPose, { position: { x: 30, y: 20 }, rotation: 0 }, 10,
    )
    expect(projected.pose.position.x).toBeCloseTo(29, 4)
    expect(projected.reach).toBeCloseTo(10, 5)
  })

  it('does not reduce circle reach when only its stored rotation changes', () => {
    const circle: Footprint = { shape: 'circle', diameterMm: 50.8 }
    expect(movementEnvelopeReach(circle, startPose, {
      position: { x: 30, y: 20 }, rotation: Math.PI * 1.75,
    }).distance).toBeCloseTo(10)
  })
})

describe('movement policy integration', () => {
  it('automatically retreats after translate-then-rotate', () => {
    const state = startSession(singleModelState(ellipse, 10), { type: 'movement-envelope' })
    const translated = requestTranslation(state, 10)
    const rotated = gameReducer(translated, {
      type: 'movement/rotationRequested', modelId: 'subject', rotation: 0,
    })
    expect(subject(rotated).position.x).toBeCloseTo(29, 4)
    expect(rotated.movementSession?.models.subject.movementUsed).toBeCloseTo(10, 5)
    const retreatSegment = rotated.movementSession?.models.subject.trajectory.segments.at(-1)
    expect(retreatSegment?.endPose.position.x).toBeCloseTo(29, 4)
    expect(retreatSegment?.angularDelta).toBeCloseTo(-Math.PI / 2)
  })

  it('enforces the reduced reach after rotate-then-translate', () => {
    const state = startSession(singleModelState(ellipse, 10), { type: 'movement-envelope' })
    const rotated = gameReducer(state, {
      type: 'movement/rotationRequested', modelId: 'subject', rotation: 0,
    })
    const translated = requestTranslation(rotated, 10)
    expect(subject(translated).position.x).toBeCloseTo(29, 4)
  })

  it('preserves fixed-charge and free-rotation path-cost policies', () => {
    const fixed = { type: 'fixed-rotation-charge', rotationCharge: 2 } as const
    const metrics = { translationDistance: 1, angularDistance: 0.5 }
    expect(calculatePathMovementCost(fixed, metrics)).toEqual({
      translationCost: 1, rotationCost: 2, totalCost: 3,
    })
    expect(maximumAdditionalPathTranslation(fixed, metrics, 6)).toBe(3)
    expect(maximumAdditionalPathRotation(fixed, { translationDistance: 4, angularDistance: 0 }, 6))
      .toBe(Number.POSITIVE_INFINITY)
    expect(calculatePathMovementCost({ type: 'free-rotation' }, metrics).totalCost).toBe(1)
  })

  it('Cancel and Undo restore the complete starting pose', () => {
    const initial = singleModelState(rectangle, 10)
    const moved = gameReducer(requestTranslation(startSession(initial, { type: 'movement-envelope' }), 5), {
      type: 'movement/rotationRequested', modelId: 'subject', rotation: 0,
    })
    const cancelled = gameReducer(moved, { type: 'movement/cancelled' })
    expect(subject(cancelled)).toMatchObject({ position: startPose.position, rotation: startPose.rotation })

    const confirmed = gameReducer(moved, { type: 'movement/confirmed' })
    const undone = gameReducer(confirmed, { type: 'movement/undoLastConfirmed' })
    expect(subject(undone)).toMatchObject({ position: startPose.position, rotation: startPose.rotation })
  })
})

function singleModelState(footprint: Footprint, allowance: number): GameState {
  const state = structuredClone(footprintDemoGameState)
  state.models = [{
    id: 'subject', unitId: 'subject-unit', ownerId: 'player-1', base: footprint,
    position: { ...startPose.position }, rotation: startPose.rotation, canPassOverModels: false,
  }]
  state.units = [{ id: 'subject-unit', ownerId: 'player-1', definitionId: 'subject-definition', modelIds: ['subject'] }]
  state.unitDefinitions = [{ id: 'subject-definition', name: 'Subject', movementAllowance: allowance }]
  state.movementSession = null
  state.actionHistory = []
  state.lastConfirmedMovementUndo = null
  return state
}

function startSession(state: GameState, movementPolicy: MovementPolicyConfig): GameState {
  return gameReducer(state, {
    type: 'movement/sessionStarted', sessionId: 'test-session', modelIds: ['subject'], movementPolicy,
  })
}

function requestTranslation(state: GameState, x: number): GameState {
  const model = subject(state)
  return gameReducer(state, {
    type: 'movement/requested', positions: { subject: { x: model.position.x + x, y: model.position.y } },
  })
}

function subject(state: GameState) { return state.models.find((model) => model.id === 'subject')! }
