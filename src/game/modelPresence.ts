import type { GameState, ModelPresence, TabletopModel } from '../domain/types'

export function modelPresence(model: TabletopModel): ModelPresence {
  return model.presence ?? 'ON_BATTLEFIELD'
}

export function isModelOnBattlefield(model: TabletopModel): boolean {
  return modelPresence(model) === 'ON_BATTLEFIELD'
}

/** The single authoritative input view for rendering and all tabletop geometry. */
export function activeBattlefieldModels(state: Pick<GameState, 'models'>): TabletopModel[] {
  return state.models.filter(isModelOnBattlefield)
}

export function inactiveModels(state: Pick<GameState, 'models'>): TabletopModel[] {
  return state.models.filter((model) => !isModelOnBattlefield(model))
}
