import { describe, expect, it } from 'vitest'
import type { Footprint, Pose, TabletopModel } from '../../domain/types'
import { isModelPositionInsideBattlefield } from './battlefield'
import {
  circleIntersectsRectangle,
  circlesOverlap,
  closestPointsBetweenCircleAndPoint,
  closestPointsBetweenCircles,
} from './circles'
import {
  InvalidFootprintError,
  circleFootprintRadiusInches,
  closestPointsBetweenFootprints,
  closestPointsFromFootprintToPoint,
  createPolygonFootprint,
  createPose,
  footprintBounds,
  footprintContainsPoint,
  footprintExclusionOutline,
  footprintInsideBattlefield,
  footprintIntersectsRectangle,
  footprintOffsetOutline,
  footprintsOverlap,
  normalizeRotation,
  pointWithinFootprintOffset,
  sweepFootprintTranslationWithClearance,
  transformFootprintPoint,
  validateFootprint,
} from './footprints'

const circle: Footprint = { shape: 'circle', diameterMm: 25.4 }
const ellipse: Footprint = { shape: 'ellipse', widthMm: 50.8, heightMm: 25.4 }
const rectangle: Footprint = { shape: 'rectangle', widthMm: 50.8, heightMm: 25.4 }
const polygon = createPolygonFootprint([
  { x: -25.4, y: -12.7 },
  { x: 25.4, y: -12.7 },
  { x: 0, y: 25.4 },
])
const pose: Pose = { position: { x: 5, y: 5 }, rotation: 0 }

describe('generic footprint circle parity', () => {
  it('preserves radius, bounds, point containment, and rectangle intersection', () => {
    expect(circleFootprintRadiusInches(circle)).toBe(0.5)
    expect(footprintBounds(circle, pose)).toEqual({ left: 4.5, top: 4.5, right: 5.5, bottom: 5.5 })
    expect(footprintContainsPoint(circle, pose, { x: 5.5, y: 5 })).toBe(true)
    expect(footprintContainsPoint(circle, pose, { x: 5.6, y: 5 })).toBe(false)

    const box = { left: 5.4, top: 4.8, right: 6, bottom: 5.2 }
    expect(footprintIntersectsRectangle(circle, pose, box)).toBe(
      circleIntersectsRectangle(pose.position, 0.5, box),
    )
  })

  it('delegates closest points and overlap to the proven circle geometry', () => {
    const otherPose = createPose({ x: 8, y: 5 })
    expect(closestPointsBetweenFootprints(circle, pose, circle, otherPose)).toEqual(
      closestPointsBetweenCircles(pose.position, 0.5, otherPose.position, 0.5),
    )
    expect(closestPointsFromFootprintToPoint(circle, pose, { x: 7, y: 5 })).toEqual(
      closestPointsBetweenCircleAndPoint(pose.position, 0.5, { x: 7, y: 5 }),
    )
    expect(footprintsOverlap(circle, pose, circle, createPose({ x: 5.9, y: 5 }))).toBe(
      circlesOverlap(pose.position, 0.5, { x: 5.9, y: 5 }, 0.5),
    )
  })

  it('preserves circular battlefield containment at exact boundaries', () => {
    const battlefield = { width: 10, height: 8 }
    const model: TabletopModel = {
      id: 'model', unitId: 'unit', ownerId: 'player', position: { x: 0.5, y: 0.5 },
      rotation: 0, base: circle, canPassOverModels: false,
    }
    expect(footprintInsideBattlefield(circle, poseFor(model), battlefield)).toBe(
      isModelPositionInsideBattlefield(model.position, model, battlefield),
    )
    const outside = { ...model, position: { x: 0.49, y: 0.5 } }
    expect(footprintInsideBattlefield(circle, poseFor(outside), battlefield)).toBe(
      isModelPositionInsideBattlefield(outside.position, outside, battlefield),
    )
  })
})

