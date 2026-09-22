import type { CoherencyPolicy, CoherencyResult } from '../engine/coherency'
import type { Footprint, TabletopModel, Unit } from '../domain/types'
import { normalizeRotation } from '../engine/geometry/footprints'

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
  targetFootprint: Footprint
  targetRotation: number
  coherencyPolicy: CoherencyPolicy
  coherency: CoherencyResult | null
}

export function describeFootprint(footprint: Footprint, rotation = 0): string {
  const angle = Math.round(normalizeRotation(rotation) * 180 / Math.PI)
  const orientation = footprint.shape === 'circle' ? '' : ` @ ${angle}°`
  switch (footprint.shape) {
    case 'circle':
      return `Circle ${formatMillimeters(footprint.diameterMm)}mm`
    case 'ellipse':
      return `Oval ${formatMillimeters(footprint.widthMm)} × ${formatMillimeters(footprint.heightMm)}mm${orientation}`
    case 'rectangle':
      return `Rectangle ${formatMillimeters(footprint.widthMm)} × ${formatMillimeters(footprint.heightMm)}mm${orientation}`
    case 'polygon': {
      const xs = footprint.verticesMm.map((vertex) => vertex.x)
      const ys = footprint.verticesMm.map((vertex) => vertex.y)
      const width = Math.max(...xs) - Math.min(...xs)
      const height = Math.max(...ys) - Math.min(...ys)
      return `Hull ${formatMillimeters(width)} × ${formatMillimeters(height)}mm (${footprint.verticesMm.length}-point)${orientation}`
    }
  }
}

export function describeSpatialSources(models: readonly TabletopModel[]): string {
  if (models.length === 0) return '—'
  if (models.length === 1) return describeFootprint(models[0].base, models[0].rotation)
  return `${models.length} actual footprints`
}

function formatMillimeters(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}
