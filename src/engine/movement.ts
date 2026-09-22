import type { Battlefield, Pose, TabletopModel } from '../domain/types'
import { firstCirclePathCollisionT } from './geometry/circles'
import {
  circleFootprintRadiusInches,
  footprintBounds,
  footprintInsideBattlefield,
  footprintsOverlap,
  poseForModel,
  sweepFootprintTranslation,
} from './geometry/footprints'
import { distanceBetween, type Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { poseFitsMovementEnvelope, sweepTranslationToMovementEnvelope } from './movementEnvelope'

export interface MovementResolution {
  positions: Map<string, Point>
  distances: Map<string, number>
  paths: Map<string, Point[]>
  /** Shared offsets from the start of this request, beginning at {0, 0}. */
  translationPath: Point[]
}

export interface RigidTranslationRequest {
  allModels: ReadonlyArray<TabletopModel>
  modelIds: ReadonlyArray<string>
  /** Shared translation requested from every participating model's current position. */
  translation: Point
  battlefield: Battlefield
  remainingMovement?: ReadonlyMap<string, number>
  movementEnvelopes?: ReadonlyMap<string, { startPose: Pose; allowance: number }>
}

interface ObstacleContact {
  movingModel: TabletopModel
  obstacle: TabletopModel
  fraction: number
  normal: Point
}

interface BoundaryContact {
  fraction: number
  normal: Point
  key: string
}

const MAX_SLIDE_ITERATIONS = 8

export function resolveRigidTranslation(request: RigidTranslationRequest): MovementResolution {
  const movingIds = new Set(request.modelIds)
  const movingModels = request.allModels.filter((model) => movingIds.has(model.id))
  if (movingModels.length === 0) {
    return {
      positions: new Map(),
      distances: new Map(),
      paths: new Map(),
      translationPath: [{ x: 0, y: 0 }],
    }
  }
  return resolveRigidTranslationForModels(request, movingModels, movingIds)
}

function resolveRigidTranslationForModels(
  request: RigidTranslationRequest,
  movingModels: ReadonlyArray<TabletopModel>,
  movingIds: ReadonlySet<string>,
): MovementResolution {
  const { allModels, battlefield, remainingMovement, movementEnvelopes } = request
  const requestedTranslation = request.translation
  const maximumDistance = Math.min(...movingModels.map((model) =>
    Math.max(0, remainingMovement?.get(model.id) ?? Number.POSITIVE_INFINITY)))
  const translationPath: Point[] = [{ x: 0, y: 0 }]
  let currentOffset = { x: 0, y: 0 }
  let remainingVector = { ...requestedTranslation }
  let distanceUsed = 0

  for (let iteration = 0; iteration < MAX_SLIDE_ITERATIONS; iteration += 1) {
    const allowanceRemaining = Math.max(0, maximumDistance - distanceUsed)
    const requestedLength = vectorLength(remainingVector)
    if (requestedLength <= GEOMETRY_EPSILON || allowanceRemaining <= GEOMETRY_EPSILON) break

    const permittedVector = scale(remainingVector, Math.min(1, allowanceRemaining / requestedLength))
    const boundaryContacts = boundaryContactCandidates(movingModels, currentOffset, permittedVector, battlefield)
    const envelopeContacts = envelopeContactCandidates(
      movingModels,
      currentOffset,
      permittedVector,
      movementEnvelopes,
    )
    const obstacleContacts = obstacleContactCandidates(
      movingModels,
      movingIds,
      currentOffset,
      permittedVector,
      allModels,
    )
    const contactFraction = Math.min(
      boundaryContacts[0]?.fraction ?? 1,
      envelopeContacts[0]?.fraction ?? 1,
      obstacleContacts[0]?.fraction ?? 1,
    )

    if (contactFraction >= 1) {
      const nextOffset = add(currentOffset, permittedVector)
      distanceUsed += appendTranslationSegment(translationPath, currentOffset, nextOffset)
      currentOffset = nextOffset
      break
    }

    const nextOffset = add(currentOffset, scale(permittedVector, contactFraction))
    distanceUsed += appendTranslationSegment(translationPath, currentOffset, nextOffset)
    currentOffset = nextOffset

    const untravelled = scale(permittedVector, 1 - contactFraction)
    const tolerance = fractionTolerance(permittedVector)
    const normals = [
      ...boundaryContacts
        .filter((contact) => Math.abs(contact.fraction - contactFraction) <= tolerance)
        .map((contact) => contact.normal),
      ...envelopeContacts
        .filter((contact) => Math.abs(contact.fraction - contactFraction) <= tolerance)
        .map((contact) => contact.normal),
      ...obstacleContacts
        .filter((contact) => Math.abs(contact.fraction - contactFraction) <= tolerance)
        .map((contact) => contact.normal),
    ]
    remainingVector = projectOntoContactConstraints(untravelled, normals)
  }

  currentOffset = snapBoundaryOffset(movingModels, currentOffset, battlefield)
  let positions = positionsAtOffset(movingModels, currentOffset)
  if (!isProposedPlacementValid(allModels, positions)
    || !isFormationInsideBattlefield(movingModels, positions, battlefield)
    || !isFormationInsideMovementEnvelopes(movingModels, positions, movementEnvelopes)) {
    currentOffset = { x: 0, y: 0 }
    distanceUsed = 0
    translationPath.splice(0, translationPath.length, { x: 0, y: 0 })
    positions = positionsAtOffset(movingModels, currentOffset)
  }

  const paths = new Map(movingModels.map((model) => [
    model.id,
    translationPath.map((offset) => add(model.position, offset)),
  ]))
  const distances = new Map(movingModels.map((model) => [model.id, distanceUsed]))
  return { positions, distances, paths, translationPath }
}

function envelopeContactCandidates(
  movingModels: ReadonlyArray<TabletopModel>,
  currentOffset: Point,
  translation: Point,
  envelopes: RigidTranslationRequest['movementEnvelopes'],
): BoundaryContact[] {
  if (!envelopes) return []
  const contacts: BoundaryContact[] = []
  for (const model of movingModels) {
    const envelope = envelopes.get(model.id)
    if (!envelope) continue
    const contact = sweepTranslationToMovementEnvelope(
      model.base,
      envelope.startPose,
      poseForModel(model, add(model.position, currentOffset)),
      translation,
      envelope.allowance,
    )
    if (contact) contacts.push({ ...contact, key: `${model.id}:movement-envelope` })
  }
  return contacts.sort((a, b) => a.fraction - b.fraction || a.key.localeCompare(b.key))
}

function obstacleContactCandidates(
  movingModels: ReadonlyArray<TabletopModel>,
  movingIds: ReadonlySet<string>,
  currentOffset: Point,
  translation: Point,
  allModels: ReadonlyArray<TabletopModel>,
): ObstacleContact[] {
  const candidates: ObstacleContact[] = []

  for (const movingModel of movingModels) {
    const start = add(movingModel.position, currentOffset)
    const end = add(start, translation)

    for (const obstacle of allModels) {
      if (movingIds.has(obstacle.id)) continue
      const destinationOverlaps = footprintsOverlap(
        movingModel.base,
        poseForModel(movingModel, end),
        obstacle.base,
        poseForModel(obstacle),
      )
      if (movingModel.canPassOverModels && !destinationOverlaps) continue

      if (movingModel.base.shape === 'circle' && obstacle.base.shape === 'circle') {
        const radius = circleFootprintRadiusInches(movingModel.base)
        const obstacleRadius = circleFootprintRadiusInches(obstacle.base)
        const fraction = firstCirclePathCollisionT(start, end, obstacle.position, radius + obstacleRadius)
        if (fraction === null) continue
        candidates.push({
          movingModel,
          obstacle,
          fraction,
          normal: normalized(subtract(add(start, scale(translation, fraction)), obstacle.position)),
        })
        continue
      }

      const contact = sweepFootprintTranslation(
        movingModel.base,
        poseForModel(movingModel, start),
        translation,
        obstacle.base,
        poseForModel(obstacle),
      )
      if (contact) candidates.push({ movingModel, obstacle, ...contact })
    }
  }

  return candidates
    .sort((a, b) => {
      const fractionOrder = a.fraction - b.fraction
      if (Math.abs(fractionOrder) > fractionTolerance(translation)) return fractionOrder
      const movingOrder = a.movingModel.id.localeCompare(b.movingModel.id)
      return movingOrder || a.obstacle.id.localeCompare(b.obstacle.id)
    })
}

function boundaryContactCandidates(
  movingModels: ReadonlyArray<TabletopModel>,
  currentOffset: Point,
  translation: Point,
  battlefield: Battlefield,
): BoundaryContact[] {
  const contacts: BoundaryContact[] = []
  for (const model of movingModels) {
    const startPosition = add(model.position, currentOffset)
    const bounds = footprintBounds(model.base, poseForModel(model, startPosition))
    const left = lowerBoundaryContact(bounds.left, bounds.left + translation.x, 0)
    const right = upperBoundaryContact(bounds.right, bounds.right + translation.x, battlefield.width)
    const top = lowerBoundaryContact(bounds.top, bounds.top + translation.y, 0)
    const bottom = upperBoundaryContact(bounds.bottom, bounds.bottom + translation.y, battlefield.height)
    if (left !== null) contacts.push({ fraction: left, normal: { x: 1, y: 0 }, key: `${model.id}:left` })
    if (right !== null) contacts.push({ fraction: right, normal: { x: -1, y: 0 }, key: `${model.id}:right` })
    if (top !== null) contacts.push({ fraction: top, normal: { x: 0, y: 1 }, key: `${model.id}:top` })
    if (bottom !== null) contacts.push({ fraction: bottom, normal: { x: 0, y: -1 }, key: `${model.id}:bottom` })
  }
  return contacts.sort((a, b) => a.fraction - b.fraction || a.key.localeCompare(b.key))
}

function projectOntoContactConstraints(vector: Point, normals: ReadonlyArray<Point>): Point {
  if (satisfiesContactConstraints(vector, normals)) return vector

  const candidates: Point[] = [{ x: 0, y: 0 }]
  for (const normal of normals) {
    const component = dot(vector, normal)
    const tangent = component < 0 ? subtract(vector, scale(normal, component)) : vector
    if (satisfiesContactConstraints(tangent, normals)) candidates.push(tangent)
  }

  return candidates.reduce((best, candidate) =>
    squaredDistance(candidate, vector) < squaredDistance(best, vector) ? candidate : best)
}

function satisfiesContactConstraints(vector: Point, normals: ReadonlyArray<Point>): boolean {
  return normals.every((normal) => dot(vector, normal) >= -GEOMETRY_EPSILON)
}

function positionsAtOffset(models: ReadonlyArray<TabletopModel>, offset: Point): Map<string, Point> {
  return new Map(models.map((model) => [model.id, add(model.position, offset)]))
}

function appendTranslationSegment(path: Point[], start: Point, end: Point): number {
  const length = distanceBetween(start, end)
  if (length > GEOMETRY_EPSILON) {
    const compact = appendAcceptedPathPoint(path, end)
    path.splice(0, path.length, ...compact)
  }
  return length
}

function fractionTolerance(translation: Point): number {
  return Math.min(1, GEOMETRY_EPSILON / Math.max(vectorLength(translation), GEOMETRY_EPSILON))
}

export function appendAcceptedPathPoint(path: ReadonlyArray<Point>, point: Point): Point[] {
  if (path.length === 0) return [{ ...point }]
  const last = path[path.length - 1]
  if (distanceBetween(last, point) <= GEOMETRY_EPSILON) return [...path]
  if (path.length < 2) return [...path, { ...point }]

  const previous = path[path.length - 2]
  const ax = last.x - previous.x
  const ay = last.y - previous.y
  const bx = point.x - last.x
  const by = point.y - last.y
  const cross = Math.abs(ax * by - ay * bx)
  const dotProduct = ax * bx + ay * by
  if (cross <= GEOMETRY_EPSILON && dotProduct >= 0) {
    return [...path.slice(0, -1), { ...point }]
  }
  return [...path, { ...point }]
}

function lowerBoundaryContact(start: number, end: number, limit: number): number | null {
  if (end >= limit || end >= start) return start <= limit + GEOMETRY_EPSILON && end < start ? 0 : null
  return Math.max(0, Math.min(1, (limit - start) / (end - start)))
}

function upperBoundaryContact(start: number, end: number, limit: number): number | null {
  if (end <= limit || end <= start) return start >= limit - GEOMETRY_EPSILON && end > start ? 0 : null
  return Math.max(0, Math.min(1, (limit - start) / (end - start)))
}

function snapBoundaryOffset(
  models: ReadonlyArray<TabletopModel>,
  offset: Point,
  battlefield: Battlefield,
): Point {
  let correctionX = 0
  let correctionY = 0
  for (const model of models) {
    const bounds = footprintBounds(model.base, poseForModel(model, add(model.position, offset)))
    if (bounds.left < 0 && bounds.left >= -GEOMETRY_EPSILON) correctionX = Math.max(correctionX, -bounds.left)
    if (bounds.right > battlefield.width && bounds.right <= battlefield.width + GEOMETRY_EPSILON) correctionX = Math.min(correctionX, battlefield.width - bounds.right)
    if (bounds.top < 0 && bounds.top >= -GEOMETRY_EPSILON) correctionY = Math.max(correctionY, -bounds.top)
    if (bounds.bottom > battlefield.height && bounds.bottom <= battlefield.height + GEOMETRY_EPSILON) correctionY = Math.min(correctionY, battlefield.height - bounds.bottom)
  }
  return { x: offset.x + correctionX, y: offset.y + correctionY }
}

function isFormationInsideBattlefield(
  models: ReadonlyArray<TabletopModel>,
  positions: ReadonlyMap<string, Point>,
  battlefield: Battlefield,
): boolean {
  return models.every((model) => {
    const position = positions.get(model.id) ?? model.position
    return footprintInsideBattlefield(model.base, poseForModel(model, position), battlefield)
  })
}

function isFormationInsideMovementEnvelopes(
  models: ReadonlyArray<TabletopModel>,
  positions: ReadonlyMap<string, Point>,
  envelopes: RigidTranslationRequest['movementEnvelopes'],
): boolean {
  if (!envelopes) return true
  return models.every((model) => {
    const envelope = envelopes.get(model.id)
    if (!envelope) return true
    return poseFitsMovementEnvelope(
      model.base,
      envelope.startPose,
      poseForModel(model, positions.get(model.id) ?? model.position),
      envelope.allowance,
    )
  })
}

function isProposedPlacementValid(
  allModels: ReadonlyArray<TabletopModel>,
  proposedPositions: ReadonlyMap<string, Point>,
): boolean {
  const movingIds = new Set(proposedPositions.keys())
  const movingModels = allModels.filter((model) => movingIds.has(model.id))
  for (const movingModel of movingModels) {
    const movingPosition = proposedPositions.get(movingModel.id) ?? movingModel.position
    for (const obstacle of allModels) {
      if (movingIds.has(obstacle.id)) continue
      if (footprintsOverlap(
        movingModel.base,
        poseForModel(movingModel, movingPosition),
        obstacle.base,
        poseForModel(obstacle),
      )) return false
    }
  }
  return true
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(vector: Point, factor: number): Point {
  return { x: vector.x * factor, y: vector.y * factor }
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function vectorLength(vector: Point): number {
  return Math.hypot(vector.x, vector.y)
}

function normalized(vector: Point): Point {
  const length = vectorLength(vector)
  return length <= GEOMETRY_EPSILON ? { x: 0, y: 0 } : scale(vector, 1 / length)
}
