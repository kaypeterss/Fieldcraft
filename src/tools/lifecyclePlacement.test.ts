import { describe, expect, it } from 'vitest'
import type { TabletopModel } from '../domain/types'
import { derivePlacementCoherency, formationPlacements, nextUnplacedModelId, unitModelsFromPlacement } from './lifecyclePlacement'
import { initialGameState } from '../game/initialState'

const models: TabletopModel[] = [
  { id: 'a', unitId: 'u', ownerId: 'p', position: { x: 2, y: 4 }, rotation: 0.4, base: { shape: 'circle', diameterMm: 32 }, canPassOverModels: false },
  { id: 'b', unitId: 'u', ownerId: 'p', position: { x: 6, y: 8 }, rotation: 1.2, base: { shape: 'ellipse', widthMm: 75, heightMm: 42 }, canPassOverModels: false },
]

describe('lifecycle placement helpers', () => {
  it('moves a stored formation rigidly and preserves every rotation', () => {
    const placements = formationPlacements(models, { x: 20, y: 30 })
    expect(placements.a).toEqual({ position: { x: 18, y: 28 }, rotation: 0.4 })
    expect(placements.b).toEqual({ position: { x: 22, y: 32 }, rotation: 1.2 })
  })

  it('advances staged individual placement without committing partial state', () => {
    expect(nextUnplacedModelId(['a', 'b'], {})).toBe('a')
    expect(nextUnplacedModelId(['a', 'b'], { a: { position: { x: 1, y: 1 }, rotation: 0 } })).toBe('b')
    expect(nextUnplacedModelId(['a'], { a: { position: { x: 1, y: 1 }, rotation: 0 } })).toBeNull()
  })

  it('projects existing members together with staged inactive members', () => {
    const state = structuredClone(initialGameState)
    const unit = state.units.find((candidate) => candidate.id === 'unit-cavalry')!
    state.models.find((model) => model.id === unit.modelIds[0])!.presence = 'OFF_BOARD'
    const projected = unitModelsFromPlacement(state, unit, {
      [unit.modelIds[0]]: { position: { x: 10, y: 10 }, rotation: 0 },
    })
    expect(projected.map((model) => model.id).sort()).toEqual([...unit.modelIds].sort())
    expect(projected.find((model) => model.id === unit.modelIds[0])?.position).toEqual({ x: 10, y: 10 })
  })

  it('only exposes a temporary coherency preview when the placement context requires it', () => {
    const state = structuredClone(initialGameState)
    const unit = state.units.find((candidate) => candidate.id === 'unit-cavalry')!
    const model = state.models.find((candidate) => candidate.id === unit.modelIds[0])!
    model.presence = 'OFF_BOARD'
    const placements = { [model.id]: { position: { ...model.position }, rotation: model.rotation } }
    expect(derivePlacementCoherency(state, [model.id], placements, false)).toEqual([])
    const preview = derivePlacementCoherency(state, [model.id], placements, true)
    expect(preview).toHaveLength(1)
    expect(preview[0].models.map((candidate) => candidate.id).sort()).toEqual([...unit.modelIds].sort())
  })
})
