import { describe, expect, it } from 'vitest'
import { resolveAosLifecyclePresentation } from './aosLifecyclePresentation'

describe('resolveAosLifecyclePresentation', () => {
  it('keeps a fresh AoS match in setup regardless of implemented capabilities', () => {
    expect(resolveAosLifecyclePresentation('SETUP')).toBe('SETUP')
    expect(resolveAosLifecyclePresentation(undefined)).toBe('SETUP')
  })

  it('uses deployment substates without inferring them from a battle capability', () => {
    expect(resolveAosLifecyclePresentation('DEPLOYMENT', 'DEPLOYING')).toBe('DEPLOYMENT')
    expect(resolveAosLifecyclePresentation('DEPLOYMENT', 'READY_FOR_BATTLE')).toBe('READY_FOR_BATTLE')
  })

  it('shows battle and completed presentation only for those authoritative lifecycles', () => {
    expect(resolveAosLifecyclePresentation('IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(resolveAosLifecyclePresentation('COMPLETED')).toBe('COMPLETED')
    expect(resolveAosLifecyclePresentation('SETUP', 'READY_FOR_BATTLE')).toBe('SETUP')
  })
})
