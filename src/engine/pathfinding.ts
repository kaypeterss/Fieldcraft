import type { Battlefield, TabletopModel } from '../domain/types'
import { isModelPositionInsideBattlefield } from './geometry/battlefield'
import { circlesOverlap, firstCirclePathCollisionT } from './geometry/circles'
import { distanceBetween, type Point } from './geometry/point'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { baseRadiusInches } from './spatial'

export interface ModelPathRequest {
  model: TabletopModel
  destination: Point
  obstacles: ReadonlyArray<TabletopModel>
  battlefield: Battlefield
}

export interface ModelPathResult {
  path: Point[]
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
  if (!isModelPositionInsideBattlefield(destination, request.model, request.battlefield)) return null
  const modelRadius = baseRadiusInches(request.model.base)
  const obstacles = request.obstacles.filter((obstacle) => obstacle.id !== request.model.id)
  if (obstacles.some((obstacle) => circlesOverlap(
    destination,
    modelRadius,
    obstacle.position,
    baseRadiusInches(obstacle.base),
  ))) return null
  const distance = distanceBetween(start, destination)
  if (distance <= GEOMETRY_EPSILON) return { path: [{ ...start }], distance: 0 }
  if (!request.model.canPassOverModels && !segmentIsClear(start, destination, modelRadius, obstacles)) return null
  return { path: [{ ...start }, { ...destination }], distance }
}

const WAYPOINTS_PER_OBSTACLE = 12
const PATH_CLEARANCE = GEOMETRY_EPSILON * 16

/**
 * Finds a deterministic conservative path for one circular model. The direct
 * segment is preferred; otherwise a bounded visibility graph routes around
 * circular model blockers. Terrain is deliberately outside this V1 planner.
 */
