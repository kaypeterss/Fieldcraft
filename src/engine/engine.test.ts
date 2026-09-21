import { describe, expect, it } from 'vitest'
import type { GameState, TabletopModel } from '../domain/types'
import { circleIntersectsRectangle, clampGroupDelta, clampModelPosition, isPointInsideBattlefield } from './geometry/battlefield'
import { circularEdgeDistance, circlesOverlap, isGroupPlacementValid } from './geometry/circles'
import { firstCirclePathCollisionT } from './geometry/circles'
import { distanceBetween } from './geometry/point'
import { inchesToMillimeters, millimetersToInches } from './units'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { gameReducer } from '../state/reducer'
import { measureBetweenCircularModels } from '../tools/measurement'
import { DRAG_THRESHOLD_PIXELS, hasDragIntent, selectionForModelPointerDown } from '../tools/selection'
import { isEditableKeyboardTarget, isUndoMovementShortcut } from '../tools/keyboard'
import { appendAcceptedPathPoint, resolveGroupMovement, resolveMovement } from './movement'
import { initialGameState } from '../game/initialState'

const battlefield = { width: 60, height: 44 }
const model: TabletopModel = {
  id: 'model-1', unitId: 'unit-1', ownerId: 'player-a',
  position: { x: 10, y: 10 }, rotation: 0,
  base: { shape: 'circle', diameterMm: 25.4 },
  canPassOverModels: false,
}

function circularModel(id: string, x: number, y: number, diameterMm = 25.4): TabletopModel {
  return { ...model, id, position: { x, y }, base: { shape: 'circle', diameterMm } }
}

function relativeOffset(a: TabletopModel, b: TabletopModel) {
  return { x: b.position.x - a.position.x, y: b.position.y - a.position.y }
}

describe('unit conversion', () => {
  it('converts millimeters to inches', () => expect(millimetersToInches(25.4)).toBeCloseTo(1, 12))
  it('converts inches to millimeters', () => expect(inchesToMillimeters(2)).toBeCloseTo(50.8, 12))
})

describe('geometry', () => {
  it('calculates center-to-center distance', () => expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5))
  it('calculates circular edge distance', () => expect(circularEdgeDistance({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1.5)).toBe(2.5))
  it('returns zero for touching circles', () => expect(circularEdgeDistance({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, 1)).toBe(0))
  it('returns zero for overlapping circles', () => expect(circularEdgeDistance({ x: 0, y: 0 }, 2, { x: 1, y: 0 }, 2)).toBe(0))
  it('measures known diagonal circle coordinates', () => expect(circularEdgeDistance({ x: 1, y: 1 }, 0.5, { x: 4, y: 5 }, 0.5)).toBe(4))
  it('allows separated and exactly touching circles', () => {
    expect(circlesOverlap({ x: 0, y: 0 }, 1, { x: 2.1, y: 0 }, 1)).toBe(false)
    expect(circlesOverlap({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, 1)).toBe(false)
  })
  it('rejects overlapping circles', () => expect(circlesOverlap({ x: 0, y: 0 }, 1, { x: 1.9, y: 0 }, 1)).toBe(true))
  it('finds first continuous path contact and allows tangency', () => {
    expect(firstCirclePathCollisionT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 1)).toBeCloseTo(0.4)
    expect(firstCirclePathCollisionT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 }, 2)).toBeNull()
  })
  it('allows escape from contact and tiny overlap but blocks inward motion', () => {
    const contact = { x: 2, y: 0 }
    expect(firstCirclePathCollisionT(contact, { x: 4, y: 0 }, { x: 0, y: 0 }, 2)).toBeNull()
    expect(firstCirclePathCollisionT(contact, { x: 1, y: 0 }, { x: 0, y: 0 }, 2)).toBe(0)
    const tinyOverlap = { x: 1.9999999995, y: 0 }
    expect(firstCirclePathCollisionT(tinyOverlap, { x: 4, y: 0 }, { x: 0, y: 0 }, 2)).toBeNull()
  })
})