describe('static non-circular footprint geometry', () => {
  it('sweeps to an exact requested edge clearance without tunnelling', () => {
    const contact = sweepFootprintTranslationWithClearance(
      rectangle,
      createPose({ x: 1, y: 5 }),
      { x: 10, y: 0 },
      ellipse,
      createPose({ x: 9, y: 5 }),
      3,
    )
    expect(contact).not.toBeNull()
    const acceptedPose = createPose({ x: 1 + 10 * contact!.fraction, y: 5 })
    expect(closestPointsBetweenFootprints(rectangle, acceptedPose, ellipse, createPose({ x: 9, y: 5 })).distance)
      .toBeCloseTo(3, 6)
  })

  it('computes exact rotated bounds for ellipses, rectangles, and polygons', () => {
    expect(footprintBounds(ellipse, createPose({ x: 5, y: 5 }, Math.PI / 2))).toEqual({
      left: 4.5, top: 4, right: 5.5, bottom: 6,
    })
    const rectangleBounds = footprintBounds(rectangle, createPose({ x: 5, y: 5 }, Math.PI / 4))
    const extent = 1.5 / Math.sqrt(2)
    expect(rectangleBounds.left).toBeCloseTo(5 - extent)
    expect(rectangleBounds.top).toBeCloseTo(5 - extent)
    expect(rectangleBounds.right).toBeCloseTo(5 + extent)
    expect(rectangleBounds.bottom).toBeCloseTo(5 + extent)
    expect(footprintBounds(polygon, pose)).toEqual({ left: 4, top: 4.5, right: 6, bottom: 6 })
  })

  it.each([
    ['ellipse', ellipse],
    ['rectangle', rectangle],
    ['polygon', polygon],
  ] as const)('supports point containment and rectangle selection for %s', (_name, footprint) => {
    expect(footprintContainsPoint(footprint, pose, { x: 5, y: 5 })).toBe(true)
    expect(footprintContainsPoint(footprint, pose, { x: 8, y: 5 })).toBe(false)
    expect(footprintIntersectsRectangle(footprint, pose, {
      left: 4.9, top: 4.9, right: 5.1, bottom: 5.1,
    })).toBe(true)
    expect(footprintIntersectsRectangle(footprint, pose, {
      left: 8, top: 8, right: 9, bottom: 9,
    })).toBe(false)
  })

  it.each([
    ['circle/ellipse', circle, ellipse],
    ['circle/rectangle', circle, rectangle],
    ['ellipse/rectangle', ellipse, rectangle],
    ['rectangle/polygon', rectangle, polygon],
    ['polygon/circle', polygon, circle],
  ] as const)('returns symmetric closest distances for %s', (_name, first, second) => {
    const firstPose = createPose({ x: 2, y: 2 }, Math.PI / 6)
    const secondPose = createPose({ x: 7, y: 3 }, Math.PI / 4)
    const forward = closestPointsBetweenFootprints(first, firstPose, second, secondPose)
    const reverse = closestPointsBetweenFootprints(second, secondPose, first, firstPose)
    expect(forward.distance).toBeGreaterThan(0)
    expect(reverse.distance).toBeCloseTo(forward.distance, 8)
    expect(reverse.startAnchor.x).toBeCloseTo(forward.endAnchor.x, 8)
    expect(reverse.startAnchor.y).toBeCloseTo(forward.endAnchor.y, 8)
    expect(reverse.endAnchor.x).toBeCloseTo(forward.startAnchor.x, 8)
    expect(reverse.endAnchor.y).toBeCloseTo(forward.startAnchor.y, 8)
  })

  it('distinguishes exact tangency from strict overlap across shape families', () => {
    const unitCircle: Footprint = { shape: 'circle', diameterMm: 50.8 }
    expect(footprintsOverlap(rectangle, pose, unitCircle, createPose({ x: 7, y: 5 }))).toBe(false)
    expect(closestPointsBetweenFootprints(rectangle, pose, unitCircle, createPose({ x: 7, y: 5 })).distance)
      .toBeCloseTo(0)
    expect(footprintsOverlap(rectangle, pose, unitCircle, createPose({ x: 6.99, y: 5 }))).toBe(true)
  })

  it('uses rotated geometry for battlefield containment', () => {
    const battlefield = { width: 10, height: 10 }
    expect(footprintInsideBattlefield(rectangle, createPose({ x: 1, y: 1 }, 0), battlefield)).toBe(true)
    expect(footprintInsideBattlefield(rectangle, createPose({ x: 1, y: 1 }, Math.PI / 4), battlefield)).toBe(false)
  })
})