export function findModelPath(request: ModelPathRequest, planner?: ModelPathPlanner): ModelPathResult | null {
  const start = request.model.position
  const destination = request.destination
  if (!isModelPositionInsideBattlefield(destination, request.model, request.battlefield)) return null

  const modelRadius = baseRadiusInches(request.model.base)
  const obstacles = [...request.obstacles]
    .filter((obstacle) => obstacle.id !== request.model.id)
    .sort((a, b) => a.id.localeCompare(b.id))

  if (obstacles.some((obstacle) => circlesOverlap(
    destination,
    modelRadius,
    obstacle.position,
    baseRadiusInches(obstacle.base),
  ))) return null

  if (distanceBetween(start, destination) <= GEOMETRY_EPSILON) {
    return { path: [{ ...start }], distance: 0 }
  }

  if (request.model.canPassOverModels || segmentIsClear(start, destination, modelRadius, obstacles)) {
    return { path: [{ ...start }, { ...destination }], distance: distanceBetween(start, destination) }
  }

  const directBlockers = obstacles.filter((obstacle) => firstCirclePathCollisionT(
    start,
    destination,
    obstacle.position,
    modelRadius + baseRadiusInches(obstacle.base),
  ) !== null)
  const graphKey = directBlockers.map((obstacle) => obstacle.id).join('|')
  let baseGraph = planner?.visibilityGraphs.get(graphKey)
  if (!baseGraph) {
    const blockerCluster = connectedBlockerCluster(directBlockers, obstacles, modelRadius)
    const baseNodes: Point[] = [{ ...start }]
    for (const obstacle of directBlockers) {
      const expandedRadius = modelRadius + baseRadiusInches(obstacle.base)
      const waypointRadius = (expandedRadius + PATH_CLEARANCE)
        / Math.cos(Math.PI / WAYPOINTS_PER_OBSTACLE)
      for (let index = 0; index < WAYPOINTS_PER_OBSTACLE; index += 1) {
        const angle = (index * Math.PI * 2) / WAYPOINTS_PER_OBSTACLE
        const waypoint = {
          x: obstacle.position.x + Math.cos(angle) * waypointRadius,
          y: obstacle.position.y + Math.sin(angle) * waypointRadius,
        }
        if (isModelPositionInsideBattlefield(waypoint, request.model, request.battlefield)) baseNodes.push(waypoint)
      }
    }
    if (blockerCluster.length > 1) {
      const envelope = blockerEnvelope(blockerCluster, modelRadius)
      const envelopeWaypoints: Point[] = [
        { x: envelope.left, y: envelope.top },
        { x: (envelope.left + envelope.right) / 2, y: envelope.top },
        { x: envelope.right, y: envelope.top },
        { x: envelope.right, y: (envelope.top + envelope.bottom) / 2 },
        { x: envelope.right, y: envelope.bottom },
        { x: (envelope.left + envelope.right) / 2, y: envelope.bottom },
        { x: envelope.left, y: envelope.bottom },
        { x: envelope.left, y: (envelope.top + envelope.bottom) / 2 },
      ]
      for (const waypoint of envelopeWaypoints) {
        if (isModelPositionInsideBattlefield(waypoint, request.model, request.battlefield)) baseNodes.push(waypoint)
      }
    }

    const baseAdjacency = baseNodes.map(() => [] as Array<{ index: number; distance: number }>)
    for (let source = 0; source < baseNodes.length; source += 1) {
      for (let target = source + 1; target < baseNodes.length; target += 1) {
        if (!segmentIsClear(baseNodes[source], baseNodes[target], modelRadius, obstacles)) continue
        const distance = distanceBetween(baseNodes[source], baseNodes[target])
        baseAdjacency[source].push({ index: target, distance })
        baseAdjacency[target].push({ index: source, distance })
      }
    }
    baseGraph = { nodes: baseNodes, adjacency: baseAdjacency }
    planner?.visibilityGraphs.set(graphKey, baseGraph)
  }

  const nodes: Point[] = [{ ...baseGraph.nodes[0] }, { ...destination }, ...baseGraph.nodes.slice(1)]
  const adjacency = nodes.map(() => [] as Array<{ index: number; distance: number }>)
  const mappedIndex = (baseIndex: number) => baseIndex === 0 ? 0 : baseIndex + 1
  for (let source = 0; source < baseGraph.adjacency.length; source += 1) {
    for (const edge of baseGraph.adjacency[source]) {
      adjacency[mappedIndex(source)].push({ index: mappedIndex(edge.index), distance: edge.distance })
    }
  }
  for (let baseIndex = 0; baseIndex < baseGraph.nodes.length; baseIndex += 1) {
    if (!segmentIsClear(baseGraph.nodes[baseIndex], destination, modelRadius, obstacles)) continue
    const distance = distanceBetween(baseGraph.nodes[baseIndex], destination)
    const index = mappedIndex(baseIndex)
    adjacency[index].push({ index: 1, distance })
    adjacency[1].push({ index, distance })
  }

  const distances = nodes.map(() => Number.POSITIVE_INFINITY)
  const previous = nodes.map(() => -1)
  const visited = nodes.map(() => false)
  distances[0] = 0

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let current = -1
    for (let index = 0; index < nodes.length; index += 1) {
      if (visited[index]) continue
      if (current === -1
        || distances[index] < distances[current] - GEOMETRY_EPSILON
        || (Math.abs(distances[index] - distances[current]) <= GEOMETRY_EPSILON && index < current)) {
        current = index
      }
    }
    if (current === -1 || !Number.isFinite(distances[current])) break
    if (current === 1) break
    visited[current] = true
    for (const edge of adjacency[current]) {
      const nextDistance = distances[current] + edge.distance
      if (nextDistance < distances[edge.index] - GEOMETRY_EPSILON) {
        distances[edge.index] = nextDistance
        previous[edge.index] = current
      }
    }
  }

  if (!Number.isFinite(distances[1])) return null
  const indexes: number[] = []
  for (let current = 1; current !== -1; current = previous[current]) indexes.push(current)
  indexes.reverse()
  return {
    path: indexes.map((index) => ({ ...nodes[index] })),
    distance: distances[1],
  }
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
      const obstacleRadius = movingRadius + baseRadiusInches(obstacle.base)
      const nearCluster = [...connected.values()].some((member) => {
        const memberRadius = movingRadius + baseRadiusInches(member.base)
        const groupingGap = Math.min(movingRadius, baseRadiusInches(obstacle.base), baseRadiusInches(member.base)) * 0.25
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

function blockerEnvelope(obstacles: ReadonlyArray<TabletopModel>, movingRadius: number) {
  const padding = PATH_CLEARANCE + movingRadius * 0.05
  return {
    left: Math.min(...obstacles.map((obstacle) => obstacle.position.x - movingRadius - baseRadiusInches(obstacle.base))) - padding,
    right: Math.max(...obstacles.map((obstacle) => obstacle.position.x + movingRadius + baseRadiusInches(obstacle.base))) + padding,
    top: Math.min(...obstacles.map((obstacle) => obstacle.position.y - movingRadius - baseRadiusInches(obstacle.base))) - padding,
    bottom: Math.max(...obstacles.map((obstacle) => obstacle.position.y + movingRadius + baseRadiusInches(obstacle.base))) + padding,
  }
}

function segmentIsClear(
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
