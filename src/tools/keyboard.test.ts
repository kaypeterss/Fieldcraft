import { describe, expect, it } from 'vitest'
import { formationShortcutForEvent } from './keyboard'

describe('formation keyboard shortcuts', () => {
  it('maps arrows to formation actions', () => {
    const base = { altKey: false, ctrlKey: false, metaKey: false }
    expect(formationShortcutForEvent({ ...base, key: 'ArrowUp' })).toBe('previous')
    expect(formationShortcutForEvent({ ...base, key: 'ArrowDown' })).toBe('next')
    expect(formationShortcutForEvent({ ...base, key: 'ArrowLeft' })).toBe('rotate-left')
    expect(formationShortcutForEvent({ ...base, key: 'ArrowRight' })).toBe('rotate-right')
  })

  it('does not claim modified or unrelated keys', () => {
    expect(formationShortcutForEvent({ key: 'ArrowUp', altKey: true, ctrlKey: false, metaKey: false })).toBeNull()
    expect(formationShortcutForEvent({ key: 'q', altKey: false, ctrlKey: false, metaKey: false })).toBeNull()
  })
})
