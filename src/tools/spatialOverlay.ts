import type { CoherencyPolicy, CoherencyResult } from '../engine/coherency'

export type SpatialMode = 'range' | 'exclusion' | 'coherency'

export interface SpatialOverlayConfig {
  mode: SpatialMode
  sourceModelIds: string[]
  range: number
  requiredSeparation: number
  targetBaseDiameterMm: number
  coherencyPolicy: CoherencyPolicy
  coherency: CoherencyResult | null
}
