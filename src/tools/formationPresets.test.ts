import { describe, expect, it } from 'vitest'
import type { TabletopModel, Unit } from '../domain/types'
import { footprintsOverlap } from '../engine/geometry/footprints'
import { formationPresetCandidates, rotateFormationPlacements } from './formationPresets'
import { createAgeOfSigmarAlphaMatch } from '../gameSystem/ageOfSigmar/ageOfSigmarMatch'
import { prepareAgeOfSigmarMatch } from '../gameSystem/ageOfSigmar/prepareAgeOfSigmarMatch'
import { getUnitCoherencyPolicy } from '../game/selectors'
import { initialGameState } from '../game/initialState'

const unit: Unit = { id: 'unit', ownerId: 'player', definitionId: 'definition', modelIds: ['a', 'b', 'c', 'd', 'e'] }
const models: TabletopModel[] = unit.modelIds.map((id) => ({
  id, unitId: unit.id, ownerId: unit.ownerId, position: { x: 0, y: 0 }, rotation: 0,
  base: { shape: 'circle', diameterMm: 32 }, canPassOverModels: false,
}))

describe('generic formation presets', () => {
  it('offers deterministic non-overlapping Compact, Ranks, and Line formations for a one-neighbour unit', () => {
    const first = formationPresetCandidates({
      unit, movingModels: models, policy: { distance: 0.5, requiredNeighbors: 1, requireConnected: true },
      anchor: { x: 12, y: 8 },
    })
    const second = formationPresetCandidates({
      unit, movingModels: models, policy: { distance: 0.5, requiredNeighbors: 1, requireConnected: true },
      anchor: { x: 12, y: 8 },
    })
    expect(first.map((candidate) => [candidate.id, candidate.available])).toEqual([
      ['previous', false],
      ['compact', true], ['ranks', true], ['line', true],
    ])
    expect(first).toEqual(second)
    for (const candidate of first.filter((entry) => entry.available)) {
      for (let a = 0; a < models.length; a += 1) for (let b = a + 1; b < models.length; b += 1) {
        expect(footprintsOverlap(
          models[a].base, candidate.placements[models[a].id],
          models[b].base, candidate.placements[models[b].id],
        )).toBe(false)
      }
    }
  })

  it('offers Previous only after the stored relative formation is revalidated', () => {
    const stored = models.map((model, index) => ({ ...model, position: { x: index * 1.5, y: 0 } }))
    const previous = formationPresetCandidates({
      unit, movingModels: stored, policy: { distance: 0.5, requiredNeighbors: 1, requireConnected: true },
      anchor: { x: 20, y: 20 },
    }).find((candidate) => candidate.id === 'previous')
    expect(previous?.available).toBe(true)
    expect(previous?.placements.c.position).toEqual({ x: 20, y: 20 })
  })

  it('does not offer Line when endpoint models cannot satisfy a two-neighbour policy', () => {
    const candidates = formationPresetCandidates({
      unit, movingModels: models, policy: { distance: 0.5, requiredNeighbors: 2, requireConnected: true },
      anchor: { x: 0, y: 0 },
    })
    expect(candidates.find((candidate) => candidate.id === 'line')).toMatchObject({
      available: false,
      reason: expect.stringContaining('Endpoints'),
    })
    expect(candidates.some((candidate) => candidate.available)).toBe(true)
  })

  it('rotates a formation around a stable anchor while preserving its shape', () => {
    const placements = formationPresetCandidates({
      unit, movingModels: models, policy: { distance: 0.5, requiredNeighbors: 1, requireConnected: true },
      anchor: { x: 10, y: 10 },
    })[0].placements
    const rotated = rotateFormationPlacements(placements, { x: 10, y: 10 }, Math.PI / 2)
    for (const model of models) {
      const before = placements[model.id]
      const after = rotated[model.id]
      expect(Math.hypot(before.position.x - 10, before.position.y - 10)).toBeCloseTo(
        Math.hypot(after.position.x - 10, after.position.y - 10),
      )
      expect(after.rotation).toBeCloseTo(Math.PI / 2)
    }
  })

  it('offers coherent presets immediately for the 20-model Clanrats policy and rejects Line', () => {
    const state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch())
    const clanrats = state.units.find((candidate) => candidate.id === 'skv-clanrats')!
    const policy = getUnitCoherencyPolicy(state, clanrats)!
    const clanratModels = clanrats.modelIds.map((id) => state.models.find((model) => model.id === id)!)
    const candidates = formationPresetCandidates({ unit: clanrats, movingModels: clanratModels, policy, anchor: { x: 12, y: 12 } })
    expect(candidates.find((candidate) => candidate.id === 'compact')?.available).toBe(true)
    expect(candidates.find((candidate) => candidate.id === 'ranks')?.available).toBe(true)
    expect(candidates.find((candidate) => candidate.id === 'line')?.available).toBe(false)
    const compact = candidates.find((candidate) => candidate.id === 'compact')!
    const ranks = candidates.find((candidate) => candidate.id === 'ranks')!
    const compactSpan = Math.max(...Object.values(compact.placements).map((pose) => pose.position.x))
      - Math.min(...Object.values(compact.placements).map((pose) => pose.position.x))
    const ranksSpan = Math.max(...Object.values(ranks.placements).map((pose) => pose.position.x))
      - Math.min(...Object.values(ranks.placements).map((pose) => pose.position.x))
    expect(ranksSpan).toBeGreaterThan(compactSpan)
  })

  it('uses the same footprint-aware generator for oval units and partial restoration with active members', () => {
    const state = structuredClone(initialGameState)
    const cavalry = state.units.find((candidate) => candidate.id === 'unit-cavalry')!
    const policy = getUnitCoherencyPolicy(state, cavalry)!
    const cavalryModels = cavalry.modelIds.map((id) => state.models.find((model) => model.id === id)!)
    const ovalCandidates = formationPresetCandidates({ unit: cavalry, movingModels: cavalryModels, policy, anchor: { x: 20, y: 20 } })
    expect(ovalCandidates.filter((candidate) => candidate.id !== 'previous').some((candidate) => candidate.available)).toBe(true)
    const moving = cavalryModels[0]
    const fixed = cavalryModels.slice(1)
    const partial = formationPresetCandidates({
      unit: cavalry, movingModels: [moving], fixedModels: fixed, policy, anchor: { ...moving.position },
    })
    expect(partial.find((candidate) => candidate.id === 'previous')?.available).toBe(true)
  })
})
