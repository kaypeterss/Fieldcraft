export const ghb2026Battlepack = {
  id: 'generals-handbook', version: '2026-27', name: "General's Handbook 2026–27", roundLimit: 5,
  battleplanIds: ['whats-yours-is-ours'],
  roundResources: {
    commandPoints: { basePerRound: 4, underdogBonus: 1, expireAtRoundEnd: true },
    fury: { attackerInitial: 1, defenderInitial: 2, minimum: 0, maximum: 7, persistsBetweenRounds: true },
    rageDice: { sides: 6, countEqualsFury: true, expireAtRoundEnd: true, rolledWhenGained: false },
  },
  source: 'https://www.warhammer-community.com/en-gb/articles/yb8viq2m/head-to-aqshy-with-the-new-generals-handbook/',
} as const
