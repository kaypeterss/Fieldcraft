import { describe, expect, it } from 'vitest'
import { postMovementCommitView } from './movementInteractionState'

describe('postMovementCommitView', () => {
  it('returns AoS movement to Select while keeping the movement panel ready for the next unit', () => {
    expect(postMovementCommitView('age-of-sigmar', true)).toEqual({ activeTool: 'select', contextPanel: 'movement' })
  })

  it('uses the normal inspector outside an active AoS movement phase', () => {
    expect(postMovementCommitView('development-sandbox', true)).toEqual({ activeTool: 'select', contextPanel: 'inspector' })
    expect(postMovementCommitView('age-of-sigmar', false)).toEqual({ activeTool: 'select', contextPanel: 'inspector' })
  })
})

