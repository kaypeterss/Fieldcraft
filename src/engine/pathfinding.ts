import type { Battlefield, BattlefieldFeature, MovementPolicyConfig, TabletopModel, TerrainPolicyConfig } from '../domain/types'
import { isModelPositionInsideBattlefield } from './geometry/battlefield'
import { circlesOverlap, firstCirclePathCollisionT } from './geometry/circles'
import {
  footprintBounds,
  footprintCircumradiusInches,
  footprintExclusionOutline,
  footprintsOverlap,
  poseForModel,
  sweepFootprintTranslation,
} from './geometry/footprints'
import { distanceBetween, type Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { calculatePathMovementCost, DEFAULT_MOVEMENT_POLICY, isPathCostPolicy } from './movementCost'
import { baseRadiusInches } from './spatial'
import { terrainObstacleModels } from './terrainPolicy'

export interface ModelPathRequest {
  model: TabletopModel
  destination: Point
  obstacles: ReadonlyArray<TabletopModel>
  battlefield: Battlefield
  terrainFeatures?: ReadonlyArray<BattlefieldFeature>
  terrainPolicy?: TerrainPolicyConfig
  /** Optional reachability policy. With an allowance, omission uses the engine default policy. */
  movementPolicy?: MovementPolicyConfig
  movementAllowance?: number
}

export interface ModelPathResult {
  path: Point[]
  /** Actual center-path length, independent of the selected movement policy. */
  distance: number
}

interface CachedVisibilityGraph {
  nodes: Point[]
  adjacency: Array<Array<{ index: number; distance: number }>>
}

export interface ModelPathPlanner {
  visibilityGraphs: Map<string, CachedVisibilityGraph>
}

export function createModelPathPlanner(): ModelPathPlanner {
  return { visibilityGraphs: new Map() }
}

export function findDirectModelPath(request: ModelPathRequest): ModelPathResult | null {
  const start = request.model.position
  const destination = request.destination
  const obstacles = traversalObstacles(request)
  const finishObstacles = destinationObstacles(request)
  const useCircleFastPath = allCircleGeometry(request.model, [...obstacles, ...finishObstacles])
  const destinationIsLegal = useCircleFastPath
    ? circlePlacementIsLegal(request.model, destination, finishObstacles, request.battlefield)
    : placementIsLegal(request.model, destination, finishObstacles, request.battlefield)
  if (!destinationIsLegal) return null
  const distance = distanceBetween(start, destination)
  const result = distance <= GEOMETRY_EPSILON
    ? { path: [{ ...start }], distance: 0 }
    : { path: [{ ...start }, { ...destination }], distance }
  if (distance > GEOMETRY_EPSILON
    && !(useCircleFastPath
      ? circleSegmentIsClear(start, destination, baseRadiusInches(request.model.base), obstacles)
      : segmentIsClearForModel(request.model, start, destination, obstacles))) return null
  return isFixedOrientationPathWithinPolicy(request, result) ? result : null
}

const CIRCLE_WAYPOINTS_PER_OBSTACLE = 12
const GENERIC_WAYPOINTS_PER_OBSTACLE = 20
const MAX_GENERIC_ROUTING_OBSTACLES = 12
const MAX_GENERIC_NEAREST_NEIGHBORS = 12
const CIRCLE_PATH_CLEARANCE = GEOMETRY_EPSILON * 16
const GENERIC_PATH_CLEARANCE = 1e-6

/**
 * Deterministic bounded fixed-orientation footprint pathfinding. Direct paths
 * are preferred. All-circle requests retain the established analytic planner;
 * other requests use configuration-space waypoint candidates and validate
 * every graph edge with exact footprint translation sweeps.
 */
export function findModelPath(
  request: ModelPathRequest,
  planner?: ModelPathPlanner,
  directPathAlreadyChecked = false,
): ModelPathResult | null {
  const direct = directPathAlreadyChecked ? null : findDirectModelPath(request)
  if (direct) return direct

  const obstacles = traversalObstacles(request)
  if (obstacles.length === 0) return null
  const finishObstacles = destinationObstacles(request)
  if (allCircleGeometry(request.model, obstacles)) {
    return findCircularRoutedPath(request, obstacles, finishObstacles, planner)
  }
  return findGenericRoutedPath(request, obstacles, finishObstacles, planner)
}

/** Applies existing policy semantics without changing the returned path distance. */
export function isFixedOrientationPathWithinPolicy(
  request: Pick<ModelPathRequest, 'model' | 'movementPolicy' | 'movementAllowance'>,
  result: ModelPathResult,
): boolean {
  const allowance = request.movementAllowance
  if (allowance === undefined) return true
  if (!Number.isFinite(allowance) || allowance < 0) return false
  const policy = request.movementPolicy ?? DEFAULT_MOVEMENT_POLICY
  if (policy.type === 'movement-envelope') {
    // At fixed orientation, the legal center region is exactly the allowance
    // disk around the starting center. Its convexity makes endpoint checks
    // sufficient for every straight path segment.
    return result.path.every((point) => distanceBetween(request.model.position, point)
      <= allowance + GEOMETRY_EPSILON)
  }
  return isPathCostPolicy(policy) && calculatePathMovementCost(policy, {
    translationDistance: result.distance,
    angularDistance: 0,
  }).totalCost <= allowance + GEOMETRY_EPSILON
}

function findCircularRoutedPath(
  request: ModelPathRequest,
  obstacles: ReadonlyArray<TabletopModel>,
  finishObstacles: ReadonlyArray<TabletopModel>,
  planner?: ModelPathPlanner,
): ModelPathResult | null {
  const start = request.model.position
  const destination = request.destination
  const modelRadius = baseRadiusInches(request.model.base)
  const directBlockers = obstacles.filter((obstacle) => firstCirclePathCollisionT(
    start,
    destination,
    obstacle.position,
    modelRadius + baseRadiusInches(obstacle.base),
  ) !== null)
  const graphKey = `circle:${directBlockers.map((obstacle) => obstacle.id).join('|')}`
  let baseGraph = planner?.visibilityGraphs.get(graphKey)
  if (!baseGraph) {
    const blockerCluster = connectedBlockerCluster(directBlockers, obstacles, modelRadius)
    const baseNodes: Point[] = [{ ...start }]
    for (const obstacle of directBlockers) {
      const expandedRadius = modelRadius + baseRadiusInches(obstacle.base)
      const waypointRadius = (expandedRadius + CIRCLE_PATH_CLEARANCE)
        / Math.cos(Math.PI / CIRCLE_WAYPOINTS_PER_OBSTACLE)
      for (let index = 0; index < CIRCLE_WAYPOINTS_PER_OBSTACLE; index += 1) {
        const angle = index * Math.PI * 2 / CIRCLE_WAYPOINTS_PER_OBSTACLE
        const waypoint = {
          x: obstacle.position.x + Math.cos(angle) * waypointRadius,
          y: obstacle.position.y + Math.sin(angle) * waypointRadius,
        }
        if (isModelPositionInsideBattlefield(waypoint, request.model, request.battlefield)) baseNodes.push(waypoint)
      }
    }
    if (blockerCluster.length > 1) baseNodes.push(...circleClusterEnvelopeWaypoints(
      blockerCluster, modelRadius, request.model, request.battlefield,
    ))
    baseGraph = buildVisibilityGraph(baseNodes, (startPoint, endPoint) =>
      circleSegmentIsClear(startPoint, endPoint, modelRadius, obstacles))
    planner?.visibilityGraphs.set(graphKey, baseGraph)
  }
  return routeToDestination(request, finishObstacles, baseGraph, (startPoint, endPoint) =>
    circleSegmentIsClear(startPoint, endPoint, modelRadius, obstacles))
}

function findGenericRoutedPath(
  request: ModelPathRequest,
  obstacles: ReadonlyArray<TabletopModel>,
  finishObstacles: ReadonlyArray<TabletopModel>,
  planner?: ModelPathPlanner,
): ModelPathResult | null {
  const directBlockers = obstacles.filter((obstacle) => segmentContactsObstacle(
    request.model,
    request.model.position,
    request.destination,
    obstacle,
  ))
  if (directBlockers.length === 0) return null

  const cluster = connectedBlockerCluster(
    directBlockers,
    obstacles,
    footprintCircumradiusInches(request.model.base),
  )
  const directlyBlockingIds = new Set(directBlockers.map((obstacle) => obstacle.id))
  const routingObstacles = [
    ...directBlockers,
    ...cluster.filter((obstacle) => !directlyBlockingIds.has(obstacle.id)),
  ].slice(0, MAX_GENERIC_ROUTING_OBSTACLES)
  // Every obstacle participates in authoritative edge validation, so every
  // obstacle pose belongs in the cache identity even when bounded waypoint
  // generation only samples the relevant blocker cluster.
  const graphKey = genericGraphKey(request.model, [...obstacles, ...finishObstacles], request.battlefield)
  const segmentIsClear = createGenericSegmentClearer(request.model, obstacles)
  let baseGraph = planner?.visibilityGraphs.get(graphKey)
  if (!baseGraph) {
    const baseNodes: Point[] = [{ ...request.model.position }]
    for (const obstacle of routingObstacles) {
      baseNodes.push(...configurationSpaceWaypoints(request.model, obstacle)
        .filter((point) => placementIsLegal(request.model, point, finishObstacles, request.battlefield)))
    }
    if (cluster.length > 1) baseNodes.push(...genericClusterEnvelopeWaypoints(
      request.model,
      cluster,
      finishObstacles,
      request.battlefield,
    ))
    const uniqueNodes = deduplicatePoints(baseNodes)
    baseGraph = buildBoundedVisibilityGraph(uniqueNodes, MAX_GENERIC_NEAREST_NEIGHBORS, segmentIsClear)
    planner?.visibilityGraphs.set(graphKey, baseGraph)
  }
  return routeToDestination(request, finishObstacles, baseGraph, segmentIsClear)
}

function routeToDestination(
  request: ModelPathRequest,
  obstacles: ReadonlyArray<TabletopModel>,
  baseGraph: CachedVisibilityGraph,
  segmentIsClear: (start: Point, end: Point) => boolean,
): ModelPathResult | null {
  const destination = request.destination
  if (!placementIsLegal(request.model, destination, obstacles, request.battlefield)) return null
  const nodes: Point[] = [{ ...baseGraph.nodes[0] }, { ...destination }, ...baseGraph.nodes.slice(1)]
  const adjacency = nodes.map(() => [] as Array<{ index: number; distance: number }>)
  const mappedIndex = (baseIndex: number) => baseIndex === 0 ? 0 : baseIndex + 1
  for (let source = 0; source < baseGraph.adjacency.length; source += 1) {
    for (const edge of baseGraph.adjacency[source]) {
      adjacency[mappedIndex(source)].push({ index: mappedIndex(edge.index), distance: edge.distance })
    }
  }
  for (let baseIndex = 0; baseIndex < baseGraph.nodes.length; baseIndex += 1) {
    if (!segmentIsClear(baseGraph.nodes[baseIndex], destination)) continue
    const distance = distanceBetween(baseGraph.nodes[baseIndex], destination)
    const index = mappedIndex(baseIndex)
    adjacency[index].push({ index: 1, distance })
    adjacency[1].push({ index, distance })
  }
  const result = shortestAllowedPath(request, nodes, adjacency)
  return result && isFixedOrientationPathWithinPolicy(request, result) ? result : null
}

function shortestAllowedPath(
  request: ModelPathRequest,
  nodes: ReadonlyArray<Point>,
  adjacency: ReadonlyArray<ReadonlyArray<{ index: number; distance: number }>>,
): ModelPathResult | null {
  const policy = request.movementPolicy ?? DEFAULT_MOVEMENT_POLICY
  const nodeAllowed = nodes.map((point) => policy.type !== 'movement-envelope'
    || request.movementAllowance === undefined
    || distanceBetween(request.model.position, point) <= request.movementAllowance + GEOMETRY_EPSILON)
  if (!nodeAllowed[0] || !nodeAllowed[1]) return null
  const distances = nodes.map(() => Number.POSITIVE_INFINITY)
  const previous = nodes.map(() => -1)
  const visited = nodes.map(() => false)
  distances[0] = 0
  const pathCostLimit = request.movementAllowance !== undefined
    && policy.type !== 'movement-envelope'
    ? request.movementAllowance + GEOMETRY_EPSILON
    : Number.POSITIVE_INFINITY

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let current = -1
    for (let index = 0; index < nodes.length; index += 1) {
      if (visited[index] || !nodeAllowed[index]) continue
      if (current === -1
        || distances[index] < distances[current] - GEOMETRY_EPSILON
        || (Math.abs(distances[index] - distances[current]) <= GEOMETRY_EPSILON && index < current)) current = index
    }
    if (current === -1 || !Number.isFinite(distances[current]) || distances[current] > pathCostLimit) break
    if (current === 1) break
    visited[current] = true
    for (const edge of adjacency[current]) {
      if (!nodeAllowed[edge.index]) continue
      const nextDistance = distances[current] + edge.distance
      if (nextDistance <= pathCostLimit
        && nextDistance < distances[edge.index] - GEOMETRY_EPSILON) {
        distances[edge.index] = nextDistance
        previous[edge.index] = current
      }
    }
  }

  if (!Number.isFinite(distances[1])) return null
  const indexes: number[] = []
  for (let current = 1; current !== -1; current = previous[current]) indexes.push(current)
  indexes.reverse()
  return { path: indexes.map((index) => ({ ...nodes[index] })), distance: distances[1] }
}

