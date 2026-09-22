import { describe, expect, it } from 'vitest'
import type { TabletopModel } from '../domain/types'
import type { SmartMoveResult } from '../engine/smartMove'
import { footprintDemoGameState } from '../game/initialState'
import { deriveSmartMoveGhosts } from './smartMoveGhosts'

describe('generic Smart Move ghosts', () => {
  it('retains every footprint and its current orientation at the preview destination', () => {
    const models: TabletopModel[] = structuredClone(footprintDemoGameState.models)
    const positions = Object.fromEntries(models.map((model, index) => [
      model.id,
      { x: model.position.x + index + 1, y: model.position.y + 2 },
    ]))
    const result: SmartMoveResult = {
      valid: true,
      target: { x: 30, y: 20 },
      unitId: 'demo-unit-shapes',
      selectedModelIds: models.map((model) => model.id),
      positions,
      assignments: models.map((model, index) => ({
        modelId: model.id,
        slotIndex: index,
        start: { ...model.position },
        destination: { ...positions[model.id] },
        path: [{ ...model.position }, { ...positions[model.id] }],
        movementCost: index + 1,
        movementRemaining: 12,
      })),
      totalMovementCost: 10,
      validation: { movement: true, collision: true, battlefield: true, coherency: true },
      formationValidation: null,
      coherency: null,
      failureReasons: [],
      candidatesTested: 1,
      diagnostics: null,
    }

    const ghosts = deriveSmartMoveGhosts(result, models)
    expect(ghosts.map((ghost) => ghost.footprint.shape)).toEqual([
      'circle', 'ellipse', 'rectangle', 'polygon',
    ])
    expect(ghosts.map((ghost) => ghost.pose.rotation)).toEqual(models.map((model) => model.rotation))
    expect(ghosts.map((ghost) => ghost.pose.position)).toEqual(models.map((model) => positions[model.id]))
    expect(ghosts.map((ghost) => ghost.footprint)).toEqual(models.map((model) => model.base))
  })
})
