import { describe, expect, it } from 'vitest'
import type { MovementPolicyConfig, TabletopModel, Unit } from '../domain/types'
import { footprintDemoGameState } from '../game/initialState'
import { gameReducer } from '../state/reducer'
import { deriveSmartMoveGhosts } from '../tools/smartMoveGhosts'
import { validateCandidateFormation } from './candidateFormation'
import { poseForModel, sweepFootprintTranslation } from './geometry/footprints'
import { movementEnvelopeReach } from './movementEnvelope'
import { resolveModelRotation } from './rotation'
import { solveSmartMove } from './smartMove'

const inch = 25.4
const battlefield = { width: 20, height: 12 }
const mover: TabletopModel = {
  id: 'oval', unitId: 'unit', ownerId: 'player-a',
  position: { x: 3, y: 6 }, rotation: Math.PI / 2,
  base: { shape: 'ellipse', widthMm: 3 * inch, heightMm: inch },
  canPassOverModels: false,
}
const walls: TabletopModel[] = [
  { ...mover, id: 'wall-top', unitId: 'enemy', ownerId: 'player-b',
    position: { x: 10, y: 2.675 }, rotation: 0,
    base: { shape: 'rectangle', widthMm: inch, heightMm: 5.35 * inch } },
  { ...mover, id: 'wall-bottom', unitId: 'enemy', ownerId: 'player-b',
    position: { x: 10, y: 9.325 }, rotation: 0,
    base: { shape: 'rectangle', widthMm: inch, heightMm: 5.35 * inch } },
]
const unit: Unit = { id: 'unit', ownerId: 'player-a', definitionId: 'demo', modelIds: ['oval'] }

function solve(policy: MovementPolicyConfig, blockers: TabletopModel[] = walls) {
  return solveSmartMove({
    allModels: [mover, ...blockers], units: [unit], battlefield,
    selectedModelIds: ['oval'], target: { x: 17, y: 6 },
    movementRemaining: { oval: 12 }, movementPolicy: policy,
    coherencyPolicy: { distance: 1, requiredNeighbors: 0, requireConnected: true },
  })
}

