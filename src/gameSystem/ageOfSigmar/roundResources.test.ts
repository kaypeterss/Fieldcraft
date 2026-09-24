import { describe, expect, it } from 'vitest'
import {
  AOS_FURY_CAP,
  changeAosFury,
  expireAosRoundResources,
  generateAosRoundResources,
  initialAosRoundResources,
  isAosRoundResources,
  spendAosCommandPoints,
  spendAosRageDice,
} from './roundResources'

const players = ['player-1', 'player-2']

describe('AoS GHB 2026–27 round resources', () => {
  it('initializes persistent attacker and defender Fury at 1 and 2', () => {
    const resources = initialAosRoundResources(players, 'player-1', 'player-2')
    expect(resources.byPlayerId['player-1'].fury).toBe(1)
    expect(resources.byPlayerId['player-2'].fury).toBe(2)
    expect(resources.byPlayerId['player-1'].commandPoints).toBe(0)
    expect(resources.byPlayerId['player-2'].rageDice).toEqual([])
  })

  it('generates 4 CP, the underdog bonus, and unrolled D6 Rage resources equal to Fury', () => {
    const generated = generateAosRoundResources(
      initialAosRoundResources(players, 'player-1', 'player-2'), players, 1, 'player-2',
    )
    expect(generated.byPlayerId['player-1'].commandPoints).toBe(4)
    expect(generated.byPlayerId['player-2'].commandPoints).toBe(5)
    expect(generated.byPlayerId['player-1'].rageDice).toEqual([
      { id: 'rage-r1-player-1-1', sides: 6, generatedRound: 1 },
    ])
    expect(generated.byPlayerId['player-2'].rageDice).toHaveLength(2)
    expect(generated.byPlayerId['player-2'].rageDice.every((die) => !('value' in die))).toBe(true)
  })

  it('caps Fury, spends through validated seams, and rejects insufficient resources', () => {
    let resources = initialAosRoundResources(players, 'player-1', 'player-2')
    resources = changeAosFury(resources, 'player-1', 99)!
    expect(resources.byPlayerId['player-1'].fury).toBe(AOS_FURY_CAP)
    resources = generateAosRoundResources(resources, players, 2)
    expect(spendAosCommandPoints(resources, 'player-1', 5)).toBeNull()
    expect(spendAosRageDice(resources, 'player-2', 3)).toBeNull()
    resources = spendAosCommandPoints(resources, 'player-1', 2)!
    resources = spendAosRageDice(resources, 'player-1', 3)!
    expect(resources.byPlayerId['player-1'].commandPoints).toBe(2)
    expect(resources.byPlayerId['player-1'].rageDice).toHaveLength(4)
  })

  it('expires CP and Rage at round end while preserving Fury and JSON integrity', () => {
    const generated = generateAosRoundResources(
      initialAosRoundResources(players, 'player-1', 'player-2'), players, 1,
    )
    const expired = expireAosRoundResources(generated)
    expect(expired.byPlayerId['player-1']).toMatchObject({ commandPoints: 0, fury: 1, rageDice: [] })
    expect(expired.byPlayerId['player-2']).toMatchObject({ commandPoints: 0, fury: 2, rageDice: [] })
    const restored = JSON.parse(JSON.stringify(expired)) as unknown
    expect(isAosRoundResources(restored)).toBe(true)
    expect(restored).toEqual(expired)
  })
})
