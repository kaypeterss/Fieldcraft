import type { BattlefieldFeature } from '../domain/types'
import { featureObjectiveArea } from '../engine/battlefieldFeatures'

/** Shared objective geometry with presentation emphasis only; no duplicate control-zone dimensions. */
export function objectiveControlAreaPresentation(
  feature: BattlefieldFeature,
  spatialActive = false,
  selected = false,
) {
  const area = featureObjectiveArea(feature)
  if (!area) return null
  return {
    ...area,
    fillAlpha: spatialActive ? selected ? 0.08 : 0.035 : 0.025,
    strokeAlpha: spatialActive ? selected ? 0.95 : 0.65 : 0.32,
    strokeWidth: spatialActive ? selected ? 0.22 : 0.13 : 0.09,
  }
}
