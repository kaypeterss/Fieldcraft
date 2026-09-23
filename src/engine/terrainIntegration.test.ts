import { describe, expect, it } from 'vitest'
import type { BattlefieldFeature, Footprint, TabletopModel, TerrainPolicyConfig, Unit } from '../domain/types'
import { footprintDemoGameState } from '../game/initialState'
import { gameReducer } from '../state/reducer'
import { validateCandidateFormation } from './candidateFormation'
import { createPolygonFootprint, footprintSupportPoint, poseForModel, sweepFootprintTranslation } from './geometry/footprints'
import { resolveRigidTranslation } from './movement'
import { findDirectModelPath, findModelPath } from './pathfinding'
import { resolveModelRotation } from './rotation'
import { solveSmartMove } from './smartMove'
import { movementTerrainInteractions, terrainDestinationLegal, terrainPermissionsFor, terrainRelationships, terrainSurfaces } from './terrainPolicy'
import { poseTrajectoryFromPositions } from './trajectory'

const inch = 25.4
const battlefield = { width: 20, height: 12 }
const circle: Footprint = { shape: 'circle', diameterMm: inch }
const wall: Footprint = { shape: 'rectangle', widthMm: inch, heightMm: 4 * inch }
const allow = { canEnter: true, canCross: true, canFinish: true }
const block = { canEnter: false, canCross: false, canFinish: false }
const features: BattlefieldFeature[] = [{
  id: 'ruin', name: 'Ruin', pose: { position: { x: 10, y: 6 }, rotation: 0 },
  baseArea: { shape: 'rectangle', widthMm: 12 * inch, heightMm: 8 * inch },
  capabilities: { terrain: { type: 'terrain' } },
  objects: [{ id: 'wall', name: 'Wall', footprint: wall,
    localPose: { position: { x: 0, y: 0 }, rotation: 0 } }],
}]
const policy: TerrainPolicyConfig = {
  defaultBase: allow, defaultObject: block,
  rules: [{ featureId: 'ruin', objectId: 'wall', modelId: 'passer',
    permissions: { canEnter: true, canCross: true, canFinish: false } }],
}
const model = (id: string, x = 3, y = 6, base: Footprint = circle, rotation = 0): TabletopModel => ({
  id, unitId: `${id}-unit`, ownerId: 'player', position: { x, y }, rotation, base,
  canPassOverModels: false,
})
const routeRequest = (moving: TabletopModel, destination = { x: 17, y: 6 }) => ({
  model: moving, destination, obstacles: [], battlefield,
  terrainFeatures: features, terrainPolicy: policy,
})
const smartRequest = (moving: TabletopModel, target = { x: 17, y: 6 }) => {
  const unit: Unit = { id: moving.unitId, ownerId: moving.ownerId,
    definitionId: 'test', modelIds: [moving.id] }
  return { allModels: [moving], units: [unit], battlefield, selectedModelIds: [moving.id],
    target, movementRemaining: { [moving.id]: 20 },
    coherencyPolicy: { distance: 0, requiredNeighbors: 0, requireConnected: true },
    terrainFeatures: features, terrainPolicy: policy }
}

