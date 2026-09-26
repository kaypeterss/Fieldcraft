import { describe, expect, it } from 'vitest'
import { aosPhaseProgressionBlockReason } from './aosPhaseProgression'

describe('AoS phase progression blocking', () => {
  it('blocks only unresolved staged movement or Smart Move previews', () => {
    expect(aosPhaseProgressionBlockReason(true, false)).toContain('Confirm or cancel')
    expect(aosPhaseProgressionBlockReason(false, true)).toContain('Apply or cancel')
  })

  it('restores progression after Confirm or Cancel clears transient action state', () => {
    expect(aosPhaseProgressionBlockReason(false, false)).toBeUndefined()
  })

  it('does not depend on selection, eligible unmoved units, or the visible analysis tool', () => {
    expect(aosPhaseProgressionBlockReason(false, false)).toBeUndefined()
  })
})