describe('orientation-aware Smart Move', () => {
  it('rotates an oval through a sealed gap and renders its final pose', () => {
    const result = solve({ type: 'free-rotation' })
    expect(result.valid).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('ROTATION_FALLBACK')
    expect(result.assignments[0].destination.x).toBeGreaterThan(10.5)
    expect(result.assignments[0].finalRotation).toBeCloseTo(0)
    expect(result.assignments[0].trajectory?.segments[0].angularDelta).toBeCloseTo(-Math.PI / 2)
    const turn = resolveModelRotation({
      allModels: [mover, ...walls], modelId: mover.id,
      angularDelta: result.assignments[0].trajectory!.segments[0].angularDelta,
      battlefield,
    })
    expect(turn.blocked).toBe(false)
    const oriented = { ...mover, rotation: result.assignments[0].finalRotation! }
    const path = result.assignments[0].path
    for (let index = 1; index < path.length; index += 1) {
      for (const wall of walls) {
        expect(sweepFootprintTranslation(oriented.base, poseForModel(oriented, path[index - 1]), {
          x: path[index].x - path[index - 1].x,
          y: path[index].y - path[index - 1].y,
        }, wall.base, poseForModel(wall))).toBeNull()
      }
    }
    expect(deriveSmartMoveGhosts(result, [mover])[0].pose.rotation).toBeCloseTo(0)
    expect(validateCandidateFormation({
      allModels: [mover, ...walls], battlefield, positions: result.positions,
      rotations: { oval: result.assignments[0].finalRotation! },
    }).valid).toBe(true)
  })

  it.each([
    { type: 'movement-envelope' },
    { type: 'fixed-rotation-charge', rotationCharge: 2 },
    { type: 'free-rotation' },
  ] as MovementPolicyConfig[])('respects policy $type on the ordered pose trajectory', (policy) => {
    const result = solve(policy)
    expect(result.valid).toBe(true)
    const assignment = result.assignments[0]
    expect(assignment.finalRotation).toBeDefined()
    expect(assignment.movementCost).toBeLessThanOrEqual(12 + 1e-9)
    if (policy.type === 'movement-envelope') {
      for (const segment of assignment.trajectory!.segments) {
        expect(movementEnvelopeReach(mover.base, assignment.trajectory!.startPose, segment.endPose).distance)
          .toBeLessThanOrEqual(12 + 1e-9)
      }
    } else if (policy.type === 'fixed-rotation-charge') {
      expect(assignment.movementCost).toBeCloseTo(assignment.trajectory!.segments.slice(1)
        .reduce((sum, segment, index, segments) => {
          const previous = index === 0 ? assignment.trajectory!.segments[0].endPose : segments[index - 1].endPose
          return sum + Math.hypot(segment.endPose.position.x - previous.position.x,
            segment.endPose.position.y - previous.position.y)
        }, 0) + 2)
    }
  })

  it('keeps the original orientation in open space', () => {
    const result = solve({ type: 'free-rotation' }, [])
    expect(result.valid).toBe(true)
    expect(result.assignments[0].finalRotation).toBeUndefined()
    expect(deriveSmartMoveGhosts(result, [mover])[0].pose.rotation).toBe(mover.rotation)
  })

  it('can turn two selected ovals before routing their unit through the gap', () => {
    const rear = { ...mover, id: 'rear', position: { x: 2, y: 6 } }
    const front = { ...mover, id: 'front', position: { x: 5.3, y: 6 } }
    const pairUnit = { ...unit, modelIds: ['rear', 'front'] }
    const result = solveSmartMove({
      allModels: [rear, front, ...walls], units: [pairUnit], battlefield,
      selectedModelIds: pairUnit.modelIds, target: { x: 16, y: 6 },
      movementRemaining: { rear: 12, front: 12 },
      movementPolicy: { type: 'free-rotation' },
      coherencyPolicy: { distance: 2.3, requiredNeighbors: 1, requireConnected: true },
    })
    expect(result.valid).toBe(true)
    expect(result.diagnostics?.solverStage).toBe('ROTATION_FALLBACK')
    expect(result.assignments.every((assignment) => Math.abs(assignment.finalRotation ?? Math.PI) < 1e-9),
      JSON.stringify(result.assignments.map((assignment) => ({ id: assignment.modelId,
        rotation: assignment.finalRotation, destination: assignment.destination })))).toBe(true)
    expect(result.assignments.every((assignment) => assignment.destination.x > 10.5)).toBe(true)
    expect(result.coherency?.coherent).toBe(true)
  })

  it('applies and undoes the complete pose atomically', () => {
    const result = solve({ type: 'free-rotation' })
    expect(result.valid).toBe(true)
    const assignment = result.assignments[0]
    const initial = { ...structuredClone(footprintDemoGameState), models: [mover, ...walls], units: [unit] }
    const applied = gameReducer(initial, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { oval: mover.position }, finalPositions: { oval: assignment.destination },
      startingRotations: { oval: mover.rotation }, finalRotations: { oval: assignment.finalRotation! },
      trajectories: { oval: assignment.trajectory! },
      movementUsed: { oval: assignment.movementCost }, paths: { oval: assignment.path },
    })
    expect(applied.models[0].position).toEqual(assignment.destination)
    expect(applied.models[0].rotation).toBe(assignment.finalRotation)
    expect(applied.actionHistory.at(-1)?.payload.finalPoses.oval.rotation).toBe(assignment.finalRotation)
    const undone = gameReducer(applied, { type: 'movement/undoLastConfirmed' })
    expect(undone.models[0].position).toEqual(mover.position)
    expect(undone.models[0].rotation).toBe(mover.rotation)
  })
})
