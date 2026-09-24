import type { CoherencyPolicy, Pose, TabletopModel, Unit } from '../domain/types'
import { evaluateUnitCoherency, isCoherencyResultValid } from '../engine/coherency'
import { footprintBounds, footprintsOverlap } from '../engine/geometry/footprints'

export type FormationPresetId = 'previous' | 'compact' | 'ranks' | 'line'

export interface FormationPresetCandidate {
  id: FormationPresetId
  label: string
  placements: Record<string, Pose>
  available: boolean
  reason?: string
}

export interface FormationPresetRequest {
  unit: Unit
  movingModels: readonly TabletopModel[]
  /** Active members not being placed, used by partial restoration. */
  fixedModels?: readonly TabletopModel[]
  policy: CoherencyPolicy
  anchor: { x: number; y: number }
  rotation?: number
}

const PRESETS: Array<{ id: FormationPresetId; label: string }> = [
  { id: 'previous', label: 'Previous' },
  { id: 'compact', label: 'Compact' },
  { id: 'ranks', label: 'Ranks' },
  { id: 'line', label: 'Line' },
]

/**
 * Generates small, deterministic formation candidates and validates them with
 * the same overlap/coherency engines used by authoritative placement. A caller
 * must still validate battlefield, terrain and scenario placement constraints.
 */
export function formationPresetCandidates(request: FormationPresetRequest): FormationPresetCandidate[] {
  return PRESETS.map((preset) => {
    const placements = generatePreset(request, preset.id)
    const projected = [
      ...(request.fixedModels ?? []),
      ...request.movingModels.map((model) => ({
        ...model,
        position: { ...placements[model.id].position },
        rotation: placements[model.id].rotation,
      })),
    ]
    if (hasInternalOverlap(projected)) {
      return { ...preset, placements, available: false, reason: 'Models would overlap.' }
    }
    const result = evaluateUnitCoherency(request.unit, projected, request.policy)
    const available = isCoherencyResultValid(result, request.policy)
    return {
      ...preset,
      placements,
      available,
      ...(available ? {} : { reason: request.policy.requiredNeighbors > 1 && preset.id === 'line'
        ? `Endpoints cannot satisfy ${request.policy.requiredNeighbors} required neighbours.`
        : 'Does not satisfy the resolved coherency policy.' }),
    }
  })
}

export function rotateFormationPlacements(
  placements: Readonly<Record<string, Pose>>,
  anchor: { x: number; y: number },
  delta: number,
): Record<string, Pose> {
  const cosine = Math.cos(delta)
  const sine = Math.sin(delta)
  return Object.fromEntries(Object.entries(placements).map(([id, pose]) => {
    const x = pose.position.x - anchor.x
    const y = pose.position.y - anchor.y
    return [id, {
      position: { x: anchor.x + x * cosine - y * sine, y: anchor.y + x * sine + y * cosine },
      rotation: normalizeRadians(pose.rotation + delta),
    }]
  }))
}

function generatePreset(request: FormationPresetRequest, preset: FormationPresetId): Record<string, Pose> {
  const models = [...request.movingModels]
  if (models.length === 0) return {}
  const rotation = request.rotation ?? 0
  if (preset === 'previous') {
    const center = models.reduce((sum, model) => ({ x: sum.x + model.position.x, y: sum.y + model.position.y }), { x: 0, y: 0 })
    center.x /= models.length
    center.y /= models.length
    const cosine = Math.cos(rotation)
    const sine = Math.sin(rotation)
    return Object.fromEntries(models.map((model) => {
      const x = model.position.x - center.x
      const y = model.position.y - center.y
      return [model.id, {
        position: {
          x: request.anchor.x + x * cosine - y * sine,
          y: request.anchor.y + x * sine + y * cosine,
        },
        rotation: normalizeRadians(model.rotation + rotation),
      }]
    }))
  }
  const gap = Math.max(0.04, Math.min(0.25, request.policy.distance * (preset === 'ranks' ? 0.8 : 0.72)))
  const dimensions = models.map((model) => {
    const pose = { position: { x: 0, y: 0 }, rotation: normalizeRadians(model.rotation + rotation) }
    const bounds = footprintBounds(model.base, pose)
    return { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }
  })
  const cellWidth = Math.max(...dimensions.map((value) => value.width)) + gap
  const cellHeight = Math.max(...dimensions.map((value) => value.height)) + gap
  const columns = preset === 'line' ? models.length
    : preset === 'ranks' ? Math.max(2, Math.ceil(models.length / 2))
      : Math.ceil(Math.sqrt(models.length))
  const rows = Math.ceil(models.length / columns)
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return Object.fromEntries(models.map((model, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const rowCount = Math.min(columns, models.length - row * columns)
    const localX = (column - (rowCount - 1) / 2) * cellWidth
      + (preset === 'ranks' && row % 2 === 1 ? cellWidth * 0.25 : 0)
    const localY = (row - (rows - 1) / 2) * cellHeight
    return [model.id, {
      position: {
        x: request.anchor.x + localX * cosine - localY * sine,
        y: request.anchor.y + localX * sine + localY * cosine,
      },
      rotation: normalizeRadians(model.rotation + rotation),
    }]
  }))
}

function hasInternalOverlap(models: readonly TabletopModel[]): boolean {
  for (let left = 0; left < models.length; left += 1) {
    for (let right = left + 1; right < models.length; right += 1) {
      const a = models[left]
      const b = models[right]
      if (footprintsOverlap(a.base, { position: a.position, rotation: a.rotation }, b.base, { position: b.position, rotation: b.rotation })) return true
    }
  }
  return false
}

function normalizeRadians(angle: number): number {
  const turn = Math.PI * 2
  return ((angle % turn) + turn) % turn
}
