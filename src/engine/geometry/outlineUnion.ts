import type { Point } from './point'

const EPSILON = 1e-7
type Edge = { start: Point; end: Point }

function cross(a: Point, b: Point): number { return a.x * b.y - a.y * b.x }
function subtract(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y } }
function interpolate(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
function near(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5
}
function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous]
    const b = polygon[index]
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The visible boundary of a union of sampled footprint offsets. No hull or bounding-box substitute. */
export function unionOutlinePolygons(polygons: readonly (readonly Point[])[]): Point[][] {
  const valid = polygons.filter((polygon) => polygon.length >= 3)
  const bounds = valid.map((polygon) => ({
    minX: Math.min(...polygon.map((point) => point.x)), maxX: Math.max(...polygon.map((point) => point.x)),
    minY: Math.min(...polygon.map((point) => point.y)), maxY: Math.max(...polygon.map((point) => point.y)),
  }))
  const contains = (point: Point) => valid.some((candidate, index) =>
    point.x >= bounds[index].minX && point.x <= bounds[index].maxX
    && point.y >= bounds[index].minY && point.y <= bounds[index].maxY
    && pointInPolygon(point, candidate))
  const boundary: Edge[] = []
  for (let shape = 0; shape < valid.length; shape += 1) {
    const polygon = valid[shape]
    for (let edge = 0; edge < polygon.length; edge += 1) {
      const start = polygon[edge]
      const end = polygon[(edge + 1) % polygon.length]
      const direction = subtract(end, start)
      const cuts = [0, 1]
      for (let other = 0; other < valid.length; other += 1) {
        if (other === shape) continue
        if (bounds[shape].maxX < bounds[other].minX || bounds[other].maxX < bounds[shape].minX
          || bounds[shape].maxY < bounds[other].minY || bounds[other].maxY < bounds[shape].minY) continue
        const candidate = valid[other]
        for (let index = 0; index < candidate.length; index += 1) {
          const otherStart = candidate[index]
          const otherDirection = subtract(candidate[(index + 1) % candidate.length], otherStart)
          const denominator = cross(direction, otherDirection)
          const offset = subtract(otherStart, start)
          if (Math.abs(denominator) < EPSILON) {
            if (Math.abs(cross(offset, direction)) < EPSILON) {
              const lengthSquared = direction.x * direction.x + direction.y * direction.y
              if (lengthSquared > EPSILON) {
                for (const endpoint of [otherStart, candidate[(index + 1) % candidate.length]]) {
                  const relative = subtract(endpoint, start)
                  const t = (relative.x * direction.x + relative.y * direction.y) / lengthSquared
                  if (t > EPSILON && t < 1 - EPSILON) cuts.push(t)
                }
              }
            }
            continue
          }
          const t = cross(offset, otherDirection) / denominator
          const u = cross(offset, direction) / denominator
          if (t > EPSILON && t < 1 - EPSILON && u >= -EPSILON && u <= 1 + EPSILON) cuts.push(t)
        }
      }
      cuts.sort((a, b) => a - b)
      for (let index = 1; index < cuts.length; index += 1) {
        const from = interpolate(start, end, cuts[index - 1])
        const to = interpolate(start, end, cuts[index])
        if (near(from, to)) continue
        const midpoint = interpolate(from, to, 0.5)
        const length = Math.hypot(to.x - from.x, to.y - from.y)
        const normal = { x: -(to.y - from.y) / length * 1e-5, y: (to.x - from.x) / length * 1e-5 }
        const leftInside = contains({ x: midpoint.x + normal.x, y: midpoint.y + normal.y })
        const rightInside = contains({ x: midpoint.x - normal.x, y: midpoint.y - normal.y })
        if (leftInside === rightInside) continue
        const candidate = leftInside ? { start: from, end: to } : { start: to, end: from }
        if (!boundary.some((entry) => near(entry.start, candidate.start) && near(entry.end, candidate.end))) boundary.push(candidate)
      }
    }
  }
  const loops: Point[][] = []
  while (boundary.length) {
    const first = boundary.pop()!
    const loop = [first.start, first.end]
    while (!near(loop[loop.length - 1], loop[0])) {
      const next = boundary.findIndex((edge) => near(edge.start, loop[loop.length - 1]))
      if (next < 0) break
      loop.push(boundary.splice(next, 1)[0].end)
    }
    if (near(loop[loop.length - 1], loop[0])) loop.pop()
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** Omit interior holes/contours for a deliberately uncluttered exterior-only range display. */
export function exteriorUnionOutlines(polygons: readonly (readonly Point[])[]): Point[][] {
  const loops = unionOutlinePolygons(polygons)
  return loops.filter((loop, index) => loops.reduce((depth, candidate, other) =>
    depth + (other !== index && pointInPolygon(loop[0], candidate) ? 1 : 0), 0) % 2 === 0)
}
