import { describe, expect, it } from 'vitest'
import type { Footprint, TabletopModel } from '../domain/types'
import { footprintBounds, footprintsOverlap, poseForModel } from './geometry/footprints'
import { movementEnvelopeReach } from './movementEnvelope'
import { resolveModelRotation } from './rotation'
import { footprintDemoGameState } from '../game/initialState'
import { gameReducer } from '../state/reducer'

const battlefield = { width: 20, height: 20 }

function model(id: string, footprint: Footprint, x = 10, y = 10, rotation = 0): TabletopModel {
  return {
    id,
    unitId: 'unit',
    ownerId: 'player',
    position: { x, y },
    rotation,
    base: footprint,
    canPassOverModels: false,
  }
}

const oval: Footprint = { shape: 'ellipse', widthMm: 101.6, heightMm: 50.8 }
const rectangle: Footprint = { shape: 'rectangle', widthMm: 152.4, heightMm: 25.4 }
const polygon: Footprint = {
  shape: 'polygon',
  verticesMm: [
    { x: -50.8, y: -25.4 },
    { x: 50.8, y: -25.4 },
    { x: 25.4, y: 50.8 },
    { x: -38.1, y: 38.1 },
  ],
}
const circle: Footprint = { shape: 'circle', diameterMm: 25.4 }

describe('manual swept rotation', () => {
  it.each([
    ['oval', oval],
    ['rectangle', rectangle],
    ['polygon', polygon],
  ] as const)('rotates a clear %s through the complete requested angle', (_name, footprint) => {
    const moving = model('moving', footprint)
    const result = resolveModelRotation({
      allModels: [moving],
      modelId: moving.id,
      angularDelta: Math.PI / 2,
      battlefield,
    })
    expect(result.blocked).toBe(false)
    expect(result.angularRotation).toBeCloseTo(Math.PI / 2)
    expect(result.rotation).toBeCloseTo(Math.PI / 2)
  })

  it('stops before a rectangle corner sweeps through another footprint', () => {
    const moving = model('moving', rectangle, 10, 10, Math.PI / 4)
    const blocker = model('blocker', circle, 13.15, 10)
    const endRotation = moving.rotation - Math.PI / 2
    expect(footprintsOverlap(moving.base, poseForModel(moving), blocker.base, poseForModel(blocker))).toBe(false)
    expect(footprintsOverlap(
      moving.base,
      poseForModel({ ...moving, rotation: endRotation }),
      blocker.base,
      poseForModel(blocker),
    )).toBe(false)

    const result = resolveModelRotation({
      allModels: [moving, blocker],
      modelId: moving.id,
      angularDelta: -Math.PI / 2,
      battlefield,
    })
    expect(result.blocked).toBe(true)
    expect(result.angularRotation).toBeGreaterThan(0)
    expect(result.angularRotation).toBeLessThan(Math.PI / 2)
    expect(footprintsOverlap(
      moving.base,
      poseForModel({ ...moving, rotation: result.rotation }),
      blocker.base,
      poseForModel(blocker),
    )).toBe(false)
  })

  it('detects a battlefield crossing even when start and end rotations are legal', () => {
    const moving = model('moving', rectangle, 2.9, 10, Math.PI / 4)
    const endRotation = moving.rotation - Math.PI / 2
    const startBounds = footprintBounds(moving.base, poseForModel(moving))
    const endBounds = footprintBounds(moving.base, poseForModel({ ...moving, rotation: endRotation }))
    expect(startBounds.left).toBeGreaterThan(0)
    expect(endBounds.left).toBeGreaterThan(0)

    const result = resolveModelRotation({
      allModels: [moving],
      modelId: moving.id,
      angularDelta: -Math.PI / 2,
      battlefield,
    })
    expect(result.blocked).toBe(true)
    expect(result.angularRotation).toBeLessThan(Math.PI / 4)
    expect(footprintBounds(
      moving.base,
      poseForModel({ ...moving, rotation: result.rotation }),
    ).left).toBeGreaterThanOrEqual(-1e-8)
  })

  it('can rotate back away after reaching contact', () => {
    const moving = model('moving', rectangle, 2.9, 10, Math.PI / 4)
    const intoContact = resolveModelRotation({
      allModels: [moving], modelId: moving.id, angularDelta: -Math.PI / 4, battlefield,
    })
    expect(intoContact.blocked).toBe(true)
    const touching = { ...moving, rotation: intoContact.rotation }
    const away = resolveModelRotation({
      allModels: [touching], modelId: touching.id, angularDelta: Math.PI / 8, battlefield,
    })
    expect(away.angularRotation).toBeCloseTo(Math.PI / 8, 5)
    expect(away.blocked).toBe(false)
  })

  it('stores circle rotation without changing circle geometry or envelope reach', () => {
    const moving = model('moving', circle)
    const before = footprintBounds(moving.base, poseForModel(moving))
    const result = resolveModelRotation({
      allModels: [moving], modelId: moving.id, angularDelta: Math.PI * 0.75, battlefield,
    })
    const after = footprintBounds(moving.base, poseForModel({ ...moving, rotation: result.rotation }))
    expect(result).toMatchObject({ angularRotation: Math.PI * 0.75, blocked: false })
    expect(after).toEqual(before)
    expect(movementEnvelopeReach(
      moving.base,
      poseForModel(moving),
      poseForModel({ ...moving, rotation: result.rotation }),
    ).distance).toBe(0)
  })
})

