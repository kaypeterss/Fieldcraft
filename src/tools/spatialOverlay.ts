import type { CoherencyPolicy, CoherencyResult } from '../engine/coherency'
import type { Unit } from '../domain/types'

export type SpatialMode = 'range' | 'exclusion' | 'coherency'
export type CoherencyAnalysisMode = 'unit-policy' | 'custom'

export function resolveSpatialCoherencyPolicy(
  mode: CoherencyAnalysisMode,
  unitPolicy: CoherencyPolicy | undefined,
  customPolicy: CoherencyPolicy,
): CoherencyPolicy {
  return mode === 'unit-policy' && unitPolicy ? unitPolicy : customPolicy
}

export function resolveSpatialCoherencyUnit(
  units: ReadonlyArray<Unit>,
  selectedModelIds: ReadonlySet<string>,
): Unit | undefined {
  if (selectedModelIds.size === 0) return undefined
  return units.find((unit) => [...selectedModelIds].every((id) => unit.modelIds.includes(id)))
}

export interface SpatialOverlayConfig {
  mode: SpatialMode
  sourceModelIds: string[]
  range: number
  requiredSeparation: number
  targetBaseDiameterMm: number
  coherencyPolicy: CoherencyPolicy
  coherency: CoherencyResult | null
}
