import type { GameState, Player, TabletopModel, Unit, UnitDefinition } from '../domain/types'

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
