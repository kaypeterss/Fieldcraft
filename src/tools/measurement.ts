import type { TabletopModel } from '../domain/types'
import { distanceBetweenBases } from '../engine/spatial'

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
    distanceInches: distanceBetweenBases(from, to),
  }
}
