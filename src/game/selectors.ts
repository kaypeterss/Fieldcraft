import type { CoherencyPolicy, GameState, Player, TabletopModel, Unit, UnitDefinition } from '../domain/types'
import { activeBattlefieldModels } from './modelPresence'

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
  return [...new Set(activeBattlefieldModels(state)
    .filter((model) => unit.modelIds.includes(model.id))
    .flatMap((model) => model.base.shape === 'circle' ? [model.base.diameterMm] : []))].sort((a, b) => a - b)
}

export function getUnitBaseLabel(state: GameState, unit: Unit): string {
  const models = activeBattlefieldModels(state).filter((model) => unit.modelIds.includes(model.id))
  const footprints = [...new Map(models.map((model) => [JSON.stringify(model.base), model.base])).values()]
  if (footprints.length === 0) return '—'
  if (footprints.length !== 1) return 'Mixed'
  const footprint = footprints[0]
  if (!footprint) return '—'
  switch (footprint.shape) {
    case 'circle':
      return `${footprint.diameterMm} mm circle`
    case 'ellipse':
      return `Oval ${footprint.widthMm} × ${footprint.heightMm} mm`
    case 'rectangle':
      return `Rectangle ${footprint.widthMm} × ${footprint.heightMm} mm`
    case 'polygon': {
      const xs = footprint.verticesMm.map((vertex) => vertex.x)
      const ys = footprint.verticesMm.map((vertex) => vertex.y)
      return `Hull ${Math.max(...xs) - Math.min(...xs)} × ${Math.max(...ys) - Math.min(...ys)} mm`
    }
  }
}

export function getPlayerForUnit(state: GameState, unit: Unit): Player | undefined {
  return state.players.find((player) => player.id === unit.ownerId)
}

export function getPlayerForModel(state: GameState, model: TabletopModel): Player | undefined {
  return state.players.find((player) => player.id === model.ownerId)
}

export function canUndoLastMovement(state: GameState): boolean {
  return !state.movementSession
    && state.lastCommittedOperationUndo?.turnId === state.gameContext.turnId
}