describe('shared terrain policy across manual and planned movement', () => {
  it('distinguishes enterable base, blocking child, and model-specific Cross', () => {
    const [base, child] = terrainSurfaces(features)
    expect(terrainPermissionsFor('normal', base, policy)).toEqual(allow)
    expect(terrainPermissionsFor('normal', child, policy)).toEqual(block)
    expect(terrainPermissionsFor('passer', child, policy)).toEqual({
      canEnter: true, canCross: true, canFinish: false,
    })
    expect(structuredClone(policy)).toEqual(policy)
    expect(terrainRelationships(model('normal', 6, 6), features, policy)).toEqual([{
      featureId: 'ruin', objectId: undefined, name: 'Ruin', permissions: allow,
    }])
  })

  it('separates current terrain occupancy from entered and crossed movement surfaces', () => {
    const passing = model('passer')
    const entering = movementTerrainInteractions(passing,
      poseTrajectoryFromPositions([{ x: 3, y: 6 }, { x: 6, y: 6 }], 0), features, policy)
    expect(entering.find((entry) => entry.objectId === undefined)?.entered).toBe(true)
    const crossing = movementTerrainInteractions(passing,
      poseTrajectoryFromPositions([{ x: 3, y: 6 }, { x: 17, y: 6 }], 0), features, policy)
    expect(crossing.find((entry) => entry.objectId === undefined)?.crossed).toBe(true)
    expect(crossing.find((entry) => entry.objectId === 'wall')?.crossed).toBe(true)
    expect(terrainRelationships(model('passer', 17, 6), features, policy)).toEqual([])
  })

  it('lets manual movement enter the base and slide against the wall', () => {
    const moving = model('normal')
    const straight = resolveRigidTranslation({ allModels: [moving], modelIds: [moving.id],
      translation: { x: 14, y: 0 }, battlefield, terrainFeatures: features, terrainPolicy: policy })
    expect(straight.positions.get(moving.id)!.x).toBeLessThanOrEqual(9)
    expect(straight.positions.get(moving.id)!.x).toBeGreaterThan(4)
    const nearWall = model('normal', 8, 6)
    const diagonal = resolveRigidTranslation({ allModels: [nearWall], modelIds: [nearWall.id],
      translation: { x: 6, y: 4 }, battlefield, terrainFeatures: features, terrainPolicy: policy })
    expect(diagonal.positions.get(nearWall.id)!.x).toBeCloseTo(9)
    expect(diagonal.positions.get(nearWall.id)!.y).toBeCloseTo(10)
    expect(diagonal.translationPath.length).toBeGreaterThan(2)
  })

  it('keeps repeated drag updates moving smoothly along a child wall', () => {
    let current = model('normal', 8, 4.5)
    const ys: number[] = []
    for (let step = 1; step <= 35; step += 1) {
      const target = { x: 11, y: 4.5 + step * 0.1 }
      const resolved = resolveRigidTranslation({ allModels: [current], modelIds: [current.id],
        translation: { x: target.x - current.position.x, y: target.y - current.position.y },
        battlefield, terrainFeatures: features, terrainPolicy: policy })
      current = { ...current, position: resolved.positions.get(current.id)! }
      ys.push(current.position.y)
    }
    expect(ys.every((y, index) => index === 0 || y >= ys[index - 1] - 1e-6)).toBe(true)
    expect(current.position.y).toBeGreaterThan(7)
  })

  it('retains accepted slide progress at shallow terrain-wall contact', () => {
    const moving = model('normal', 8, 6)
    const resolved = resolveRigidTranslation({ allModels: [moving], modelIds: [moving.id],
      translation: { x: 6, y: 2 }, battlefield, terrainFeatures: features, terrainPolicy: policy })
    expect(resolved.positions.get(moving.id)!.x).toBeGreaterThan(8.5)
    expect(resolved.positions.get(moving.id)!.y).toBeGreaterThan(6.5)
  })

  it('uses the same continuous contact response for circles and ovals on straight, angled, and cornered walls', () => {
    const oval: Footprint = { shape: 'ellipse', widthMm: 2.5 * inch, heightMm: inch }
    const cases = [
      { base: circle, start: { x: 8, y: 6 }, delta: { x: 6, y: 2 }, angle: 0, secondWall: false },
      { base: oval, start: { x: 8, y: 6 }, delta: { x: 6, y: 2 }, angle: 0, secondWall: false },
      { base: circle, start: { x: 6, y: 6 }, delta: { x: 8, y: 2 }, angle: Math.PI / 6, secondWall: false },
      { base: oval, start: { x: 6, y: 6 }, delta: { x: 8, y: 2 }, angle: Math.PI / 6, secondWall: false },
      { base: circle, start: { x: 8, y: 2 }, delta: { x: 4, y: 5 }, angle: 0, secondWall: false },
      { base: circle, start: { x: 8, y: 6 }, delta: { x: 7, y: 5 }, angle: 0, secondWall: true },
    ]
    for (const scenario of cases) {
      const moving = model('slider', scenario.start.x, scenario.start.y, scenario.base)
      const scenarioFeatures: BattlefieldFeature[] = [{ ...features[0],
        pose: { ...features[0].pose, rotation: scenario.angle },
        objects: scenario.secondWall ? [...features[0].objects, {
          id: 'second-wall', name: 'Second Wall', footprint: wall,
          localPose: { position: { x: 2, y: 2 }, rotation: Math.PI / 2 },
        }] : features[0].objects,
      }]
      const terrain = resolveRigidTranslation({ allModels: [moving], modelIds: [moving.id],
        translation: scenario.delta, battlefield, terrainFeatures: scenarioFeatures, terrainPolicy: policy })
      const blockers = terrainSurfaces(scenarioFeatures).filter((surface) => surface.objectId).map((surface) =>
        model(`blocker-${surface.objectId}`, surface.pose.position.x, surface.pose.position.y,
          surface.footprint, surface.pose.rotation))
      const modelContact = resolveRigidTranslation({ allModels: [moving, ...blockers], modelIds: [moving.id],
        translation: scenario.delta, battlefield })
      expect(terrain.positions.get(moving.id)?.x).toBeCloseTo(modelContact.positions.get(moving.id)!.x, 4)
      expect(terrain.positions.get(moving.id)?.y).toBeCloseTo(modelContact.positions.get(moving.id)!.y, 4)
      expect(terrain.translationPath.length).toBeGreaterThan(1)
      expect(terrainDestinationLegal(
        moving, { position: terrain.positions.get(moving.id)!, rotation: moving.rotation },
        scenarioFeatures, policy,
      )).toBe(true)
    }
  })

  it('slides continuously along an impassable angled base with actual circle, oval, rectangle, and hull footprints', () => {
    const angle = Math.PI / 9
    const normal = { x: -Math.cos(angle), y: -Math.sin(angle) }
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) }
    const halfWidth = 190 / inch / 2
    const feature: BattlefieldFeature = {
      id: 'ground', name: 'Ground', pose: { position: { x: 10, y: 6 }, rotation: angle },
      baseArea: { shape: 'rectangle', widthMm: 190, heightMm: 130 },
      capabilities: { terrain: { type: 'terrain' } }, objects: [],
    }
    const blockingPolicy: TerrainPolicyConfig = { defaultBase: block, defaultObject: block, rules: [] }
    const baseBlocker = model('base-blocker', 10, 6, feature.baseArea, angle)
    const footprints: Footprint[] = [
      circle,
      { shape: 'ellipse', widthMm: 75, heightMm: 42 },
      { shape: 'rectangle', widthMm: 38, heightMm: 25 },
      createPolygonFootprint([
        { x: -20, y: -10 }, { x: 15, y: -12 }, { x: 22, y: 0 },
        { x: 12, y: 12 }, { x: -18, y: 10 },
      ]),
    ]
    for (const footprint of footprints) {
      const originPose = { position: { x: 0, y: 0 }, rotation: 0 }
      const support = footprintSupportPoint(footprint, originPose, { x: -normal.x, y: -normal.y })
      const contactDistance = halfWidth - support.x * normal.x - support.y * normal.y
      const start = { x: 10 + normal.x * (contactDistance + 2) - tangent.x * 0.6,
        y: 6 + normal.y * (contactDistance + 2) - tangent.y * 0.6 }
      let moving = model('slider', start.x, start.y, footprint)
      const tangentPositions: number[] = []
      const normalPositions: number[] = []
      for (let step = 0; step <= 40; step += 1) {
        const along = -0.6 + step * 0.03
        const pointer = { x: 10 + normal.x * (contactDistance - 2) + tangent.x * along,
          y: 6 + normal.y * (contactDistance - 2) + tangent.y * along }
        const translation = { x: pointer.x - moving.position.x, y: pointer.y - moving.position.y }
        const terrain = resolveRigidTranslation({ allModels: [moving], modelIds: [moving.id],
          translation, battlefield, terrainFeatures: [feature], terrainPolicy: blockingPolicy })
        const modelContact = resolveRigidTranslation({ allModels: [moving, baseBlocker], modelIds: [moving.id],
          translation, battlefield })
        const position = terrain.positions.get(moving.id)!
        expect(position.x).toBeCloseTo(modelContact.positions.get(moving.id)!.x, 5)
        expect(position.y).toBeCloseTo(modelContact.positions.get(moving.id)!.y, 5)
        expect(terrainDestinationLegal(moving, { position, rotation: moving.rotation },
          [feature], blockingPolicy)).toBe(true)
        tangentPositions.push((position.x - 10) * tangent.x + (position.y - 6) * tangent.y)
        normalPositions.push((position.x - 10) * normal.x + (position.y - 6) * normal.y)
        moving = { ...moving, position }
      }
      expect(tangentPositions.at(-1)).toBeCloseTo(0.6, 3)
      expect(Math.max(...normalPositions) - Math.min(...normalPositions)).toBeLessThan(1e-4)
      expect(tangentPositions.every((value, index) => index === 0
        || value >= tangentPositions[index - 1] - 1e-6)).toBe(true)
    }
  })

  it('makes an entire base impassable when configured without changing its child policy', () => {
    const impassable: TerrainPolicyConfig = { ...policy,
      rules: [...policy.rules, { featureId: 'ruin', permissions: block }] }
    const moving = model('normal')
    const resolved = resolveRigidTranslation({ allModels: [moving], modelIds: [moving.id],
      translation: { x: 8, y: 0 }, battlefield, terrainFeatures: features, terrainPolicy: impassable })
    expect(resolved.positions.get(moving.id)!.x).toBeLessThan(4)
    const route = findModelPath({ ...routeRequest(moving), terrainPolicy: impassable })
    expect(route).not.toBeNull()
    expect(route!.path.length).toBeGreaterThan(2)
  })

  it('stops swept rotation at a blocking child footprint', () => {
    const rectangle: Footprint = { shape: 'rectangle', widthMm: 4 * inch, heightMm: inch }
    const moving = model('normal', 8.5, 6, rectangle, Math.PI / 2)
    const result = resolveModelRotation({ allModels: [moving], modelId: moving.id,
      angularDelta: -Math.PI / 2, battlefield, terrainFeatures: features, terrainPolicy: policy })
    expect(result.blocked).toBe(true)
    expect(result.angularRotation).toBeLessThan(Math.PI / 2)
  })

  it('routes around a blocking wall while treating its base as enterable', () => {
    const moving = model('normal')
    expect(findDirectModelPath(routeRequest(moving))).toBeNull()
    const path = findModelPath(routeRequest(moving))
    expect(path).not.toBeNull()
    expect(path!.path.length).toBeGreaterThan(2)
    for (let index = 1; index < path!.path.length; index += 1) {
      const start = path!.path[index - 1]
      const end = path!.path[index]
      expect(sweepFootprintTranslation(moving.base, poseForModel(moving, start),
        { x: end.x - start.x, y: end.y - start.y }, wall,
        { position: { x: 10, y: 6 }, rotation: 0 })).toBeNull()
    }
  })

  it('uses the actual fixed orientation of a non-circular model around terrain', () => {
    const oval: Footprint = { shape: 'ellipse', widthMm: 2.5 * inch, heightMm: inch }
    const moving = model('oval', 3, 6, oval, Math.PI / 8)
    const path = findModelPath(routeRequest(moving))
    expect(path).not.toBeNull()
    expect(path!.path.length).toBeGreaterThan(2)
    expect(moving.rotation).toBe(Math.PI / 8)
  })

  it('allows one model to Cross the same wall but forbids Finish on it', () => {
    const passing = model('passer')
    const crossing = resolveRigidTranslation({ allModels: [passing], modelIds: [passing.id],
      translation: { x: 14, y: 0 }, battlefield, terrainFeatures: features, terrainPolicy: policy })
    expect(crossing.positions.get(passing.id)?.x).toBeCloseTo(17)
    const intoWall = resolveRigidTranslation({ allModels: [passing], modelIds: [passing.id],
      translation: { x: 7, y: 0 }, battlefield, terrainFeatures: features, terrainPolicy: policy })
    expect(intoWall.positions.get(passing.id)!.x).toBeLessThan(10)
    expect(findDirectModelPath(routeRequest(passing))?.path).toHaveLength(2)
    expect(terrainDestinationLegal(passing, poseForModel(passing, { x: 10, y: 6 }), features, policy)).toBe(false)
    expect(findDirectModelPath(routeRequest(passing, { x: 10, y: 6 }))).toBeNull()
    expect(validateCandidateFormation({ allModels: [passing], battlefield,
      positions: { passer: { x: 10, y: 6 } }, terrainFeatures: features, terrainPolicy: policy,
    }).violations).toContainEqual({ type: 'TERRAIN_FINISH_FORBIDDEN', modelIds: ['passer'] })
  })

  it('makes Smart Move use the same per-model route and final-placement policy', () => {
    const normal = solveSmartMove(smartRequest(model('normal')))
    const passing = solveSmartMove(smartRequest(model('passer')))
    expect(normal.valid).toBe(true)
    expect(passing.valid).toBe(true)
    expect(normal.assignments[0].path.length).toBeGreaterThan(2)
    expect(passing.assignments[0].path).toHaveLength(2)
    const cannotFinish = solveSmartMove(smartRequest(model('passer'), { x: 10, y: 6 }))
    expect(cannotFinish.positions.passer).not.toEqual({ x: 10, y: 6 })
  })

  it('preserves Confirm, Cancel, and Undo with enterable terrain', () => {
    const moving = model('normal')
    const state = { ...footprintDemoGameState,
      battlefield, models: [moving],
      units: [{ id: moving.unitId, ownerId: moving.ownerId, definitionId: 'test', modelIds: [moving.id] }],
      unitDefinitions: [{ id: 'test', name: 'Test', movementAllowance: 20 }],
      battlefieldFeatures: features, terrainPolicy: policy,
      actionHistory: [], nextActionSequence: 1, movementSession: null, lastConfirmedMovementUndo: null,
    }
    const started = gameReducer(state, { type: 'movement/sessionStarted', sessionId: 'terrain-move',
      modelIds: [moving.id], movementPolicy: { type: 'free-rotation' } })
    const moved = gameReducer(started, { type: 'movement/requested', positions: { normal: { x: 6, y: 6 } } })
    expect(moved.models[0].position.x).toBeCloseTo(6)
    expect(gameReducer(moved, { type: 'movement/cancelled' }).models[0].position).toEqual(moving.position)
    const confirmed = gameReducer(moved, { type: 'movement/confirmed' })
    expect(confirmed.actionHistory).toHaveLength(1)
    expect(gameReducer(confirmed, { type: 'movement/undoLastConfirmed' }).models[0].position).toEqual(moving.position)
  })
})