describe('rotation movement lifecycle', () => {
  it('Cancel restores the exact starting rotation', () => {
    const state = structuredClone(footprintDemoGameState)
    const target = state.models.find((entry) => entry.id === 'demo-ellipse')!
    const started = gameReducer(state, {
      type: 'movement/sessionStarted', sessionId: 'rotate-cancel', modelIds: [target.id],
    })
    const rotated = gameReducer(started, {
      type: 'movement/rotationRequested', modelId: target.id, rotation: target.rotation + 0.6,
    })
    expect(rotated.models.find((entry) => entry.id === target.id)?.rotation).not.toBe(target.rotation)
    const cancelled = gameReducer(rotated, { type: 'movement/cancelled' })
    expect(cancelled.models.find((entry) => entry.id === target.id)).toMatchObject({
      position: target.position,
      rotation: target.rotation,
    })
  })

  it('records complete poses and Undo restores translation plus rotation', () => {
    const state = structuredClone(footprintDemoGameState)
    const target = state.models.find((entry) => entry.id === 'demo-ellipse')!
    const started = gameReducer(state, {
      type: 'movement/sessionStarted', sessionId: 'pose-action', modelIds: [target.id],
    })
    const translated = gameReducer(started, {
      type: 'movement/requested',
      positions: { [target.id]: { x: target.position.x, y: target.position.y + 1 } },
    })
    const rotated = gameReducer(translated, {
      type: 'movement/rotationRequested', modelId: target.id, rotation: target.rotation + 0.4,
    })
    const finalModel = rotated.models.find((entry) => entry.id === target.id)!
    const confirmed = gameReducer(rotated, { type: 'movement/confirmed' })
    const action = confirmed.actionHistory.at(-1)!
    expect(action.payload.startingPoses[target.id]).toEqual({
      position: target.position,
      rotation: target.rotation,
    })
    expect(action.payload.finalPoses[target.id]).toEqual({
      position: finalModel.position,
      rotation: finalModel.rotation,
    })
    expect(action.payload.translationDistance[target.id]).toBeCloseTo(1)
    expect(action.payload.angularRotation[target.id]).toBeCloseTo(0.4)
    expect(action.payload.movementUsed[target.id]).toBeCloseTo(movementEnvelopeReach(
      target.base,
      { position: target.position, rotation: target.rotation },
      { position: finalModel.position, rotation: finalModel.rotation },
    ).distance)

    const undone = gameReducer(confirmed, { type: 'movement/undoLastConfirmed' })
    expect(undone.models.find((entry) => entry.id === target.id)).toMatchObject({
      position: target.position,
      rotation: target.rotation,
    })
  })
})