function buildVisibilityGraph(
  nodes: ReadonlyArray<Point>,
  segmentIsClear: (start: Point, end: Point) => boolean,
): CachedVisibilityGraph {
  const adjacency = nodes.map(() => [] as Array<{ index: number; distance: number }>)
  for (let source = 0; source < nodes.length; source += 1) {
    for (let target = source + 1; target < nodes.length; target += 1) {
      if (!segmentIsClear(nodes[source], nodes[target])) continue
      const distance = distanceBetween(nodes[source], nodes[target])
      adjacency[source].push({ index: target, distance })
      adjacency[target].push({ index: source, distance })
    }
  }
  return { nodes: nodes.map((point) => ({ ...point })), adjacency }
}

function buildBoundedVisibilityGraph(
  nodes: ReadonlyArray<Point>,
  nearestNeighborLimit: number,
  segmentIsClear: (start: Point, end: Point) => boolean,
): CachedVisibilityGraph {
  const adjacency = nodes.map(() => [] as Array<{ index: number; distance: number }>)
  const candidatePairs = new Set<string>()
  for (let source = 0; source < nodes.length; source += 1) {
    const nearest = nodes
      .map((point, index) => ({ index, distance: distanceBetween(nodes[source], point) }))
      .filter(({ index }) => index !== source)
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, nearestNeighborLimit)
    for (const { index: target } of nearest) {
      candidatePairs.add(source < target ? `${source}:${target}` : `${target}:${source}`)
    }
  }
  for (const pair of candidatePairs) {
    const [source, target] = pair.split(':').map(Number)
    if (!segmentIsClear(nodes[source], nodes[target])) continue
    const distance = distanceBetween(nodes[source], nodes[target])
    adjacency[source].push({ index: target, distance })
    adjacency[target].push({ index: source, distance })
  }
  return { nodes: nodes.map((point) => ({ ...point })), adjacency }
}

