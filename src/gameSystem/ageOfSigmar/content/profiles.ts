import { skavenWarscrolls } from './warscrolls/skaven'
import { stormcastWarscrolls } from './warscrolls/stormcast'
import type { AosWarscrollProfile } from './types'

export const aosControlledWarscrolls = [...stormcastWarscrolls, ...skavenWarscrolls] as const

/** Browser-QA only: proves Ward timing without attributing a Ward to a real controlled warscroll. */
export const aosQaWardGuardProfile: AosWarscrollProfile = {
  id: 'qa-ward-guard', name: 'Ward Guard QA', faction: 'Fieldcraft QA', move: 5, health: 7, save: 4, control: 1,
  unitSize: 1, footprint: { shape: 'ellipse', widthMm: 75, heightMm: 42 }, keywords: ['QA', 'HERO', 'CAVALRY', 'WARD (6+)'], ward: 6,
  weapons: [{ id: 'qa-ward-blade', name: 'Ward Blade', type: 'melee', attacks: '4', hit: 4, wound: 4, rend: 1, damage: '2' }],
  source: { snapshot: '2026-09-24', verifiedAt: '2026-09-26', source: 'fieldcraft://qa/aos-ward-guard' },
}

const byId = new Map([...aosControlledWarscrolls, aosQaWardGuardProfile].map((profile) => [profile.id, profile]))

export function aosWarscrollById(id: string) { return byId.get(id) }

export function aosWarscrollIdFromDefinitionId(definitionId: string): string | null {
  return definitionId.startsWith('aos-') ? definitionId.slice(4) : null
}