describe('battlefield boundaries', () => {
  it('recognizes points inside and outside', () => {
    expect(isPointInsideBattlefield({ x: 0, y: 44 }, battlefield)).toBe(true)
    expect(isPointInsideBattlefield({ x: 60.001, y: 20 }, battlefield)).toBe(false)
  })
  it('clamps a model by its base edge', () => {
    expect(clampModelPosition({ x: -10, y: 50 }, model, battlefield)).toEqual({ x: 0.5, y: 43.5 })
  })
  it('clamps a shared group delta without changing formation', () => {
    const models = [model, { ...model, id: 'model-2', position: { x: 59, y: 20 } }]
    expect(clampGroupDelta({ x: 10, y: 0 }, models, battlefield)).toEqual({ x: 0.5, y: 0 })
  })
  it('selects using circular base geometry against a rectangle', () => {
    expect(circleIntersectsRectangle({ x: 5, y: 5 }, 1, { left: 5.5, top: 4, right: 7, bottom: 6 })).toBe(true)
    expect(circleIntersectsRectangle({ x: 5, y: 5 }, 1, { left: 7, top: 4, right: 8, bottom: 6 })).toBe(false)
  })

  it.each([
    ['left', { x: -20, y: 10 }, { x: 0.5, y: 10 }],
    ['right', { x: 80, y: 10 }, { x: 59.5, y: 10 }],
    ['top', { x: 10, y: -20 }, { x: 10, y: 0.5 }],
    ['bottom', { x: 10, y: 70 }, { x: 10, y: 43.5 }],
  ])('stops a 25mm model at the %s boundary', (_edge, requested, expected) => {
    const moving = circularModel('moving', 10, 10)
    const resolution = resolveMovement({
      allModels: [moving],
      requestedPositions: new Map([['moving', requested]]),
      battlefield,
    })
    expect(resolution.positions.get('moving')).toEqual(expected)
  })

  it('slides an individual model along every wall and counts only accepted distance', () => {
    const right = circularModel('right', 59.5, 10)
    const rightMove = resolveMovement({
      allModels: [right],
      requestedPositions: new Map([['right', { x: 70, y: 15 }]]),
      battlefield,
    })
    expect(rightMove.positions.get('right')).toEqual({ x: 59.5, y: 15 })
    expect(rightMove.distances.get('right')).toBeCloseTo(5)

    const left = circularModel('left', 0.5, 10)
    const leftMove = resolveMovement({
      allModels: [left],
      requestedPositions: new Map([['left', { x: -10, y: 15 }]]),
      battlefield,
    })
    expect(leftMove.positions.get('left')).toEqual({ x: 0.5, y: 15 })

    const top = circularModel('top', 10, 0.5)
    const topMove = resolveMovement({
      allModels: [top],
      requestedPositions: new Map([['top', { x: 15, y: -10 }]]),
      battlefield,
    })
    expect(topMove.positions.get('top')).toEqual({ x: 15, y: 0.5 })

    const bottom = circularModel('bottom', 10, 43.5)
    const bottomMove = resolveMovement({
      allModels: [bottom],
      requestedPositions: new Map([['bottom', { x: 15, y: 60 }]]),
      battlefield,
    })
    expect(bottomMove.positions.get('bottom')).toEqual({ x: 15, y: 43.5 })
  })

  it('allows immediate movement away from every wall', () => {
    const positions = [
      ['left', { x: 0.5, y: 10 }, { x: 5, y: 10 }],
      ['right', { x: 59.5, y: 10 }, { x: 55, y: 10 }],
      ['top', { x: 10, y: 0.5 }, { x: 10, y: 5 }],
      ['bottom', { x: 10, y: 43.5 }, { x: 10, y: 40 }],
    ] as const
    for (const [id, start, end] of positions) {
      const moving = circularModel(id, start.x, start.y)
      const resolution = resolveMovement({ allModels: [moving], requestedPositions: new Map([[id, end]]), battlefield })
      expect(resolution.positions.get(id)).toEqual(end)
    }
  })

  it('uses larger base extents for boundary contact', () => {
    const small = circularModel('small', 10, 10, 25)
    const large = circularModel('large', 10, 20, 50)
    const smallResolution = resolveMovement({
      allModels: [small],
      requestedPositions: new Map([['small', { x: 80, y: 10 }]]),
      battlefield,
    })
    const largeResolution = resolveMovement({
      allModels: [large],
      requestedPositions: new Map([['large', { x: 80, y: 20 }]]),
      battlefield,
    })
    expect(smallResolution.positions.get('small')?.x).toBeCloseTo(60 - millimetersToInches(25) / 2)
    expect(largeResolution.positions.get('large')?.x).toBeCloseTo(60 - millimetersToInches(50) / 2)
  })

  it.each([
    ['top-left', { x: 0.5, y: 0.5 }, { x: -10, y: -10 }],
    ['top-right', { x: 59.5, y: 0.5 }, { x: 70, y: -10 }],
    ['bottom-left', { x: 0.5, y: 43.5 }, { x: -10, y: 60 }],
    ['bottom-right', { x: 59.5, y: 43.5 }, { x: 70, y: 60 }],
  ])('stops cleanly at the %s corner and resumes away', (_corner, start, inward) => {
    const moving = circularModel('corner', start.x, start.y)
    const stopped = resolveMovement({ allModels: [moving], requestedPositions: new Map([['corner', inward]]), battlefield })
    expect(stopped.positions.get('corner')).toEqual(start)
    const away = {
      x: start.x === 0.5 ? 5 : 55,
      y: start.y === 0.5 ? 5 : 40,
    }
    const resumed = resolveMovement({ allModels: [moving], requestedPositions: new Map([['corner', away]]), battlefield })
    expect(resumed.positions.get('corner')).toEqual(away)
  })
})

describe('pointer intent and selection', () => {
  it('uses a stable screen-pixel threshold for drag intent', () => {
    expect(hasDragIntent({ x: 100, y: 100 }, { x: 103, y: 100 })).toBe(false)
    expect(hasDragIntent({ x: 100, y: 100 }, { x: 100 + DRAG_THRESHOLD_PIXELS, y: 100 })).toBe(true)
  })

  it('keeps regular, Shift, and Ctrl/Cmd selection semantics distinct', () => {
    const selected = new Set(['model-1', 'model-2'])
    expect([...selectionForModelPointerDown(selected, 'model-1', ['model-1', 'model-3'], { shiftKey: false, unitKey: false })]).toEqual(['model-1'])
    expect([...selectionForModelPointerDown(selected, 'model-1', ['model-1', 'model-3'], { shiftKey: true, unitKey: false })]).toEqual(['model-2'])
    expect([...selectionForModelPointerDown(selected, 'model-1', ['model-1', 'model-3'], { shiftKey: false, unitKey: true })]).toEqual(['model-1', 'model-3'])
  })

  it('gives the unit modifier precedence without adding Ctrl/Cmd+Shift behavior', () => {
    expect([...selectionForModelPointerDown(
      new Set(['model-2']),
      'model-1',
      ['model-1', 'model-3'],
      { shiftKey: true, unitKey: true },
    )]).toEqual(['model-1', 'model-3'])
  })
})

