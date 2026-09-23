import type {
  GameContext,
  Player,
  TabletopModel,
  Unit,
  UnitDefinition,
} from '../domain/types'
import type { BattlefieldArea } from './areaRelationships'
import { modelAreaRelationship } from './areaRelationships'
import {
  effectiveObjectiveControl,
  objectiveRelationshipQualifies,
} from '../gameSystem/policies'
import type { ObjectiveConfiguration } from '../gameSystem/types'

export interface PlayerObjectiveControl {
  playerId: string
  playerName: string
  qualifyingModelIds: string[]
  qualifyingModelCount: number
  totalControl: number
}

export type ObjectiveControlState = 'uncontrolled' | 'contested' | 'controlled'

export interface ObjectiveControlResult {
  state: ObjectiveControlState
  controllingPlayerId: string | null
  players: PlayerObjectiveControl[]
}

/** Geometry qualifies models; GameSystem policy values them; this function only aggregates. */
export function evaluateObjectiveControl(request: {
  area: BattlefieldArea
  players: readonly Player[]
  models: readonly TabletopModel[]
  units: readonly Unit[]
  unitDefinitions: readonly UnitDefinition[]
  gameContext: GameContext
  objective: ObjectiveConfiguration
}): ObjectiveControlResult | null {
  const controlPolicy = request.objective.control
  if (!controlPolicy) return null
  const unitsById = new Map(request.units.map((unit) => [unit.id, unit]))
  const definitionsById = new Map(request.unitDefinitions.map((definition) => [definition.id, definition]))
  const players = request.players.map((player): PlayerObjectiveControl => {
    const qualifying = request.models.filter((model) => model.ownerId === player.id
      && objectiveRelationshipQualifies(
        request.objective.qualification,
        modelAreaRelationship(model, request.area),
      ))
    return {
      playerId: player.id,
      playerName: player.displayName,
      qualifyingModelIds: qualifying.map((model) => model.id),
      qualifyingModelCount: qualifying.length,
      totalControl: qualifying.reduce((total, model) => {
        const unit = unitsById.get(model.unitId)
        const unitDefinition = unit ? definitionsById.get(unit.definitionId) : undefined
        return total + effectiveObjectiveControl(controlPolicy, {
          model, unit, unitDefinition, gameContext: request.gameContext,
        })
      }, 0),
    }
  })

  const highest = Math.max(0, ...players.map((player) => player.totalControl))
  const leaders = highest > 0 ? players.filter((player) => player.totalControl === highest) : []
  return {
    state: leaders.length === 0 ? 'uncontrolled' : leaders.length === 1 ? 'controlled' : 'contested',
    controllingPlayerId: leaders.length === 1 ? leaders[0].playerId : null,
    players,
  }
}
