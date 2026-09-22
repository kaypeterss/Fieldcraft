import { describe, expect, it } from 'vitest'
import {
  initialSmartMoveTargetState,
  lockSmartMoveTarget,
  previewSmartMoveTarget,
  resolveSmartMoveEnterAction,
} from './smartMoveTarget'

describe('Smart Move target workflow', () => {
  it('updates live targets and freezes pointer previews after a battlefield lock', () => {
    const live = previewSmartMoveTarget(initialSmartMoveTargetState(), { x: 4, y: 5 })
    expect(live).toEqual({ mode: 'live', target: { x: 4, y: 5 } })
    const locked = lockSmartMoveTarget({ x: 6, y: 7 })
    expect(previewSmartMoveTarget(locked, { x: 99, y: 99 })).toBe(locked)
  })

  it('repositions a locked target while remaining locked', () => {
    const first = lockSmartMoveTarget({ x: 6, y: 7 })
    const second = lockSmartMoveTarget({ x: 10, y: 11 })
    expect(first.target).toEqual({ x: 6, y: 7 })
    expect(second).toEqual({ mode: 'locked', target: { x: 10, y: 11 } })
  })

  it('starts each session in live targeting with no authoritative target', () => {
    expect(initialSmartMoveTargetState()).toEqual({ mode: 'live', target: null })
  })

  it.each([
    { x: -5, y: 20 },
    { x: 70, y: 30 },
    { x: 20, y: -5 },
    { x: 20, y: 54 },
    { x: 80, y: 64 },
  ])('retains unconstrained outside-battlefield intent coordinates', (target) => {
    expect(previewSmartMoveTarget(initialSmartMoveTargetState(), target).target).toEqual(target)
    expect(lockSmartMoveTarget(target).target).toEqual(target)
  })

  it('keeps the exact raw live target so sampling can happen independently', () => {
    const first = previewSmartMoveTarget(initialSmartMoveTargetState(), { x: 12, y: 8 })
    const jittered = previewSmartMoveTarget(first, { x: 12.005, y: 8.003 })
    expect(jittered).not.toBe(first)
    expect(jittered.target).toEqual({ x: 12.005, y: 8.003 })
  })

  it('makes Enter lock the exact raw target without applying an older ghost', () => {
    const sampledState = previewSmartMoveTarget(initialSmartMoveTargetState(), { x: 10, y: 5 })
    expect(resolveSmartMoveEnterAction(sampledState, { x: 10.037, y: 5.019 }, true)).toEqual({
      type: 'lock',
      target: { x: 10.037, y: 5.019 },
    })
  })

  it('allows Enter to apply only a current matching locked result', () => {
    const locked = lockSmartMoveTarget({ x: 10, y: 5 })
    expect(resolveSmartMoveEnterAction(locked, locked.target, false)).toEqual({ type: 'none' })
    expect(resolveSmartMoveEnterAction(locked, locked.target, true)).toEqual({ type: 'apply' })
  })
})