function configurationSpaceWaypoints(moving: TabletopModel, obstacle: TabletopModel): Point[] {
  const outline = footprintExclusionOutline(
    obstacle.base,
    poseForModel(obstacle),
    moving.base,
    moving.rotation,
    0,
    GENERIC_WAYPOINTS_PER_OBSTACLE,
  )
  // The facade returns exact support points. Intersect adjacent outward
  // support lines to form a circumscribed configuration-space polygon. Its
  // edges stay outside the true convex exclusion shape; accepted visibility
  // edges are still verified by exact continuous sweeps below.
  return outline.map((_point, index) => {
    const nextIndex = (index + 1) % outline.length
    const angle = index * Math.PI * 2 / GENERIC_WAYPOINTS_PER_OBSTACLE
    const nextAngle = nextIndex * Math.PI * 2 / GENERIC_WAYPOINTS_PER_OBSTACLE
    const normal = { x: Math.cos(angle), y: Math.sin(angle) }
    const nextNormal = { x: Math.cos(nextAngle), y: Math.sin(nextAngle) }
    const support = outline[index].x * normal.x + outline[index].y * normal.y
      + GENERIC_PATH_CLEARANCE
    const nextSupport = outline[nextIndex].x * nextNormal.x + outline[nextIndex].y * nextNormal.y
      + GENERIC_PATH_CLEARANCE
    const determinant = normal.x * nextNormal.y - normal.y * nextNormal.x
    return {
      x: (support * nextNormal.y - normal.y * nextSupport) / determinant,
      y: (normal.x * nextSupport - support * nextNormal.x) / determinant,
    }
  })
}