describe('authoritative state', () => {
  const state: GameState = {
    schemaVersion: 2,
    battlefield,
    models: [model],
    units: [{ id: 'unit-1', ownerId: 'player-a', definitionId: 'definition-1', modelIds: ['model-1'] }],
    unitDefinitions: [{ id: 'definition-1', name: 'Test Unit', movementAllowance: 6 }],
    movementSession: null,
  }

  it('applies a deterministic move without mutating the previous state', () => {
    const action = { type: 'models/moved' as const, positions: { 'model-1': { x: 12.25, y: 13.75 } } }
    const first = gameReducer(state, action)
    const second = gameReducer(state, action)
    expect(first).toEqual(second)
    expect(first.models[0].position).toEqual({ x: 12.25, y: 13.75 })
    expect(state.models[0].position).toEqual({ x: 10, y: 10 })
  })

  it('round-trips through JSON serialization', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('rejects moving a model into another model', () => {
    const other = { ...model, id: 'model-2', position: { x: 15, y: 10 }, base: { shape: 'circle' as const, diameterMm: 50.8 } }
    const crowdedState = { ...state, models: [model, other] }
    const next = gameReducer(crowdedState, { type: 'models/moved', positions: { 'model-1': { x: 14.5, y: 10 } } })
    expect(next.models[0].position.x).toBeCloseTo(13.5)
  })

  it('allows a group to touch and ignores collisions within the moving group', () => {
    const second = { ...model, id: 'model-2', position: { x: 2, y: 10 } }
    const blocker = { ...model, id: 'model-3', position: { x: 30, y: 10 } }
    const groupState = { ...state, models: [model, second, blocker] }
    const validGroup = new Map([
      ['model-1', { x: 10, y: 10 }],
      ['model-2', { x: 11, y: 10 }],
    ])
    expect(isGroupPlacementValid(groupState.models, validGroup)).toBe(true)
    const blockedGroup = new Map([
      ['model-1', { x: 29.5, y: 10 }],
      ['model-2', { x: 30.5, y: 10 }],
    ])
    expect(isGroupPlacementValid(groupState.models, blockedGroup)).toBe(false)
  })

  it('blocks a large jump through a model at first contact', () => {
    const blocker = { ...model, id: 'blocker', position: { x: 20, y: 10 }, canPassOverModels: false }
    const resolved = resolveGroupMovement([model, blocker], new Map([['model-1', { x: 30, y: 10 }]]), battlefield)
    expect(resolved.get('model-1')?.x).toBeCloseTo(19)
  })

  it('does not accumulate overlap across repeated collisions', () => {
    const blocker = { ...model, id: 'blocker', position: { x: 20, y: 10 }, base: { shape: 'circle' as const, diameterMm: 50.8 } }
    const first = resolveGroupMovement([model, blocker], new Map([['model-1', { x: 40, y: 10 }]]), battlefield)
    const touching = { ...model, position: first.get('model-1') ?? model.position }
    expect(isGroupPlacementValid([touching, blocker], new Map([['model-1', touching.position]]))).toBe(true)
    const away = resolveGroupMovement([touching, blocker], new Map([['model-1', { x: 10, y: 10 }]]), battlefield)
    expect(away.get('model-1')?.x).toBeLessThan(touching.position.x)
  })

  it('allows pass-over models to cross but not finish overlapping', () => {
    const flyer = { ...model, canPassOverModels: true }
    const blocker = { ...model, id: 'blocker', position: { x: 20, y: 10 }, canPassOverModels: false }
    expect(resolveGroupMovement([flyer, blocker], new Map([['model-1', { x: 30, y: 10 }]]), battlefield).get('model-1')).toEqual({ x: 30, y: 10 })
    const stopped = resolveGroupMovement([flyer, blocker], new Map([['model-1', { x: 20, y: 10 }]]), battlefield).get('model-1')
    expect(stopped?.x).toBeCloseTo(19)
  })

  it('derives a measurement from current model positions', () => {
    const moved = { ...model, position: { x: 14, y: 10 } }
    const initial = measureBetweenCircularModels(model, { ...model, id: 'model-2', position: { x: 15, y: 10 } })
    const afterMove = measureBetweenCircularModels(moved, { ...model, id: 'model-2', position: { x: 15, y: 10 } })
    expect(afterMove.distanceInches).toBeLessThan(initial.distanceInches)
    expect(measureBetweenCircularModels(model, { ...model, id: 'model-2', position: { x: 11, y: 10 } }).distanceInches).toBe(0)
  })
})

describe('units and movement sessions', () => {
  const sessionState: GameState = {
    schemaVersion: 2,
    battlefield,
    models: [
      model,
      { ...model, id: 'model-2', unitId: 'unit-2', position: { x: 10, y: 20 } },
    ],
    units: [
      { id: 'unit-1', ownerId: 'player-a', definitionId: 'definition-1', modelIds: ['model-1'] },
      { id: 'unit-2', ownerId: 'player-a', definitionId: 'definition-2', modelIds: ['model-2'] },
    ],
    unitDefinitions: [
      { id: 'definition-1', name: 'Fast', movementAllowance: 6 },
      { id: 'definition-2', name: 'Slow', movementAllowance: 3 },
    ],
    movementSession: null,
  }

  it('keeps normalized Unit and UnitDefinition relationships independent', () => {
    expect(initialGameState.units).toHaveLength(3)
    expect(initialGameState.units[0].modelIds).toHaveLength(10)
    expect(initialGameState.units[1].modelIds).toHaveLength(5)
    expect(initialGameState.units[0].ownerId).toBe('player-a')
    expect(initialGameState.unitDefinitions.find((definition) => definition.id === initialGameState.units[0].definitionId)?.movementAllowance).toBe(6)
  })

  it('captures a stable movement reference point for a group session', () => {
    const active = gameReducer(sessionState, {
      type: 'movement/sessionStarted',
      sessionId: 'move-reference',
      modelIds: ['model-1', 'model-2'],
    })
    expect(active.movementSession?.referenceStart).toEqual({ x: 10, y: 15 })
    expect(active.movementSession?.referencePath).toEqual([{ x: 10, y: 15 }])
  })

  it('accumulates actual accepted path segments when direction changes', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'move-test', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 12, y: 10 } } })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 12, y: 13 } } })
    expect(current.movementSession?.models['model-1'].movementUsed).toBe(5)
    expect(current.movementSession?.models['model-1'].path).toEqual([{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 13 }])
  })

  it('stops exactly at allowance and preserves full precision', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'move-limit', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 20, y: 10 } } })
    expect(current.models[0].position.x).toBe(16)
    expect(current.movementSession?.models['model-1'].movementUsed).toBe(6)
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 25, y: 10 } } })
    expect(current.models[0].position.x).toBe(16)
  })

  it('tracks different movement usage for models in the same session', () => {
    const sameUnitState: GameState = {
      ...sessionState,
      models: sessionState.models.map((candidate) => ({ ...candidate, unitId: 'unit-1' })),
      units: [{ id: 'unit-1', ownerId: 'player-a', definitionId: 'definition-1', modelIds: ['model-1', 'model-2'] }],
    }
    let current = gameReducer(sameUnitState, { type: 'movement/sessionStarted', sessionId: 'move-split', modelIds: ['model-1', 'model-2'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 12.25, y: 10 } } })
    expect(current.movementSession?.models['model-1'].movementUsed).toBe(2.25)
    expect(current.movementSession?.models['model-2'].movementUsed).toBe(0)
  })

  it('stops a translated group at the earliest allowance while preserving formation', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'move-group', modelIds: ['model-1', 'model-2'] })
    current = gameReducer(current, { type: 'movement/requested', positions: {
      'model-1': { x: 20, y: 10 },
      'model-2': { x: 20, y: 20 },
    } })
    expect(current.models[0].position).toEqual({ x: 13, y: 10 })
    expect(current.models[1].position).toEqual({ x: 13, y: 20 })
    expect(current.movementSession?.models['model-1'].movementUsed).toBe(3)
    expect(current.movementSession?.models['model-2'].movementUsed).toBe(3)
    expect(current.movementSession?.referencePath).toEqual([{ x: 10, y: 15 }, { x: 13, y: 15 }])
  })

  it('records one reference path across multiple accepted rigid translations', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'move-group-path', modelIds: ['model-1', 'model-2'] })
    current = gameReducer(current, { type: 'movement/requested', positions: {
      'model-1': { x: 12, y: 10 },
      'model-2': { x: 12, y: 20 },
    } })
    current = gameReducer(current, { type: 'movement/requested', positions: {
      'model-1': { x: 12, y: 12 },
      'model-2': { x: 12, y: 22 },
    } })
    expect(current.movementSession?.referencePath).toEqual([
      { x: 10, y: 15 },
      { x: 12, y: 15 },
      { x: 12, y: 16 },
    ])
  })

  it('records collision-limited group sliding in the reference path only', () => {
    const first = circularModel('model-1', 10, 10)
    const second = { ...circularModel('model-2', 10, 13), unitId: 'unit-1' }
    const blocker = { ...circularModel('blocker', 15, 10), unitId: 'unit-2' }
    const state: GameState = {
      ...sessionState,
      models: [first, second, blocker],
      units: [
        { id: 'unit-1', ownerId: 'player-a', definitionId: 'definition-1', modelIds: ['model-1', 'model-2'] },
        { id: 'unit-2', ownerId: 'player-a', definitionId: 'definition-2', modelIds: ['blocker'] },
      ],
    }
    const started = gameReducer(state, { type: 'movement/sessionStarted', sessionId: 'move-slide-path', modelIds: ['model-1', 'model-2'] })
    const moved = gameReducer(started, { type: 'movement/requested', positions: {
      'model-1': { x: 18, y: 11 },
      'model-2': { x: 18, y: 14 },
    } })
    const referencePath = moved.movementSession?.referencePath ?? []
    expect(referencePath.length).toBeGreaterThanOrEqual(3)
    expect(referencePath.at(-1)?.y).toBeGreaterThan(11.5)
    expect(moved.movementSession?.models['model-1'].movementUsed).toBeCloseTo(
      referencePath.slice(1).reduce((total, point, index) => total + distanceBetween(referencePath[index], point), 0),
    )
  })

  it('does not extend the reference path for rejected group movement', () => {
    const blocker = { ...circularModel('blocker', 12, 10), unitId: 'unit-2' }
    const state = { ...sessionState, models: [...sessionState.models, blocker] }
    const started = gameReducer(state, { type: 'movement/sessionStarted', sessionId: 'move-rejected-path', modelIds: ['model-1', 'model-2'] })
    const moved = gameReducer(started, { type: 'movement/requested', positions: {
      'model-1': { x: 20, y: 10 },
      'model-2': { x: 20, y: 20 },
    } })
    expect(moved.movementSession?.referencePath).toEqual([{ x: 10, y: 15 }, { x: 11, y: 15 }])
    const pushedAgain = gameReducer(moved, { type: 'movement/requested', positions: {
      'model-1': { x: 20, y: 10 },
      'model-2': { x: 20, y: 20 },
    } })
    expect(pushedAgain.movementSession?.referencePath).toEqual(moved.movementSession?.referencePath)
  })

  it('charges only collision-accepted and boundary-accepted distance', () => {
    const blocker = { ...model, id: 'blocker', unitId: 'unit-2', position: { x: 14, y: 10 } }
    const collision = resolveMovement({
      allModels: [model, blocker],
      requestedPositions: new Map([['model-1', { x: 20, y: 10 }]]),
      battlefield,
      remainingMovement: new Map([['model-1', 20]]),
    })
    expect(collision.positions.get('model-1')?.x).toBeCloseTo(13)
    expect(collision.distances.get('model-1')).toBeCloseTo(3)
    const boundary = resolveMovement({
      allModels: [model],
      requestedPositions: new Map([['model-1', { x: -20, y: 10 }]]),
      battlefield,
      remainingMovement: new Map([['model-1', 20]]),
    })
    expect(boundary.positions.get('model-1')?.x).toBeCloseTo(0.5)
    expect(boundary.distances.get('model-1')).toBeCloseTo(9.5)
  })

  it('slides an individual model along a blocker on a diagonal approach', () => {
    const blocker = { ...model, id: 'blocker', position: { x: 14, y: 10 } }
    const resolution = resolveMovement({
      allModels: [model, blocker],
      requestedPositions: new Map([['model-1', { x: 18, y: 12 }]]),
      battlefield,
      remainingMovement: new Map([['model-1', 20]]),
    })
    const accepted = resolution.positions.get('model-1')!
    const path = resolution.paths.get('model-1')!
    expect(path.length).toBeGreaterThanOrEqual(3)
    expect(accepted.x).toBeGreaterThan(13)
    expect(accepted.y).toBeGreaterThan(10)
    expect(isGroupPlacementValid([model, blocker], new Map([['model-1', accepted]]))).toBe(true)
    expect(resolution.distances.get('model-1')).toBeCloseTo(
      path.slice(1).reduce((total, point, index) => total + distanceBetween(path[index], point), 0),
    )
  })

  it('keeps a direct center push blocked at first contact', () => {
    const blocker = { ...model, id: 'blocker', position: { x: 14, y: 10 } }
    const resolution = resolveMovement({
      allModels: [model, blocker],
      requestedPositions: new Map([['model-1', { x: 18, y: 10 }]]),
      battlefield,
    })
    expect(resolution.positions.get('model-1')).toEqual({ x: 13, y: 10 })
    expect(resolution.distances.get('model-1')).toBe(3)
  })

  it('does not squeeze an individual model through a too-small gap', () => {
    const upper = { ...model, id: 'upper', position: { x: 14, y: 9.4 } }
    const lower = { ...model, id: 'lower', position: { x: 14, y: 10.6 } }
    const resolution = resolveMovement({
      allModels: [model, upper, lower],
      requestedPositions: new Map([['model-1', { x: 20, y: 10 }]]),
      battlefield,
      remainingMovement: new Map([['model-1', 20]]),
    })
    const accepted = resolution.positions.get('model-1')!
    expect(accepted.x).toBeLessThan(14)
    expect(isGroupPlacementValid([model, upper, lower], new Map([['model-1', accepted]]))).toBe(true)
  })

  it.each([
    [25, 25],
    [25, 50],
    [50, 25],
    [50, 50],
  ])('slides a %imm circular base around a %imm circular blocker', (movingDiameter, blockingDiameter) => {
    const moving = circularModel('moving', 10, 10, movingDiameter)
    const blocker = circularModel('blocker', 15, 10, blockingDiameter)
    const resolution = resolveMovement({
      allModels: [moving, blocker],
      requestedPositions: new Map([['moving', { x: 20, y: 13 }]]),
      battlefield,
    })
    const accepted = resolution.positions.get('moving')!
    expect(accepted.x).toBeGreaterThan(10)
    expect(accepted.y).toBeGreaterThan(10)
    expect(isGroupPlacementValid([moving, blocker], new Map([['moving', accepted]]))).toBe(true)
  })

  it('keeps tangential and away movement available from unequal-radius contact', () => {
    const movingRadius = millimetersToInches(50) / 2
    const blockerRadius = millimetersToInches(25) / 2
    const blocker = circularModel('blocker', 15, 10, 25)
    const contact = circularModel('moving', 15 - movingRadius - blockerRadius, 10, 50)
    const tangent = resolveMovement({
      allModels: [contact, blocker],
      requestedPositions: new Map([['moving', { x: contact.position.x, y: 13 }]]),
      battlefield,
    })
    expect(tangent.positions.get('moving')?.y).toBeCloseTo(13)

    const away = resolveMovement({
      allModels: [contact, blocker],
      requestedPositions: new Map([['moving', { x: contact.position.x - 3, y: 10 }]]),
      battlefield,
    })
    expect(away.positions.get('moving')?.x).toBeCloseTo(contact.position.x - 3)
  })

  it('does not tunnel or become sticky across repeated large-base slide requests', () => {
    const blocker = circularModel('blocker', 15, 10, 25)
    let moving = circularModel('moving', 10, 10, 50)
    const first = resolveMovement({
      allModels: [moving, blocker],
      requestedPositions: new Map([['moving', { x: 30, y: 12 }]]),
      battlefield,
    })
    const firstPosition = first.positions.get('moving')!
    expect(isGroupPlacementValid([moving, blocker], new Map([['moving', firstPosition]]))).toBe(true)

    moving = { ...moving, position: firstPosition }
    const second = resolveMovement({
      allModels: [moving, blocker],
      requestedPositions: new Map([['moving', { x: 20, y: 15 }]]),
      battlefield,
    })
    expect(second.distances.get('moving')).toBeGreaterThan(0)
    expect(isGroupPlacementValid([moving, blocker], new Map([['moving', second.positions.get('moving')!]]))).toBe(true)
  })

  it('charges the actual large-base slide path without exceeding allowance', () => {
    const moving = circularModel('moving', 10, 10, 50)
    const blocker = circularModel('blocker', 15, 10, 25)
    const resolution = resolveMovement({
      allModels: [moving, blocker],
      requestedPositions: new Map([['moving', { x: 20, y: 13 }]]),
      battlefield,
      remainingMovement: new Map([['moving', 4]]),
    })
    const path = resolution.paths.get('moving')!
    const pathLength = path.slice(1).reduce(
      (total, point, index) => total + distanceBetween(path[index], point),
      0,
    )
    expect(resolution.distances.get('moving')).toBeCloseTo(pathLength)
    expect(pathLength).toBeLessThanOrEqual(4)
  })

  it('slides a rigid group while preserving every relative position', () => {
    const first = circularModel('first', 10, 10)
    const second = circularModel('second', 10, 13)
    const blocker = circularModel('blocker', 15, 10)
    const before = relativeOffset(first, second)
    const resolution = resolveMovement({
      allModels: [first, second, blocker],
      requestedPositions: new Map([
        ['first', { x: 20, y: 13 }],
        ['second', { x: 20, y: 16 }],
      ]),
      battlefield,
    })
    const movedFirst = { ...first, position: resolution.positions.get('first')! }
    const movedSecond = { ...second, position: resolution.positions.get('second')! }
    expect(relativeOffset(movedFirst, movedSecond)).toEqual(before)
    expect(movedFirst.position.y).toBeGreaterThan(first.position.y)
    expect(resolution.distances.get('first')).toBeCloseTo(resolution.distances.get('second')!)
  })

  it('stops a rigid group on a direct push and ignores its internal contacts', () => {
    const first = circularModel('first', 10, 10)
    const second = circularModel('second', 11, 10)
    const blocker = circularModel('blocker', 15, 10)
    const resolution = resolveMovement({
      allModels: [first, second, blocker],
      requestedPositions: new Map([
        ['first', { x: 20, y: 10 }],
        ['second', { x: 21, y: 10 }],
      ]),
      battlefield,
    })
    expect(resolution.positions.get('second')?.x).toBeCloseTo(14)
    expect(resolution.positions.get('first')?.x).toBeCloseTo(13)
  })

  it('keeps rigid groups out of narrow gaps and valid at the destination', () => {
    const first = circularModel('first', 10, 10)
    const second = circularModel('second', 10, 13)
    const upper = circularModel('upper', 15, 9.4)
    const lower = circularModel('lower', 15, 10.6)
    const resolution = resolveMovement({
      allModels: [first, second, upper, lower],
      requestedPositions: new Map([
        ['first', { x: 22, y: 10 }],
        ['second', { x: 22, y: 13 }],
      ]),
      battlefield,
    })
    expect(resolution.positions.get('first')?.x).toBeLessThan(15)
    expect(isGroupPlacementValid([first, second, upper, lower], resolution.positions)).toBe(true)
  })

  it('uses the first group member allowance and battlefield contact', () => {
    const first = circularModel('first', 10, 10)
    const second = circularModel('second', 12, 12)
    const allowance = resolveMovement({
      allModels: [first, second],
      requestedPositions: new Map([
        ['first', { x: 30, y: 10 }],
        ['second', { x: 32, y: 12 }],
      ]),
      battlefield,
      remainingMovement: new Map([['first', 2], ['second', 8]]),
    })
    expect(allowance.distances.get('first')).toBeCloseTo(2)
    expect(allowance.distances.get('second')).toBeCloseTo(2)

    const edgeFirst = circularModel('edge-first', 57, 10)
    const edgeSecond = circularModel('edge-second', 59, 12)
    const edge = resolveMovement({
      allModels: [edgeFirst, edgeSecond],
      requestedPositions: new Map([
        ['edge-first', { x: 67, y: 10 }],
        ['edge-second', { x: 69, y: 12 }],
      ]),
      battlefield,
    })
    expect(edge.positions.get('edge-second')?.x).toBeCloseTo(59.5)
    expect(edge.positions.get('edge-first')?.x).toBeCloseTo(57.5)
  })

  it('handles simultaneous opposing group contacts deterministically and stops cleanly', () => {
    const first = circularModel('first', 10, 9)
    const second = circularModel('second', 10, 11)
    const upper = circularModel('upper', 15, 8.4)
    const lower = circularModel('lower', 15, 11.6)
    const requested = new Map([
      ['first', { x: 20, y: 9 }],
      ['second', { x: 20, y: 11 }],
    ])
    const normalOrder = resolveMovement({ allModels: [first, second, upper, lower], requestedPositions: requested, battlefield })
    const reversedOrder = resolveMovement({ allModels: [lower, upper, second, first], requestedPositions: requested, battlefield })
    expect(normalOrder.positions).toEqual(reversedOrder.positions)
    expect(isGroupPlacementValid([first, second, upper, lower], normalOrder.positions)).toBe(true)
  })

  it('uses a legal shared tangent for simultaneous group contacts', () => {
    const first = circularModel('first', 10, 9)
    const second = circularModel('second', 10, 12)
    const firstBlocker = circularModel('first-blocker', 15, 9)
    const secondBlocker = circularModel('second-blocker', 15, 12)
    const resolution = resolveMovement({
      allModels: [first, second, firstBlocker, secondBlocker],
      requestedPositions: new Map([
        ['first', { x: 20, y: 11 }],
        ['second', { x: 20, y: 14 }],
      ]),
      battlefield,
    })
    expect(resolution.positions.get('first')?.y).toBeGreaterThan(9)
    expect(relativeOffset(
      { ...first, position: resolution.positions.get('first')! },
      { ...second, position: resolution.positions.get('second')! },
    )).toEqual(relativeOffset(first, second))
  })

  it('respects pass-over capability per member of a rigid group', () => {
    const flyer = { ...circularModel('flyer', 10, 10), canPassOverModels: true }
    const walker = circularModel('walker', 10, 14)
    const blocker = circularModel('blocker', 15, 10)
    const crossed = resolveMovement({
      allModels: [flyer, walker, blocker],
      requestedPositions: new Map([
        ['flyer', { x: 20, y: 10 }],
        ['walker', { x: 20, y: 14 }],
      ]),
      battlefield,
    })
    expect(crossed.positions.get('flyer')?.x).toBeCloseTo(20)
    expect(crossed.positions.get('walker')?.x).toBeCloseTo(20)

    const illegalDestination = resolveMovement({
      allModels: [flyer, walker, blocker],
      requestedPositions: new Map([
        ['flyer', { x: 15, y: 10 }],
        ['walker', { x: 15, y: 14 }],
      ]),
      battlefield,
    })
    expect(illegalDestination.positions.get('flyer')?.x).toBeLessThan(15)
    expect(isGroupPlacementValid([flyer, walker, blocker], illegalDestination.positions)).toBe(true)
  })

  it('lets pass-over movement cross a model and charges the crossing distance', () => {
    const flyer = { ...model, canPassOverModels: true }
    const blocker = { ...model, id: 'blocker', position: { x: 13, y: 10 } }
    const resolution = resolveMovement({
      allModels: [flyer, blocker],
      requestedPositions: new Map([['model-1', { x: 16, y: 10 }]]),
      battlefield,
      remainingMovement: new Map([['model-1', 6]]),
    })
    expect(resolution.positions.get('model-1')).toEqual({ x: 16, y: 10 })
    expect(resolution.distances.get('model-1')).toBe(6)
  })

  it('stops a group at its earliest collision and boundary', () => {
    const first = { ...model, position: { x: 10, y: 10 } }
    const second = { ...model, id: 'model-2', position: { x: 10, y: 20 } }
    const blocker = { ...model, id: 'blocker', position: { x: 14, y: 10 } }
    const collision = resolveMovement({
      allModels: [first, second, blocker],
      requestedPositions: new Map([
        ['model-1', { x: 20, y: 10 }],
        ['model-2', { x: 20, y: 20 }],
      ]),
      battlefield,
    })
    expect(collision.positions.get('model-1')?.x).toBeCloseTo(13)
    expect(collision.positions.get('model-2')?.x).toBeCloseTo(13)
    const edgeModel = { ...model, id: 'edge', position: { x: 58, y: 20 } }
    const boundary = resolveMovement({
      allModels: [first, edgeModel],
      requestedPositions: new Map([
        ['model-1', { x: 20, y: 10 }],
        ['edge', { x: 68, y: 20 }],
      ]),
      battlefield,
    })
    expect(boundary.positions.get('model-1')?.x).toBeCloseTo(11.5)
    expect(boundary.positions.get('edge')?.x).toBeCloseTo(59.5)
  })

  it('cancel restores starting positions and confirm preserves final positions', () => {
    const started = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'move-control', modelIds: ['model-1'] })
    const moved = gameReducer(started, { type: 'movement/requested', positions: { 'model-1': { x: 14, y: 10 } } })
    const cancelled = gameReducer(moved, { type: 'movement/cancelled' })
    expect(cancelled.models[0].position).toEqual({ x: 10, y: 10 })
    expect(cancelled.movementSession).toBeNull()
    const movedAgain = gameReducer(gameReducer(cancelled, { type: 'movement/sessionStarted', sessionId: 'move-new', modelIds: ['model-1'] }), { type: 'movement/requested', positions: { 'model-1': { x: 12, y: 10 } } })
    const confirmed = gameReducer(movedAgain, { type: 'movement/confirmed' })
    expect(confirmed.models[0].position).toEqual({ x: 12, y: 10 })
    expect(confirmed.movementSession).toBeNull()
  })

  it('compresses straight accepted path points without changing endpoints', () => {
    const path = appendAcceptedPathPoint(appendAcceptedPathPoint([{ x: 0, y: 0 }], { x: 1, y: 0 }), { x: 4, y: 0 })
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }])
  })

  it('serializes an active movement session', () => {
    const active = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'move-json', modelIds: ['model-1'] })
    expect(JSON.parse(JSON.stringify(active))).toEqual(active)
    expect(JSON.parse(JSON.stringify(active.movementSession?.referencePath))).toEqual([{ x: 10, y: 10 }])
  })

  it('confirms and undoes an individual movement through the same reducer actions', () => {
    const started = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'undo-individual', modelIds: ['model-1'] })
    const moved = gameReducer(started, { type: 'movement/requested', positions: { 'model-1': { x: 14, y: 10 } } })
    const confirmed = gameReducer(moved, { type: 'movement/confirmed' })
    expect(confirmed.models[0].position).toEqual({ x: 14, y: 10 })
    expect(confirmed.movementSession).toBeNull()
    expect(confirmed.lastConfirmedMovementUndo?.models[0].position).toEqual({ x: 10, y: 10 })

    const undone = gameReducer(confirmed, { type: 'movement/undoLastConfirmed' })
    expect(undone.models[0].position).toEqual({ x: 10, y: 10 })
    expect(undone.movementSession).toBeNull()
    expect(undone.lastConfirmedMovementUndo).toBeNull()
    expect(gameReducer(undone, { type: 'movement/undoLastConfirmed' })).toEqual(undone)
    expect(JSON.parse(JSON.stringify(confirmed.lastConfirmedMovementUndo))).toEqual(confirmed.lastConfirmedMovementUndo)
  })

  it('undoes all models in a confirmed rigid group and restores its authoritative snapshot', () => {
    const before = sessionState.models.map((candidate) => ({ ...candidate, position: { ...candidate.position } }))
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'undo-group', modelIds: ['model-1', 'model-2'] })
    current = gameReducer(current, { type: 'movement/requested', positions: {
      'model-1': { x: 13, y: 10 },
      'model-2': { x: 13, y: 20 },
    } })
    current = gameReducer(current, { type: 'movement/confirmed' })
    current = gameReducer(current, { type: 'movement/undoLastConfirmed' })
    expect(current.models).toEqual(before)
    expect(current.movementSession).toBeNull()
  })

  it('replaces the one-level undo slot only with actual confirmed movement', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'undo-a', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 12, y: 10 } } })
    current = gameReducer(current, { type: 'movement/confirmed' })
    const afterA = current

    current = gameReducer(current, { type: 'movement/sessionStarted', sessionId: 'undo-b', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 15, y: 10 } } })
    current = gameReducer(current, { type: 'movement/confirmed' })
    current = gameReducer(current, { type: 'movement/undoLastConfirmed' })
    expect(current.models[0].position).toEqual(afterA.models[0].position)
    expect(current.lastConfirmedMovementUndo).toBeNull()

    current = gameReducer(current, { type: 'movement/sessionStarted', sessionId: 'undo-cancel', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 20, y: 10 } } })
    current = gameReducer(current, { type: 'movement/cancelled' })
    expect(current.lastConfirmedMovementUndo).toBeNull()
  })

  it('does not replace a meaningful undo slot with a confirmed no-op', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'undo-meaningful', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 12, y: 10 } } })
    current = gameReducer(current, { type: 'movement/confirmed' })
    const undoSlot = current.lastConfirmedMovementUndo
    current = gameReducer(current, { type: 'movement/sessionStarted', sessionId: 'undo-no-op', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/confirmed' })
    expect(current.lastConfirmedMovementUndo).toEqual(undoSlot)
  })

  it('preserves the previous undo slot when a later movement is cancelled', () => {
    let current = gameReducer(sessionState, { type: 'movement/sessionStarted', sessionId: 'undo-before-cancel', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 12, y: 10 } } })
    current = gameReducer(current, { type: 'movement/confirmed' })
    current = gameReducer(current, { type: 'movement/sessionStarted', sessionId: 'cancel-after-confirm', modelIds: ['model-1'] })
    current = gameReducer(current, { type: 'movement/requested', positions: { 'model-1': { x: 18, y: 10 } } })
    current = gameReducer(current, { type: 'movement/cancelled' })
    current = gameReducer(current, { type: 'movement/undoLastConfirmed' })
    expect(current.models[0].position).toEqual({ x: 10, y: 10 })
    expect(current.lastConfirmedMovementUndo).toBeNull()
  })

  it('keeps undo shortcuts out of editable controls and supports Ctrl/Cmd', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    expect(isEditableKeyboardTarget(input)).toBe(true)
    expect(isEditableKeyboardTarget(textarea)).toBe(true)
    expect(isEditableKeyboardTarget(editable)).toBe(true)
    expect(isEditableKeyboardTarget(document.body)).toBe(false)
    expect(isUndoMovementShortcut({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(true)
    expect(isUndoMovementShortcut({ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe(true)
    expect(isUndoMovementShortcut({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(false)
  })
})

describe('rigid group boundary constraints', () => {
  it.each([
    ['right', [circularModel('first', 58, 10), circularModel('second', 58, 13)], { x: 70, y: 15 }, { x: 59.5, y: 15 }],
    ['left', [circularModel('first', 2, 10), circularModel('second', 2, 13)], { x: -10, y: 15 }, { x: 0.5, y: 15 }],
    ['top', [circularModel('first', 10, 2), circularModel('second', 13, 2)], { x: 15, y: -10 }, { x: 15, y: 0.5 }],
    ['bottom', [circularModel('first', 10, 42), circularModel('second', 13, 42)], { x: 15, y: 60 }, { x: 15, y: 43.5 }],
  ] as const)('slides a rigid group along the %s boundary', (_edge, models, requestedFirst, expectedFirst) => {
    const first = models[0]
    const second = models[1]
    const delta = { x: requestedFirst.x - first.position.x, y: requestedFirst.y - first.position.y }
    const resolution = resolveMovement({
      allModels: models,
      requestedPositions: new Map([
        [first.id, requestedFirst],
        [second.id, { x: second.position.x + delta.x, y: second.position.y + delta.y }],
      ]),
      battlefield,
    })
    expect(resolution.positions.get(first.id)).toEqual(expectedFirst)
    const movedSecond = resolution.positions.get(second.id)!
    expect(relativeOffset({ ...first, position: resolution.positions.get(first.id)! }, { ...second, position: movedSecond })).toEqual(relativeOffset(first, second))
    expect(resolution.distances.get(first.id)).toBeCloseTo(resolution.distances.get(second.id)!)
    expect(isGroupPlacementValid(models, resolution.positions)).toBe(true)
  })

  it('combines wall and model contacts without allowing overlap or escape', () => {
    const moving = circularModel('moving', 55, 10)
    const blocker = circularModel('blocker', 58.8, 13)
    const resolution = resolveMovement({
      allModels: [moving, blocker],
      requestedPositions: new Map([['moving', { x: 70, y: 20 }]]),
      battlefield,
    })
    const accepted = resolution.positions.get('moving')!
    expect(accepted.x).toBeLessThanOrEqual(59.5 + GEOMETRY_EPSILON)
    expect(isGroupPlacementValid([moving, blocker], resolution.positions)).toBe(true)
    expect(isGroupPlacementValid([moving, blocker], new Map([['moving', accepted]]) )).toBe(true)
  })
})
