import type { AosWarscrollProfile } from '../types'
const source = (path: string) => ({ snapshot: '2026-09-24', verifiedAt: '2026-09-24', source: `https://wahapedia.ru/aos4/factions/skaven/${path}` })

export const skavenWarscrolls: readonly AosWarscrollProfile[] = [
  { id: 'clawlord-on-gnaw-beast', name: 'Clawlord on Gnaw-beast', faction: 'Skaven', move: 9, health: 7, save: 4, control: 2, unitSize: 1,
    footprint: { shape: 'ellipse', widthMm: 75, heightMm: 42 }, keywords: ['CHAOS', 'SKAVEN', 'VERMINUS', 'HERO', 'CAVALRY'],
    weapons: [
      { id: 'warpforged-halberd', name: 'Warpforged Halberd', type: 'melee', attacks: '5', hit: 3, wound: 4, rend: 1, damage: '2' },
      { id: 'gnaw-beast-chisel-fangs', name: 'Gnaw-beast’s Chisel Fangs', type: 'melee', attacks: '4', hit: 4, wound: 3, rend: 1, damage: 'D3', abilities: ['Companion'] },
    ], source: source('Clawlord-on-Gnaw-beast') },
  { id: 'clanrats', name: 'Clanrats', faction: 'Skaven', move: 6, health: 1, save: 5, control: 1, unitSize: 20,
    footprint: { shape: 'circle', diameterMm: 25 }, keywords: ['CHAOS', 'SKAVEN', 'VERMINUS', 'INFANTRY'],
    weapons: [{ id: 'rusty-weapon', name: 'Rusty Weapon', type: 'melee', attacks: '2', hit: 4, wound: 5, rend: 0, damage: '1', abilities: ['Crit (Auto-wound)'] }], source: source('Clanrats') },
  { id: 'rat-ogors', name: 'Rat Ogors', faction: 'Skaven', move: 6, health: 4, save: 5, control: 1, unitSize: 3,
    footprint: { shape: 'circle', diameterMm: 50 }, keywords: ['CHAOS', 'SKAVEN', 'MOULDER', 'INFANTRY'],
    weapons: [{ id: 'claws-blades-fangs', name: 'Claws, Blades and Fangs', type: 'melee', attacks: '5', hit: 4, wound: 3, rend: 1, damage: '2' }], source: source('Rat-Ogors') },
  { id: 'warplock-jezzails', name: 'Warplock Jezzails', faction: 'Skaven', move: 6, health: 2, save: 4, control: 1, unitSize: 3,
    footprint: { shape: 'ellipse', widthMm: 60, heightMm: 35 }, keywords: ['CHAOS', 'SKAVEN', 'SKRYRE', 'INFANTRY'],
    weapons: [{ id: 'warplock-jezzail', name: 'Warplock Jezzail', type: 'ranged', range: 18, attacks: '2', hit: 4, wound: 3, rend: 2, damage: '2', abilities: ['Crit (Auto-wound)'] }], source: source('Warplock-Jezzails') },
]
