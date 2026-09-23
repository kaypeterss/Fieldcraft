import { describe, expect, it } from 'vitest'
import { validateCandidateFormation } from '../engine/candidateFormation'
import { activeBattlefieldModels, inactiveModels } from './modelPresence'
import { lifecycleDemoGameState } from './lifecycleDemo'

describe('M9 lifecycle QA fixture', () => {
  it('provides the requested active roster and immediately testable inactive states', () => {
    const active = activeBattlefieldModels(lifecycleDemoGameState)
    expect(active.filter((model) => model.unitId === 'unit-a')).toHaveLength(10)
    expect(active.filter((model) => model.unitId === 'unit-cavalry')).toHaveLength(6)
    expect(active.filter((model) => model.unitId === 'unit-b')).toHaveLength(5)
    expect(inactiveModels(lifecycleDemoGameState).map((model) => model.presence)).toEqual(['OFF_BOARD', 'DESTROYED'])
    expect(lifecycleDemoGameState.battlefieldFeatures?.some((feature) => feature.capabilities.terrain)).toBe(true)
    expect(lifecycleDemoGameState.battlefieldFeatures?.some((feature) => feature.capabilities.objective)).toBe(true)
  })

  it('starts every active footprint inside the battlefield without model overlap', () => {
    const active = activeBattlefieldModels(lifecycleDemoGameState)
    const validation = validateCandidateFormation({
      allModels: active,
      battlefield: lifecycleDemoGameState.battlefield,
      terrainFeatures: lifecycleDemoGameState.battlefieldFeatures,
      terrainPolicy: lifecycleDemoGameState.terrainPolicy,
      positions: Object.fromEntries(active.map((model) => [model.id, model.position])),
      rotations: Object.fromEntries(active.map((model) => [model.id, model.rotation])),
    })
    expect(validation.valid).toBe(true)
  })
})
