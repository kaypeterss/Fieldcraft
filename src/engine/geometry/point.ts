export interface Point {
  x: number
  y: number
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
