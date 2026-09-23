import type { Battlefield, BattlefieldFeature, TabletopModel, TerrainPolicyConfig } from '../domain/types'
import {
  closestPointsBetweenFootprints,
  footprintBounds,
  footprintCircumradiusInches,
  footprintsOverlap,
  normalizeRotation,
  poseForModel,
} from './geometry/footprints'
import { GEOMETRY_EPSILON } from './geometry/tolerance'
import { terrainObstacleModels } from './terrainPolicy'

export interface RotationSweepRequest {
  allModels: ReadonlyArray<TabletopModel>
  modelId: string
  angularDelta: number
  battlefield: Battlefield
  terrainFeatures?: ReadonlyArray<BattlefieldFeature>
  terrainPolicy?: TerrainPolicyConfig
}

export interface RotationSweepResult {
  rotation: number
  angularRotation: number
  blocked: boolean
}

const MAX_ROTATION_ITERATIONS = 512
const CONTACT_DISTANCE_TOLERANCE = 1e-8
const CONTACT_PROBE_ANGLE = 1e-5
const CONTACT_PROBE_SUBDIVISIONS = 8
const ADVANCEMENT_SAFETY = 0.9

/**
 * Resolves a fixed-position angular sweep for one convex footprint. Clearance
 * divided by circumradius is a conservative safe angular advance because no
 * footprint point can travel faster than circumradius per radian.
 */
export function resolveModelRotation(request: RotationSweepRequest): RotationSweepResult {
  const model = request.allModels.find((candidate) => candidate.id === request.modelId)
  if (!model || !Number.isFinite(request.angularDelta)) {
    return { rotation: model?.rotation ?? 0, angularRotation: 0, blocked: false }
  }
  const requestedMagnitude = Math.abs(request.angularDelta)
  if (requestedMagnitude <= GEOMETRY_EPSILON) {
    return { rotation: normalizeRotation(model.rotation), angularRotation: 0, blocked: false }
  }

  // A circle's silhouette is invariant under rotation, preserving exact circle behavior.
  if (model.base.shape === 'circle') {
    return {
      rotation: normalizeRotation(model.rotation + request.angularDelta),
      angularRotation: requestedMagnitude,
      blocked: false,
    }
  }

  const obstacles = [
    ...request.allModels.filter((candidate) => candidate.id !== model.id),
    ...terrainObstacleModels(model, request.terrainFeatures, request.terrainPolicy, 'finish'),
  ]
  const radius = footprintCircumradiusInches(model.base)
  const direction = Math.sign(request.angularDelta)
  let travelled = 0

  if (!rotationPoseLegal(model, model.rotation, obstacles, request.battlefield)) {
    return { rotation: normalizeRotation(model.rotation), angularRotation: 0, blocked: true }
  }

  for (let iteration = 0; iteration < MAX_ROTATION_ITERATIONS; iteration += 1) {
    const remaining = requestedMagnitude - travelled
    if (remaining <= GEOMETRY_EPSILON) {
      return {
        rotation: normalizeRotation(model.rotation + direction * requestedMagnitude),
        angularRotation: requestedMagnitude,
        blocked: false,
      }
    }

    const currentRotation = model.rotation + direction * travelled
    const clearance = minimumRotationClearance(model, currentRotation, obstacles, request.battlefield)
    if (clearance <= CONTACT_DISTANCE_TOLERANCE) {
      const probe = Math.min(remaining, CONTACT_PROBE_ANGLE)
      const probeResult = advanceContactProbe(
        model,
        currentRotation,
        direction * probe,
        obstacles,
        request.battlefield,
      )
      travelled += probeResult.fraction * probe
      if (probeResult.fraction < 1) {
        return {
          rotation: normalizeRotation(model.rotation + direction * travelled),
          angularRotation: travelled,
          blocked: true,
        }
      }
      continue
    }

    const step = Math.min(remaining, ADVANCEMENT_SAFETY * clearance / radius)
    if (step <= GEOMETRY_EPSILON) break
    travelled += step
  }

  return {
    rotation: normalizeRotation(model.rotation + direction * travelled),
    angularRotation: travelled,
    blocked: travelled < requestedMagnitude - GEOMETRY_EPSILON,
  }
}

export function shortestSignedAngularDelta(from: number, to: number): number {
  const fullTurn = Math.PI * 2
  let delta = ((to - from + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI
  if (Math.abs(delta + Math.PI) <= GEOMETRY_EPSILON && to - from > 0) delta = Math.PI
  return delta
}

function minimumRotationClearance(
  model: TabletopModel,
  rotation: number,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): number {
  const pose = poseForModel({ ...model, rotation })
  const bounds = footprintBounds(model.base, pose)
  let clearance = Math.min(
    bounds.left,
    battlefield.width - bounds.right,
    bounds.top,
    battlefield.height - bounds.bottom,
  )
  for (const obstacle of obstacles) {
    const closest = closestPointsBetweenFootprints(
      model.base,
      pose,
      obstacle.base,
      poseForModel(obstacle),
    )
    clearance = Math.min(clearance, closest.distance)
  }
  return Math.max(0, clearance)
}

function rotationPoseLegal(
  model: TabletopModel,
  rotation: number,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): boolean {
  const pose = poseForModel({ ...model, rotation })
  const bounds = footprintBounds(model.base, pose)
  if (bounds.left < -GEOMETRY_EPSILON
    || bounds.right > battlefield.width + GEOMETRY_EPSILON
    || bounds.top < -GEOMETRY_EPSILON
    || bounds.bottom > battlefield.height + GEOMETRY_EPSILON) return false
  return obstacles.every((obstacle) => !footprintsOverlap(
    model.base,
    pose,
    obstacle.base,
    poseForModel(obstacle),
  ))
}

function advanceContactProbe(
  model: TabletopModel,
  startRotation: number,
  angularDelta: number,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): { fraction: number } {
  let safeFraction = 0
  for (let index = 1; index <= CONTACT_PROBE_SUBDIVISIONS; index += 1) {
    const fraction = index / CONTACT_PROBE_SUBDIVISIONS
    if (!rotationPoseLegal(
      model,
      startRotation + angularDelta * fraction,
      obstacles,
      battlefield,
    )) {
      return { fraction: refineLegalRotationFraction(
        model,
        startRotation,
        angularDelta,
        obstacles,
        battlefield,
        safeFraction,
        fraction,
      ) }
    }
    safeFraction = fraction
  }
  return { fraction: 1 }
}

function refineLegalRotationFraction(
  model: TabletopModel,
  startRotation: number,
  angularDelta: number,
  obstacles: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
  safeFraction: number,
  illegalFraction: number,
): number {
  let low = safeFraction
  let high = illegalFraction
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middle = (low + high) / 2
    if (rotationPoseLegal(
      model,
      startRotation + angularDelta * middle,
      obstacles,
      battlefield,
    )) low = middle
    else high = middle
  }
  return low
}
