import type { TabletopModel } from '../domain/types'
import { circularEdgeDistance } from '../engine/geometry/circles'
import { millimetersToInches } from '../engine/units'

export interface MeasurementPair {
  fromModelId: string
  toModelId: string
}

export interface ModelMeasurement extends MeasurementPair {
  distanceInches: number
}

export function measureBetweenCircularModels(
  from: TabletopModel,
  to: TabletopModel,
): ModelMeasurement {
  return {
    fromModelId: from.id,
    toModelId: to.id,
    distanceInches: circularEdgeDistance(
      from.position,
      millimetersToInches(from.base.diameterMm) / 2,
      to.position,
      millimetersToInches(to.base.diameterMm) / 2,
    ),
  }
}
