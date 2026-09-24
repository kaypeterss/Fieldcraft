import type { AosAreaPolygon } from '../types'

export const whatsYoursIsOurs = {
  id: 'whats-yours-is-ours', version: '2026-27', name: "What's Yours Is Ours",
  battlefield: { width: 44, height: 30 }, roundLimit: 5,
  territories: [
    { id: 'attacker-left', name: "Attacker's Territory", vertices: [{ x: 0, y: 0 }, { x: 22, y: 0 }, { x: 22, y: 15 }, { x: 0, y: 15 }] },
    { id: 'attacker-right', name: "Attacker's Territory", vertices: [{ x: 34, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 8 }, { x: 34, y: 8 }] },
    { id: 'defender-left', name: "Defender's Territory", vertices: [{ x: 0, y: 15 }, { x: 22, y: 15 }, { x: 22, y: 30 }, { x: 0, y: 30 }] },
    { id: 'defender-right', name: "Defender's Territory", vertices: [{ x: 34, y: 22 }, { x: 44, y: 22 }, { x: 44, y: 30 }, { x: 34, y: 30 }] },
  ] satisfies AosAreaPolygon[],
  objectives: [
    { id: 'sun-seekers-north', name: 'Sun Seekers North', x: 32.7, y: 8 },
    { id: 'golden-lions-west', name: 'Golden Lions West', x: 11, y: 15 },
    { id: 'scions-of-the-comet', name: 'Scions of the Comet', x: 22, y: 15 },
    { id: 'golden-lions-east', name: 'Golden Lions East', x: 33, y: 15 },
    { id: 'sun-seekers-south', name: 'Sun Seekers South', x: 32.7, y: 22.5 },
  ],
  terrainLocations: [
    { id: 'wyldwood-west', kind: 'area', x: 5, y: 15 }, { id: 'wyldwood-north', kind: 'area', x: 11, y: 7.5 },
    { id: 'wyldwood-south', kind: 'area', x: 11, y: 22.5 }, { id: 'wyldwood-east', kind: 'area', x: 27, y: 15 },
    { id: 'nexus-syphon', kind: 'place-of-power', x: 16.5, y: 15 }, { id: 'cleansing-aqualith', kind: 'place-of-power', x: 38.9, y: 15 },
    { id: 'domicile-shell-north', kind: 'obstacle', x: 27.5, y: 3.6 }, { id: 'domicile-shell-south', kind: 'obstacle', x: 27.5, y: 26.4 },
  ],
  scoringSummary: ['3 VP: control at least one objective', '3 VP: control the coveted pair', '4 VP: control more objectives than the opponent'],
  source: 'https://aosmissions.app/battleplans/whats-yours-is-ours',
} as const

