import type { Footprint } from '../../../domain/types'
import type { Point } from '../../../engine/geometry/point'

export interface AosSourceMetadata { snapshot: string; source: string; verifiedAt: string }
export interface AosWeaponProfile {
  /** Stable within the versioned warscroll snapshot. */
  id: string
  name: string
  type: 'melee' | 'ranged'
  range?: number
  attacks: string
  hit: number
  wound: number
  rend: number
  damage: string
  abilities?: string[]
  /** Optional stable roster-model ordinals for special weapons. */
  modelIndices?: number[]
  /** Optional restrained battlefield identity for an authored special loadout. */
  modelMarker?: { kind: 'loadout' | 'role'; symbol: string }
}
export interface AosWarscrollProfile {
  id: string; name: string; faction: string; move: number; health: number; save: number; control: number
  unitSize: number; footprint: Footprint; keywords: string[]; weapons: AosWeaponProfile[]; ward?: number; source: AosSourceMetadata
}
export interface AosRosterUnit { id: string; warscrollId: string; displayName: string }
export interface AosRoster { id: string; name: string; faction: string; units: AosRosterUnit[] }
export interface AosAreaPolygon { id: string; name: string; vertices: Point[] }
