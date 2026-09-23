import type { GameSystem } from './types'

/** Generic permissive defaults for the prototype and QA boards, not a named ruleset. */
export const developmentGameSystem: GameSystem = {
  id: 'development-sandbox',
  name: 'Development Sandbox',
  version: 'm8.0',
  movement: {
    permissions: {
      actionLimit: { type: 'unlimited' },
      allowance: { type: 'reset-per-action' },
    },
    cost: { type: 'movement-envelope' },
  },
  coherency: { type: 'unit-definition' },
  terrain: {
    defaultBase: { canEnter: true, canCross: true, canFinish: true },
    defaultObject: { canEnter: false, canCross: false, canFinish: false },
    rules: [],
  },
  visibility: { mode: 'any-to-any', terrainPolicy: 'objects-block' },
  objectives: {
    qualification: 'intersects',
    control: { type: 'model-or-unit-value', defaultValue: 0 },
  },
  turns: { phases: [] },
  matchState: {
    schemaId: 'fieldcraft.development-match-state',
    schemaVersion: 1,
    createInitialData: () => ({}),
    validate: (data) => typeof data === 'object' && data !== null && !Array.isArray(data),
  },
}