function genericClusterEnvelopeWaypoints(
  moving: TabletopModel,
  cluster: ReadonlyArray<TabletopModel>,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): Point[] {
  const points = cluster.flatMap((obstacle) => configurationSpaceWaypoints(moving, obstacle))
  if (points.length === 0) return []
  const left = Math.min(...points.map((point) => point.x)) - GENERIC_PATH_CLEARANCE
  const right = Math.max(...points.map((point) => point.x)) + GENERIC_PATH_CLEARANCE
  const top = Math.min(...points.map((point) => point.y)) - GENERIC_PATH_CLEARANCE
  const bottom = Math.max(...points.map((point) => point.y)) + GENERIC_PATH_CLEARANCE
  return rectangleWaypoints(left, right, top, bottom)
    .filter((point) => placementIsLegal(moving, point, obstacles, battlefield))
}

function circleClusterEnvelopeWaypoints(
  obstacles: ReadonlyArray<TabletopModel>,
  movingRadius: number,
  model: TabletopModel,
  battlefield: Battlefield,
): Point[] {
  const padding = CIRCLE_PATH_CLEARANCE + movingRadius * 0.05
  const left = Math.min(...obstacles.map((obstacle) => obstacle.position.x - movingRadius - baseRadiusInches(obstacle.base))) - padding
  const right = Math.max(...obstacles.map((obstacle) => obstacle.position.x + movingRadius + baseRadiusInches(obstacle.base))) + padding
  const top = Math.min(...obstacles.map((obstacle) => obstacle.position.y - movingRadius - baseRadiusInches(obstacle.base))) - padding
  const bottom = Math.max(...obstacles.map((obstacle) => obstacle.position.y + movingRadius + baseRadiusInches(obstacle.base))) + padding
  return rectangleWaypoints(left, right, top, bottom)
    .filter((point) => isModelPositionInsideBattlefield(point, model, battlefield))
}

