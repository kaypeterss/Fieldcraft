import type { Battlefield, TabletopModel } from '../domain/types'
import { firstCirclePathCollisionT, isGroupPlacementValid } from './geometry/circles'
import { distanceBetween, type Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { millimetersToInches } from './units'

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
}

interface ObstacleContact {
  movingModel: TabletopModel
  obstacle: TabletopModel
  fraction: number
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
  const { allModels, battlefield, remainingMovement } = request
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
    const obstacleContacts = obstacleContactCandidates(
      movingModels,
      movingIds,
      currentOffset,
      permittedVector,
      allModels,
    )
    const contactFraction = Math.min(
      boundaryContacts[0]?.fraction ?? 1,
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
      ...obstacleContacts
        .filter((contact) => Math.abs(contact.fraction - contactFraction) <= tolerance)
        .map((contact) => normalized(subtract(
          add(contact.movingModel.position, currentOffset),
          contact.obstacle.position,
        ))),
    ]
    remainingVector = projectOntoContactConstraints(untravelled, normals)
  }

  currentOffset = snapBoundaryOffset(movingModels, currentOffset, battlefield)
  let positions = positionsAtOffset(movingModels, currentOffset)
  if (!isGroupPlacementValid(allModels, positions) || !isFormationInsideBattlefield(movingModels, positions, battlefield)) {
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

function obstacleContactCandidates(
  movingModels: ReadonlyArray<TabletopModel>,
  movingIds: ReadonlySet<string>,
  currentOffset: Point,
  translation: Point,
  allModels: ReadonlyArray<TabletopModel>,
): ObstacleContact[] {
  const candidates: ObstacleContact[] = []

  for (const movingModel of movingModels) {
    const radius = radiusInches(movingModel)
    const start = add(movingModel.position, currentOffset)
    const end = add(start, translation)

    for (const obstacle of allModels) {
      if (movingIds.has(obstacle.id)) continue
      const obstacleRadius = radiusInches(obstacle)
      if (movingModel.canPassOverModels && !circlesOverlapAt(end, radius, obstacle.position, obstacleRadius)) continue

      const fraction = firstCirclePathCollisionT(start, end, obstacle.position, radius + obstacleRadius)
      if (fraction === null) continue
      candidates.push({ movingModel, obstacle, fraction })
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
    const start = add(model.position, currentOffset)
    const end = add(start, translation)
    const radius = radiusInches(model)
    const left = battlefieldLeftContact(start.x, end.x, radius)
    const right = battlefieldRightContact(start.x, end.x, radius, battlefield.width)
    const top = battlefieldLeftContact(start.y, end.y, radius)
    const bottom = battlefieldRightContact(start.y, end.y, radius, battlefield.height)
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

function radiusInches(model: TabletopModel): number {
  return millimetersToInches(model.base.diameterMm) / 2
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

function battlefieldLeftContact(start: number, end: number, radius: number): number | null {
  if (end >= radius || end >= start) return start <= radius + GEOMETRY_EPSILON && end < start ? 0 : null
  return Math.max(0, Math.min(1, (radius - start) / (end - start)))
}

function battlefieldRightContact(start: number, end: number, radius: number, extent: number): number | null {
  const limit = extent - radius
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
    const radius = radiusInches(model)
    const center = add(model.position, offset)
    if (center.x < radius && center.x >= radius - GEOMETRY_EPSILON) correctionX = Math.max(correctionX, radius - center.x)
    if (center.x > battlefield.width - radius && center.x <= battlefield.width - radius + GEOMETRY_EPSILON) correctionX = Math.min(correctionX, battlefield.width - radius - center.x)
    if (center.y < radius && center.y >= radius - GEOMETRY_EPSILON) correctionY = Math.max(correctionY, radius - center.y)
    if (center.y > battlefield.height - radius && center.y <= battlefield.height - radius + GEOMETRY_EPSILON) correctionY = Math.min(correctionY, battlefield.height - radius - center.y)
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
    const radius = radiusInches(model)
    return position.x >= radius - GEOMETRY_EPSILON
      && position.x <= battlefield.width - radius + GEOMETRY_EPSILON
      && position.y >= radius - GEOMETRY_EPSILON
      && position.y <= battlefield.height - radius + GEOMETRY_EPSILON
  })
}

function circlesOverlapAt(centerA: Point, radiusA: number, centerB: Point, radiusB: number): boolean {
  return distanceBetween(centerA, centerB) < radiusA + radiusB - GEOMETRY_EPSILON
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
