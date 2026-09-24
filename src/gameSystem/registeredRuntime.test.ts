import { describe, expect, it } from 'vitest'
import { lifecycleDemoGameState } from '../game/lifecycleDemo'
import { reduceGameCommand } from '../state/commandBoundary'
import { loadRegisteredMatchRuntime } from './runtime'
import {
  ageOfSigmarGameSystemRegistration,
  developmentGameSystemRegistration,
  gameSystemRegistry,
} from './registeredGameSystems'

describe('registered runtime command authority', () => {
  it('uses the adapter resolved from the match instead of Development', () => {
    const development = developmentGameSystemRegistration.createMatch()
    const developmentNext = reduceGameCommand(
      loadRegisteredMatchRuntime(development, gameSystemRegistry),
      development,
      { type: 'score/eventRecorded', playerId: 'player-1', pointsDelta: 1, reason: 'test' },
    )
    expect(developmentNext.scoreHistory).toHaveLength(1)

    const aos = ageOfSigmarGameSystemRegistration.createMatch()
    const aosNext = reduceGameCommand(
      loadRegisteredMatchRuntime(aos, gameSystemRegistry),
      aos,
      { type: 'score/eventRecorded', playerId: 'player-1', pointsDelta: 1, reason: 'test' },
    )
    expect(aosNext).toBe(aos)
    expect(aosNext.scoreHistory).toHaveLength(0)
  })

  it('resolves the lifecycle QA route through registered Development content', () => {
    const loaded = loadRegisteredMatchRuntime(lifecycleDemoGameState, gameSystemRegistry)
    expect(loaded.registration?.gameSystem.id).toBe('development-sandbox')
    expect(loaded.identity.mission).toEqual({ id: 'development-lifecycle-qa', version: '1' })
  })
})
