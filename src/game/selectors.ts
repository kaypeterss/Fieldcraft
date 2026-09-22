import type { CoherencyPolicy, GameState, Player, TabletopModel, Unit, UnitDefinition } from '../domain/types'

export function getUnitForModel(state: GameState, modelId: string): Unit | undefined {
  const model = state.models.find((candidate) => candidate.id === modelId)
  return model ? state.units.find((unit) => unit.id === model.unitId) : undefined
}

export function getUnitDefinition(state: GameState, unit: Unit): UnitDefinition | undefined {
  return state.unitDefinitions.find((definition) => definition.id === unit.definitionId)
}

export function getMovementAllowance(state: GameState, model: TabletopModel): number {
  const unit = state.units.find((candidate) => candidate.id === model.unitId)
  const definition = unit && getUnitDefinition(state, unit)
  return definition?.movementAllowance ?? 0
}

export function getUnitCoherencyPolicy(state: GameState, unit: Unit): CoherencyPolicy | undefined {
  return getUnitDefinition(state, unit)?.coherencyPolicy
}

export function getUnitBaseDiameters(state: GameState, unit: Unit): number[] {
  return [...new Set(state.models
    .filter((model) => unit.modelIds.includes(model.id))
    .map((model) => model.base.diameterMm))].sort((a, b) => a - b)
}

export function getUnitBaseLabel(state: GameState, unit: Unit): string {
  const diameters = getUnitBaseDiameters(state, unit)
  return diameters.length === 1 ? `${diameters[0]} mm` : 'Mixed'
}

export function getPlayerForUnit(state: GameState, unit: Unit): Player | undefined {
  return state.players.find((player) => player.id === unit.ownerId)
}

export function getPlayerForModel(state: GameState, model: TabletopModel): Player | undefined {
  return state.players.find((player) => player.id === model.ownerId)
}

export function canUndoLastMovement(state: GameState): boolean {
  return !state.movementSession
    && state.lastConfirmedMovementUndo?.turnId === state.gameContext.turnId
}
