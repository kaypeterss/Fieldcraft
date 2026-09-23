import type { BattlefieldFeature, Footprint, Pose, TabletopModel, Unit } from '../domain/types'
import { featureObjectiveArea } from './battlefieldFeatures'
import {
  closestPointsBetweenFootprints,
  footprintContainsFootprint,
  footprintContainsPoint,
  poseForModel,
} from './geometry/footprints'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export interface BattlefieldArea { footprint: Footprint; pose: Pose }
export type AreaPlacement = 'outside' | 'intersecting' | 'wholly-within'

export interface ModelAreaRelationship {
  placement: AreaPlacement
  intersects: boolean
  whollyWithin: boolean
  centerWithin: boolean
  /** Minimum footprint-edge separation in tabletop inches; zero for contact/intersection. */
  distanceInches: number
}

export interface UnitAreaSummary {
  modelCount: number
  intersectingCount: number
  whollyWithinCount: number
  centerWithinCount: number
  /** Closest member's footprint-edge distance to the area, in tabletop inches. */
  distanceInches: number | null
  closestModelId: string | null
}

export interface PlayerAreaSummary extends UnitAreaSummary {
  playerId: string
  playerName: string
  units: Array<UnitAreaSummary & { unitId: string; unitName: string }>
}

export function playerAreaSummaries(
  players: ReadonlyArray<{ id: string; displayName: string }>,
  units: readonly Unit[],
  models: readonly TabletopModel[],
  area: BattlefieldArea,
  unitNames: ReadonlyMap<string, string> = new Map(),
): PlayerAreaSummary[] {
  const modelById = new Map(models.map((model) => [model.id, model]))
  return players.map((player) => {
    const playerUnits = units.filter((unit) => unit.ownerId === player.id)
    const unitResults = playerUnits.map((unit) => ({
      ...unitAreaSummary(unit, models, area), unitId: unit.id,
      unitName: unitNames.get(unit.id) ?? unit.id,
    }))
    const ids = playerUnits.flatMap((unit) => unit.modelIds)
    const aggregate = unitAreaSummary({ id: `player:${player.id}`, ownerId: player.id, definitionId: '', modelIds: ids },
      [...ids].map((id) => modelById.get(id)).filter((model): model is TabletopModel => Boolean(model)), area)
    return { ...aggregate, playerId: player.id, playerName: player.displayName, units: unitResults }
  }).filter((summary) => summary.modelCount > 0)
}

/** Pure geometric facts. No terrain permissions or objective-control rule is consulted. */
export function modelAreaRelationship(model: TabletopModel, area: BattlefieldArea): ModelAreaRelationship {
  const pose = poseForModel(model)
  const distance = closestPointsBetweenFootprints(model.base, pose, area.footprint, area.pose).distance
  const whollyWithin = footprintContainsFootprint(area.footprint, area.pose, model.base, pose)
  const intersects = whollyWithin || distance <= GEOMETRY_EPSILON
  return {
    placement: whollyWithin ? 'wholly-within' : intersects ? 'intersecting' : 'outside',
    intersects,
    whollyWithin,
    centerWithin: footprintContainsPoint(area.footprint, area.pose, model.position),
    distanceInches: intersects ? 0 : distance,
  }
}

export function unitAreaSummary(unit: Unit, models: readonly TabletopModel[], area: BattlefieldArea): UnitAreaSummary {
  const byId = new Map(models.map((model) => [model.id, model]))
  const result: UnitAreaSummary = {
    modelCount: 0, intersectingCount: 0, whollyWithinCount: 0,
    centerWithinCount: 0, distanceInches: null, closestModelId: null,
  }
  for (const id of unit.modelIds) {
    const model = byId.get(id)
    if (!model) continue
    const relation = modelAreaRelationship(model, area)
    result.modelCount += 1
    if (relation.intersects) result.intersectingCount += 1
    if (relation.whollyWithin) result.whollyWithinCount += 1
    if (relation.centerWithin) result.centerWithinCount += 1
    if (result.distanceInches === null || relation.distanceInches < result.distanceInches) {
      result.distanceInches = relation.distanceInches
      result.closestModelId = id
    }
  }
  return result
}

/** A feature base is the same generic area whether or not it has Terrain capability. */
export function featureBaseArea(feature: BattlefieldFeature): BattlefieldArea {
  return { footprint: feature.baseArea, pose: feature.pose }
}

/** Objective-only features have no implicit terrain or movement effect. */
export function objectiveArea(feature: BattlefieldFeature): BattlefieldArea | null {
  return featureObjectiveArea(feature)
}
