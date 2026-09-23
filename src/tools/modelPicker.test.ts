import { describe, expect, it } from 'vitest'
import { applyModelPick, cancelModelPick } from './modelPicker'

describe('battlefield model picker', () => {
  it('assigns a viewer and exits the transient pick without changing selection', () => {
    expect(applyModelPick('viewer', 'infantry-a3', { viewerId: null, targetId: 'cavalry-b2' }))
      .toEqual({ viewerId: 'infantry-a3', targetId: 'cavalry-b2' })
  })

  it('assigns a target and clears a duplicate viewer to keep the pair distinct', () => {
    expect(applyModelPick('target', 'infantry-a3', { viewerId: 'infantry-a3', targetId: null }))
      .toEqual({ viewerId: null, targetId: 'infantry-a3' })
  })

  it('leaves the previous pair unchanged when Escape cancels before completion', () => {
    const before = { viewerId: 'viewer', targetId: 'target' }
    expect(cancelModelPick(before)).toEqual(before)
  })
})
