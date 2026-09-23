import { describe, expect, it } from 'vitest'
import type { SmartMoveResult } from '../engine/smartMove'
import type { TabletopModel, Unit } from '../domain/types'
import { evaluateUnitCoherency } from '../engine/coherency'
import { modelAreaRelationship, unitAreaSummary } from '../engine/areaRelationships'
import { isPointWithinModelRangeArea, isTargetCenterWithinExclusionZone } from '../engine/spatial'
import { displayedSmartMovePreview, projectModelsForSmartMove } from './projectedSpatialState'

const circle = { shape: 'circle' as const, diameterMm: 25.4 }
const models: TabletopModel[] = [
  { id: 'a', unitId: 'unit', ownerId: 'p1', position: { x: 1, y: 1 }, rotation: 0, base: circle, canPassOverModels: false },
  { id: 'b', unitId: 'unit', ownerId: 'p1', position: { x: 3, y: 1 }, rotation: 0, base: circle, canPassOverModels: false },
  { id: 'c', unitId: 'other', ownerId: 'p2', position: { x: 10, y: 1 }, rotation: 0, base: circle, canPassOverModels: false },
]
const unit: Unit = { id: 'unit', ownerId: 'p1', definitionId: 'test', modelIds: ['a', 'b'] }
const result: SmartMoveResult = {
  valid: true, target: { x: 9, y: 1 }, unitId: 'unit', selectedModelIds: ['a'], positions: { a: { x: 8, y: 1 } },
  assignments: [{ modelId: 'a', slotIndex: 0, start: { x: 1, y: 1 }, destination: { x: 8, y: 1 },
    finalRotation: Math.PI / 2, path: [{ x: 1, y: 1 }, { x: 8, y: 1 }], movementCost: 7, movementRemaining: 0 }],
  totalMovementCost: 7, validation: { movement: true, collision: true, battlefield: true, coherency: true },
  formationValidation: null, coherency: null, failureReasons: [], candidatesTested: 1, diagnostics: null,
}

describe('projected Spatial state', () => {
  it('uses ghost position and orientation for Range and Exclusion without mutating authoritative models', () => {
    const projected = projectModelsForSmartMove(models, result)
    expect(models[0].position).toEqual({ x: 1, y: 1 })
    expect(projected[0]).toMatchObject({ position: { x: 8, y: 1 }, rotation: Math.PI / 2 })
    expect(isPointWithinModelRangeArea(models[0], { x: 9, y: 1 }, 1)).toBe(false)
    expect(isPointWithinModelRangeArea(projected[0], { x: 9, y: 1 }, 1)).toBe(true)
    expect(isTargetCenterWithinExclusionZone(models[0], { x: 9, y: 1 }, circle, 1)).toBe(false)
    expect(isTargetCenterWithinExclusionZone(projected[0], { x: 9, y: 1 }, circle, 1)).toBe(true)
  })

  it('evaluates complete-unit coherency from ghost and unchanged authoritative poses', () => {
    const before = evaluateUnitCoherency(unit, models, { distance: 1.1, requiredNeighbors: 1, requireConnected: true })
    const projected = projectModelsForSmartMove(models, result)
    const after = evaluateUnitCoherency(unit, projected, { distance: 1.1, requiredNeighbors: 1, requireConnected: true })
    expect(before.coherent).toBe(true)
    expect(after.coherent).toBe(false)
    expect(projected.find((model) => model.id === 'b')).toBe(models[1])
  })

  it('updates objective counts from ghost poses and returns to authoritative state on cancel', () => {
    const area = { footprint: { shape: 'circle' as const, diameterMm: 76.2 }, pose: { position: { x: 8, y: 1 }, rotation: 0 } }
    const before = unitAreaSummary(unit, models, area)
    const projected = projectModelsForSmartMove(models, result)
    const preview = unitAreaSummary(unit, projected, area)
    const cancelled = projectModelsForSmartMove(models, null)
    expect(before.intersectingCount).toBe(0)
    expect(preview.intersectingCount).toBe(1)
    expect(modelAreaRelationship(projected[0], area).centerWithin).toBe(true)
    expect(unitAreaSummary(unit, cancelled, area)).toEqual(before)
  })

  it('retains the displayed ghost as the shared pose source between Smart Move previews', () => {
    const retainedWhileCalculating = displayedSmartMovePreview(result)
    const projectedWhileCalculating = projectModelsForSmartMove(models, retainedWhileCalculating)
    expect(retainedWhileCalculating).toBe(result)
    expect(projectedWhileCalculating[0].position).toEqual({ x: 8, y: 1 })

    const updated = {
      ...result,
      assignments: [{ ...result.assignments[0], destination: { x: 9, y: 2 } }],
    }
    expect(projectModelsForSmartMove(models, displayedSmartMovePreview(updated))[0].position)
      .toEqual({ x: 9, y: 2 })
    expect(projectModelsForSmartMove(models, displayedSmartMovePreview(null))[0].position)
      .toEqual(models[0].position)
  })
})
