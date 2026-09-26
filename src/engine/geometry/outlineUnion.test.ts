import { describe, expect, it } from 'vitest'
import { exteriorUnionOutlines, unionOutlinePolygons } from './outlineUnion'

function square(x: number, y: number, size: number) {
  return [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }]
}
function rectangle(left: number, top: number, right: number, bottom: number) {
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
}

describe('sampled footprint offset union frontier', () => {
  it('removes internal overlap arcs while preserving a concave exterior', () => {
    const loops = unionOutlinePolygons([square(0, 0, 2), square(1, 1, 2)])
    expect(loops).toHaveLength(1)
    expect(loops[0]).toContainEqual({ x: 2, y: 1 })
    expect(loops[0]).toContainEqual({ x: 1, y: 2 })
    expect(loops[0]).not.toContainEqual({ x: 2, y: 2 })
  })

  it('keeps disconnected frontiers separate', () => {
    expect(unionOutlinePolygons([square(0, 0, 1), square(3, 0, 1)])).toHaveLength(2)
    expect(exteriorUnionOutlines([square(0, 0, 1), square(3, 0, 1)])).toHaveLength(2)
  })

  it('omits a nested hole contour without filling or connecting disconnected exteriors', () => {
    const ring = [rectangle(0, 0, 4, 1), rectangle(3, 0, 4, 4),
      rectangle(0, 3, 4, 4), rectangle(0, 0, 1, 4)]
    expect(unionOutlinePolygons(ring)).toHaveLength(2)
    expect(exteriorUnionOutlines(ring)).toHaveLength(1)
  })
})