function rectangleWaypoints(left: number, right: number, top: number, bottom: number): Point[] {
  return [
    { x: left, y: top }, { x: (left + right) / 2, y: top }, { x: right, y: top },
    { x: right, y: (top + bottom) / 2 }, { x: right, y: bottom },
    { x: (left + right) / 2, y: bottom }, { x: left, y: bottom },
    { x: left, y: (top + bottom) / 2 },
  ]
}

function placementIsLegal(
  model: TabletopModel,
  position: Point,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): boolean {
  if (!isModelPositionInsideBattlefield(position, model, battlefield)) return false
  return obstacles.every((obstacle) => !footprintsOverlap(
    model.base,
    poseForModel(model, position),
    obstacle.base,
    poseForModel(obstacle),
  ))
}

function circlePlacementIsLegal(
  model: TabletopModel,
  position: Point,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): boolean {
  if (!isModelPositionInsideBattlefield(position, model, battlefield)) return false
  const radius = baseRadiusInches(model.base)
  return obstacles.every((obstacle) => !circlesOverlap(
    position,
    radius,
    obstacle.position,
    baseRadiusInches(obstacle.base),
  ))
}

function segmentIsClearForModel(
  model: TabletopModel,
  start: Point,
  end: Point,
  obstacles: ReadonlyArray<TabletopModel>,
): boolean {
  const translation = subtract(end, start)
  const movingPose = poseForModel(model, start)
  const startBounds = footprintBounds(model.base, movingPose)
  const endBounds = footprintBounds(model.base, poseForModel(model, end))
  return obstacles.every((obstacle) => {
    const obstaclePose = poseForModel(obstacle)
    if (!sweptBoundsIntersect(startBounds, endBounds, footprintBounds(obstacle.base, obstaclePose))) return true
    return sweepFootprintTranslation(
      model.base,
      movingPose,
      translation,
      obstacle.base,
      obstaclePose,
    ) === null
  })
}

/** Visibility edges share stationary poses and bounds, but still use exact sweeps. */
function createGenericSegmentClearer(model: TabletopModel, obstacles: ReadonlyArray<TabletopModel>) {
  const stationary = obstacles.map((obstacle) => {
    const pose = poseForModel(obstacle)
    return { obstacle, pose, bounds: footprintBounds(obstacle.base, pose) }
  })
  return (start: Point, end: Point): boolean => {
    const movingPose = poseForModel(model, start)
    const startBounds = footprintBounds(model.base, movingPose)
    const endBounds = footprintBounds(model.base, poseForModel(model, end))
    const translation = subtract(end, start)
    return stationary.every(({ obstacle, pose, bounds }) =>
      !sweptBoundsIntersect(startBounds, endBounds, bounds)
      || sweepFootprintTranslation(model.base, movingPose, translation,
        obstacle.base, pose) === null)
  }
}

function segmentContactsObstacle(
  model: TabletopModel,
  start: Point,
  end: Point,
  obstacle: TabletopModel,
): boolean {
  if (!sweptBoundsCouldIntersect(model, start, end, obstacle)) return false
  return sweepFootprintTranslation(
    model.base,
    poseForModel(model, start),
    subtract(end, start),
    obstacle.base,
    poseForModel(obstacle),
  ) !== null
}

