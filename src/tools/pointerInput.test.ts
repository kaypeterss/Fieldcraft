import { describe, expect, it } from 'vitest'
import type { ActiveTool } from '../ui/Toolbar'
import { resolveModelPointerDown, resolveTabletopPointerDown } from './pointerInput'
import { selectionForModelPointerDown } from './selection'

const tools: ActiveTool[] = ['select', 'measure', 'smart-move']

describe('tabletop pointer priority', () => {
  it.each(tools)('routes middle mouse to camera pan while %s is active', (tool) => {
    expect(resolveTabletopPointerDown(tool, 1)).toEqual({ kind: 'camera-pan' })
  })

  it.each(tools)('preserves primary-button behavior for %s', (tool) => {
    expect(resolveTabletopPointerDown(tool, 0)).toEqual({ kind: 'tool', tool })
  })

  it('preserves the existing secondary-button camera navigation', () => {
    expect(resolveTabletopPointerDown('measure', 2)).toEqual({ kind: 'camera-pan' })
  })

  it('selects model and unit clicks in Smart Move while empty-table clicks target the board', () => {
    expect(resolveModelPointerDown('smart-move', 0)).toBe('select-model')
    expect(resolveTabletopPointerDown('smart-move', 0)).toEqual({ kind: 'tool', tool: 'smart-move' })
    expect(selectionForModelPointerDown(new Set(), 'a', ['a', 'b'], {
      shiftKey: false, unitKey: false,
    })).toEqual(new Set(['a']))
    expect(selectionForModelPointerDown(new Set(['a']), 'b', ['a', 'b'], {
      shiftKey: true, unitKey: false,
    })).toEqual(new Set(['a', 'b']))
    expect(selectionForModelPointerDown(new Set(['a']), 'b', ['a', 'b'], {
      shiftKey: false, unitKey: true,
    })).toEqual(new Set(['a', 'b']))
    expect(resolveModelPointerDown('smart-move', 1)).toBe('camera-pan')
  })

  it('gives a transient model picker priority without consuming camera pan', () => {
    expect(resolveTabletopPointerDown('measure', 0, true)).toEqual({ kind: 'model-pick-wait' })
    expect(resolveModelPointerDown('smart-move', 0, true)).toBe('pick-model')
    expect(resolveTabletopPointerDown('measure', 1, true)).toEqual({ kind: 'camera-pan' })
    expect(resolveModelPointerDown('smart-move', 1, true)).toBe('camera-pan')
  })

  it('keeps Measure model clicks ahead of staged-placement commits', () => {
    expect(resolveModelPointerDown('measure', 0, false, true)).toBe('measure')
    expect(resolveModelPointerDown('select', 0, false, true)).toBe('placement')
  })

  it('keeps Visibility picking ahead of staged-placement commits', () => {
    expect(resolveModelPointerDown('select', 0, true, true)).toBe('pick-model')
    expect(resolveModelPointerDown('measure', 0, true, true)).toBe('pick-model')
  })
})
