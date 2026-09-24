import { describe, expect, it } from 'vitest'
import { minimumDistanceBoundary } from './placement'

describe('deployment distance presentation geometry', () => {
  it('rounds polygon corners instead of using an axis-aligned offset', () => {
    const [boundary] = minimumDistanceBoundary([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]], 2)
    expect(boundary.length).toBeGreaterThan(4)
    const corner = boundary.find((point) => point.x > 10 && point.y < 0)
    expect(corner).toBeDefined()
    expect(Math.hypot(corner!.x - 10, corner!.y)).toBeCloseTo(2, 6)
  })

  it('preserves compound boundaries for multiple authored areas', () => {
    const boundaries = minimumDistanceBoundary([
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
      [{ x: 8, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 }, { x: 8, y: 4 }],
    ], 1)
    expect(boundaries).toHaveLength(2)
    expect(boundaries.every((boundary) => boundary.length > 4)).toBe(true)
  })
})