function sweptBoundsCouldIntersect(
  model: TabletopModel,
  start: Point,
  end: Point,
  obstacle: TabletopModel,
): boolean {
  const startBounds = footprintBounds(model.base, poseForModel(model, start))
  const endBounds = footprintBounds(model.base, poseForModel(model, end))
  const obstacleBounds = footprintBounds(obstacle.base, poseForModel(obstacle))
  return sweptBoundsIntersect(startBounds, endBounds, obstacleBounds)
}

function sweptBoundsIntersect(
  startBounds: ReturnType<typeof footprintBounds>,
  endBounds: ReturnType<typeof footprintBounds>,
  obstacleBounds: ReturnType<typeof footprintBounds>,
): boolean {
  return Math.min(startBounds.left, endBounds.left) <= obstacleBounds.right + GEOMETRY_EPSILON
    && Math.max(startBounds.right, endBounds.right) >= obstacleBounds.left - GEOMETRY_EPSILON
    && Math.min(startBounds.top, endBounds.top) <= obstacleBounds.bottom + GEOMETRY_EPSILON
    && Math.max(startBounds.bottom, endBounds.bottom) >= obstacleBounds.top - GEOMETRY_EPSILON
}

function circleSegmentIsClear(
  start: Point,
  end: Point,
  modelRadius: number,
  obstacles: ReadonlyArray<TabletopModel>,
): boolean {
  return obstacles.every((obstacle) => firstCirclePathCollisionT(
    start,
    end,
    obstacle.position,
    modelRadius + baseRadiusInches(obstacle.base),
  ) === null)
}

function connectedBlockerCluster(
  seeds: ReadonlyArray<TabletopModel>,
  obstacles: ReadonlyArray<TabletopModel>,
  movingRadius: number,
): TabletopModel[] {
  const connected = new Map(seeds.map((obstacle) => [obstacle.id, obstacle]))
  let changed = true
  while (changed) {
    changed = false
    for (const obstacle of obstacles) {
      if (connected.has(obstacle.id)) continue
      const obstacleRadius = movingRadius + footprintCircumradiusInches(obstacle.base)
      const nearCluster = [...connected.values()].some((member) => {
        const memberRadius = movingRadius + footprintCircumradiusInches(member.base)
        const groupingGap = Math.min(
          movingRadius,
          footprintCircumradiusInches(obstacle.base),
          footprintCircumradiusInches(member.base),
        ) * 0.25
        return distanceBetween(obstacle.position, member.position)
          <= obstacleRadius + memberRadius + groupingGap
      })
      if (nearCluster) {
        connected.set(obstacle.id, obstacle)
        changed = true
      }
    }
  }
  return [...connected.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function sortedObstacles(request: ModelPathRequest): TabletopModel[] {
  return [...request.obstacles]
    .filter((obstacle) => obstacle.id !== request.model.id)
    .sort((a, b) => a.id.localeCompare(b.id))
}

function traversalObstacles(request: ModelPathRequest): TabletopModel[] {
  return [
    ...(request.model.canPassOverModels ? [] : sortedObstacles(request)),
    ...terrainObstacleModels(request.model, request.terrainFeatures, request.terrainPolicy, 'cross'),
  ]
}

function destinationObstacles(request: ModelPathRequest): TabletopModel[] {
  return [
    ...sortedObstacles(request),
    ...terrainObstacleModels(request.model, request.terrainFeatures, request.terrainPolicy, 'finish'),
  ]
}

function allCircleGeometry(model: TabletopModel, obstacles: ReadonlyArray<TabletopModel>): boolean {
  return model.base.shape === 'circle' && obstacles.every((obstacle) => obstacle.base.shape === 'circle')
}

function genericGraphKey(
  model: TabletopModel,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): string {
  return `generic:${JSON.stringify({
    movingFootprint: model.base,
    rotation: model.rotation,
    start: model.position,
    battlefield,
    obstacles: obstacles.map((obstacle) => ({
      id: obstacle.id,
      footprint: obstacle.base,
      position: obstacle.position,
      rotation: obstacle.rotation,
    })),
  })}`
}

function deduplicatePoints(points: ReadonlyArray<Point>): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (!result.some((candidate) => distanceBetween(candidate, point) <= GENERIC_PATH_CLEARANCE * 0.5)) {
      result.push({ ...point })
    }
  }
  return result
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}