describe('derived footprint offset outlines', () => {
  it('samples a rotated rectangle range from the same geometry as exact membership', () => {
    const rotatedPose = createPose({ x: 5, y: 5 }, Math.PI / 4)
    const outline = footprintOffsetOutline(rectangle, rotatedPose, 2, 128)
    expect(outline).toHaveLength(128)
    for (const point of outline) {
      expect(closestPointsFromFootprintToPoint(rectangle, rotatedPose, point).distance).toBeCloseTo(2, 7)
      expect(pointWithinFootprintOffset(rectangle, rotatedPose, point, 2)).toBe(true)
    }
    expect(pointWithinFootprintOffset(rectangle, rotatedPose, { x: 5, y: 5 }, 2)).toBe(true)
    expect(pointWithinFootprintOffset(rectangle, rotatedPose, { x: 20, y: 20 }, 2)).toBe(false)
  })

  it('combines source, reflected rotated target, and separation for exclusion', () => {
    const sourcePose = createPose({ x: 4, y: 6 }, Math.PI / 4)
    const targetRotation = Math.PI / 2
    const outline = footprintExclusionOutline(rectangle, sourcePose, ellipse, targetRotation, 1, 128)
    expect(outline).toHaveLength(128)
    for (const point of outline.filter((_, index) => index % 16 === 0)) {
      expect(closestPointsBetweenFootprints(
        rectangle,
        sourcePose,
        ellipse,
        createPose(point, targetRotation),
      ).distance).toBeCloseTo(1, 6)
    }
  })

  it('retains circle offset parity', () => {
    const outline = footprintOffsetOutline(circle, pose, 3, 64)
    expect(outline[0]).toEqual({ x: 8.5, y: 5 })
    expect(outline[16].x).toBeCloseTo(5)
    expect(outline[16].y).toBeCloseTo(8.5)
  })
})

describe('polygon contract and footprint data', () => {
  it('canonicalizes winding and removes a duplicate closing vertex at construction', () => {
    const footprint = createPolygonFootprint([
      { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 },
    ])
    expect(footprint.verticesMm).toEqual([{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 0 }])
    expect(() => validateFootprint(footprint)).not.toThrow()
  })

  it.each([
    [{ shape: 'polygon', verticesMm: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 'at least three'],
    [{ shape: 'polygon', verticesMm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 0 }] }, 'must not repeat'],
    [{ shape: 'polygon', verticesMm: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 0, y: 10 }] }, 'must be finite'],
    [{ shape: 'polygon', verticesMm: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] }, 'non-zero'],
    [{ shape: 'polygon', verticesMm: [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }] }, 'Self-intersecting'],
    [{ shape: 'polygon', verticesMm: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, 'Concave'],
  ] as const)('rejects invalid polygon data %#', (footprint, message) => {
    expect(() => validateFootprint(footprint as unknown as Footprint)).toThrowError(message)
  })

  it('keeps footprint and pose values structured-clone and JSON safe', () => {
    const footprints: Footprint[] = [circle, ellipse, rectangle, polygon]
    const value = { footprints, pose: createPose({ x: 3, y: 4 }, -Math.PI / 2) }
    expect(structuredClone(value)).toEqual(value)
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  })

  it('normalizes radians and follows the clockwise +Y-down convention', () => {
    expect(normalizeRotation(Math.PI * 2)).toBe(0)
    expect(normalizeRotation(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5)
    expect(createPose({ x: 2, y: 3 }, Math.PI * 5).rotation).toBeCloseTo(Math.PI)
    expect(transformFootprintPoint(createPose({ x: 2, y: 3 }, Math.PI / 2), { x: 1, y: 0 }))
      .toEqual({ x: 2, y: 4 })
  })

  it('rejects non-canonical serialized polygon winding explicitly', () => {
    expect(() => validateFootprint({
      shape: 'polygon',
      verticesMm: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }],
    })).toThrow(InvalidFootprintError)
  })
})

function poseFor(model: Pick<TabletopModel, 'position' | 'rotation'>): Pose {
  return { position: model.position, rotation: model.rotation }
}
