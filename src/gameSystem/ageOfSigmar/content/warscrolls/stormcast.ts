import type { AosWarscrollProfile } from '../types'
const source = (path: string) => ({ snapshot: '2026-09-24', verifiedAt: '2026-09-24', source: `https://wahapedia.ru/aos4/factions/stormcast-eternals/${path}` })

export const stormcastWarscrolls: readonly AosWarscrollProfile[] = [
  { id: 'knight-questor', name: 'Knight-Questor', faction: 'Stormcast Eternals', move: 5, health: 6, save: 3, control: 2, unitSize: 1,
    footprint: { shape: 'circle', diameterMm: 40 }, keywords: ['ORDER', 'STORMCAST ETERNALS', 'HERO', 'INFANTRY'],
    weapons: [{ name: 'Questor Warblade', attacks: '5', hit: 3, wound: 3, rend: 1, damage: '2', abilities: ['Anti-HERO (+1 Rend)', 'Crit (Mortal)'] }], source: source('Knight-Questor') },
  { id: 'liberators', name: 'Liberators', faction: 'Stormcast Eternals', move: 5, health: 2, save: 3, control: 1, unitSize: 5,
    footprint: { shape: 'circle', diameterMm: 40 }, keywords: ['ORDER', 'STORMCAST ETERNALS', 'INFANTRY'],
    weapons: [{ name: 'Warhammer', attacks: '2', hit: 3, wound: 3, rend: 1, damage: '1', abilities: ['Crit (Mortal)'] }], source: source('Liberators') },
  { id: 'vanguard-raptors-hurricane', name: 'Vanguard-Raptors with Hurricane Crossbows', faction: 'Stormcast Eternals', move: 5, health: 2, save: 3, control: 1, unitSize: 3,
    footprint: { shape: 'circle', diameterMm: 40 }, keywords: ['ORDER', 'STORMCAST ETERNALS', 'INFANTRY'],
    weapons: [{ name: 'Hurricane Crossbow', range: 12, attacks: '4', hit: 3, wound: 3, rend: 0, damage: '1' }], source: source('Vanguard-Raptors-with-Hurricane-Crossbows') },
  { id: 'dracothian-guard-concussors', name: 'Dracothian Guard Concussors', faction: 'Stormcast Eternals', move: 10, health: 5, save: 3, control: 2, unitSize: 2,
    footprint: { shape: 'ellipse', widthMm: 90, heightMm: 52 }, keywords: ['ORDER', 'STORMCAST ETERNALS', 'CAVALRY'],
    weapons: [{ name: 'Lightning Hammer', attacks: '3', hit: 3, wound: 2, rend: 1, damage: '2' }], source: source('Dracothian-Guard-Concussors') },
]

