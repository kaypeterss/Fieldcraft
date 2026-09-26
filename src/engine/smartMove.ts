import type { Battlefield, BattlefieldFeature, MovementDestinationConstraint, MovementPolicyConfig, MovementSeparationConstraint, PoseTrajectory, TabletopModel, TerrainPolicyConfig, Unit } from '../domain/types'
import {
  projectCandidateModels,
  validateCandidateFormation,
  type CandidateFormation,
  type CandidateFormationResult,
} from './candidateFormation'
import {
  evaluateUnitCoherency,
  type CoherencyPolicy,
  type CoherencyResult,
} from './coherency'
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
import { movementEnvelopeReach } from './movementEnvelope'
import { calculatePathMovementCost, DEFAULT_MOVEMENT_POLICY } from './movementCost'
import { resolveModelRotation, shortestSignedAngularDelta } from './rotation'
import { appendPoseTrajectorySegment, createPoseTrajectory, derivePoseTrajectoryMetrics } from './trajectory'
import {
  createModelPathPlanner,
  findDirectModelPath,
  findModelPath,
  type ModelPathPlanner,
  type ModelPathRequest,
  type ModelPathResult,
} from './pathfinding'
import { baseRadiusInches, distanceBetweenBases } from './spatial'
import { terrainDestinationLegal, terrainObstacleModels } from './terrainPolicy'

export type SmartMoveFailureReason =
  | 'INVALID_SELECTION'
  | 'MULTIPLE_UNITS'
  | 'NO_REACHABLE_FORMATION'
  | 'MOVEMENT_LIMIT'
  | 'COLLISION'
  | 'BATTLEFIELD'
  | 'COHERENCY'
  | 'DESTINATION_RELATIONSHIP'
  | 'SEARCH_LIMIT'

export interface SmartMoveRequest {
  allModels: ReadonlyArray<TabletopModel>
  units: ReadonlyArray<Unit>
  battlefield: Battlefield
  terrainFeatures?: ReadonlyArray<BattlefieldFeature>
  terrainPolicy?: TerrainPolicyConfig
  selectedModelIds: ReadonlyArray<string>
  target: Point
  movementRemaining: Readonly<Record<string, number>>
  coherencyPolicy?: CoherencyPolicy
  movementPolicy?: MovementPolicyConfig
  separationConstraints?: ReadonlyArray<MovementSeparationConstraint>
  destinationConstraints?: ReadonlyArray<MovementDestinationConstraint>
  /** Optional wall-clock search allowance. The UI worker sets this per intent. */
  searchBudgetMs?: number
}

export interface SmartMoveAssignment {
  modelId: string
  slotIndex: number
  start: Point
  destination: Point
  path: Point[]
  movementCost: number
  movementRemaining: number
  /** Present on orientation-aware assignments; older fixed-orientation results omit it. */
  finalRotation?: number
  trajectory?: PoseTrajectory
}

export interface SmartMoveValidationStatus {
  movement: boolean
  collision: boolean
  battlefield: boolean
  coherency: boolean
}

export type SmartMoveSolverStage = 'COMMON_TRANSLATION' | 'DIRECT_MAXIMUM' | 'FALLBACK' | 'ROTATION_FALLBACK'

export interface SmartMoveDiagnostics {
  solverStage: SmartMoveSolverStage
  selectedModels: number
  totalAvailableUsefulMovement: number
  totalActualPathMovement: number
  totalTargetProgress: number
  averageTargetProgress: number
  averageUsefulProgressPercent: number
  minimumUsefulProgressPercent: number
  fastPathAccepted: boolean
  fallbackUsed: boolean
  fallbackReasons: SmartMoveFailureReason[]
  fallbackOrder: string[]
  candidatePositionsGenerated: number
  candidatePositionsDeduplicated: number
  pathfindingCalls: number
  directPathChecks: number
  directPaths: number
  routedPaths: number
  failedPaths: number
  coherencyEvaluations: number
  backtrackingNodes: number
  finalValidations: number
  searchBudgetExhausted: boolean
  requestSetupMs: number
  fastPathValidationMs: number
  fallbackOrderingMs: number
  candidateGenerationMs: number
  candidateDeduplicationMs: number
  collisionFilteringMs: number
  pathfindingMs: number
  provisionalCoherencyMs: number
  finalValidationMs: number
  candidateScoringMs: number
  fallbackSearchMs: number
  solveTimeMs: number
}

export interface SmartMoveResult {
  valid: boolean
  target: Point
  unitId?: string
  selectedModelIds: string[]
  positions: CandidateFormation
  assignments: SmartMoveAssignment[]
  totalMovementCost: number
  validation: SmartMoveValidationStatus
  formationValidation: CandidateFormationResult | null
  coherency: CoherencyResult | null
  failureReasons: SmartMoveFailureReason[]
  candidatesTested: number
  diagnostics: SmartMoveDiagnostics | null
}

interface PlannedTemplate {
  positions: Record<string, Point>
  assignments: SmartMoveAssignment[]
  validation: CandidateFormationResult
  coherency: CoherencyResult | null
  score: [number, number, number, number, number]
}

interface TemplateFailure {
  reasons: SmartMoveFailureReason[]
}

interface SolverMetrics {
  deadlineAt: number
  fallbackOrder: string[]
  candidatePositionsGenerated: number
  candidatePositionsDeduplicated: number
  pathfindingCalls: number
  directPathChecks: number
  directPaths: number
  routedPaths: number
  failedPaths: number
  coherencyEvaluations: number
  backtrackingNodes: number
  finalValidations: number
  searchBudgetExhausted: boolean
  requestSetupMs: number
  fastPathValidationMs: number
  fallbackOrderingMs: number
  candidateGenerationMs: number
  candidateDeduplicationMs: number
  collisionFilteringMs: number
  pathfindingMs: number
  provisionalCoherencyMs: number
  finalValidationMs: number
  candidateScoringMs: number
  fallbackSearchMs: number
}

interface TargetOrderedFallbackResult {
  planned: PlannedTemplate | null
  reasons: SmartMoveFailureReason[]
  completeCandidatesTested: number
}

export const SMART_MOVE_MAX_FORMATION_TEMPLATES = 34
export const SMART_MOVE_FALLBACK_MAX_RAW_POSITIONS = 48
export const SMART_MOVE_FALLBACK_MAX_ALTERNATIVES = 6
export const SMART_MOVE_FALLBACK_MAX_BACKTRACKING_NODES = 360
export const SMART_MOVE_FALLBACK_MAX_PATH_ATTEMPTS = 1_200
export const SMART_MOVE_FALLBACK_MAX_DIRECT_PATH_CHECKS = 4_000
export const SMART_MOVE_FALLBACK_MAX_COMPLETE_CANDIDATES = 12
export const SMART_MOVE_FALLBACK_MAX_REACHABLE_CANDIDATES = 12
export const SMART_MOVE_FALLBACK_MAX_DETOUR_CANDIDATES = 3
export const SMART_MOVE_FALLBACK_MAX_DETOUR_CANDIDATES_COMPLEX_POLICY = 4
export const SMART_MOVE_FALLBACK_MAX_DETOUR_CANDIDATES_SMALL_UNIT = 12
export const SMART_MOVE_EFFECTIVE_PROGRESS_TOLERANCE = 0.01
const FORMATION_ROTATIONS = [0, Math.PI / 6]
const FALLBACK_PROGRESS_FRACTIONS = [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0]
const GENERIC_RELATIONSHIP_SAMPLES = 16
const MAX_GENERIC_RELATIONSHIP_ANCHORS = 6
const SMART_MOVE_GENERIC_MAX_DETOUR_CANDIDATES = 2
export const SMART_MOVE_CANDIDATE_DEDUPLICATION_TOLERANCE = 1e-5

export function solveSmartMove(request: SmartMoveRequest): SmartMoveResult {
  const budgetMs = request.searchBudgetMs
  const deadlineAt = budgetMs === undefined || !Number.isFinite(budgetMs)
    ? Number.POSITIVE_INFINITY : nowMilliseconds() + Math.max(0, budgetMs)
  const fixed = solveFixedOrientationSmartMove(request, deadlineAt)
  return tryOrientationFallback(request, fixed, deadlineAt)
}

function solveFixedOrientationSmartMove(request: SmartMoveRequest, deadlineAt: number): SmartMoveResult {
  const solveStartedAt = nowMilliseconds()
  const metrics = createSolverMetrics(deadlineAt)
  const selectedIds = [...new Set(request.selectedModelIds)].sort((a, b) => a.localeCompare(b))
  const selectedModels = selectedIds.flatMap((id) => {
    const model = request.allModels.find((candidate) => candidate.id === id)
    return model ? [model] : []
  })
  if (selectedIds.length === 0 || selectedModels.length !== selectedIds.length) {
    return failedResult(request.target, selectedIds, ['INVALID_SELECTION'])
  }

  const unitIds = [...new Set(selectedModels.map((model) => model.unitId))]
  if (unitIds.length !== 1) return failedResult(request.target, selectedIds, ['MULTIPLE_UNITS'])
  const unit = request.units.find((candidate) => candidate.id === unitIds[0])
  if (!unit || selectedModels.some((model) => !unit.modelIds.includes(model.id))) {
    return failedResult(request.target, selectedIds, ['INVALID_SELECTION'])
  }
  if (nowMilliseconds() >= deadlineAt) return failedResult(request.target, selectedIds, ['SEARCH_LIMIT'])
  metrics.requestSetupMs = nowMilliseconds() - solveStartedAt

  let candidatesTested = 0
  const failures = new Set<SmartMoveFailureReason>()
  let validCommonTranslation: PlannedTemplate | null = null
  const fastPathStartedAt = nowMilliseconds()

  const commonTranslation = planCommonMaximumTranslation(request, unit, selectedModels, 0, metrics)
  if (commonTranslation) {
    candidatesTested += 1
    if (!('reasons' in commonTranslation)) {
      validCommonTranslation = commonTranslation
    } else {
      commonTranslation.reasons.forEach((reason) => failures.add(reason))
    }
  }

  candidatesTested += 1
  const directMaximum = planDirectMaximumProgress(request, unit, selectedModels, candidatesTested - 1, metrics)
  if (!('reasons' in directMaximum)) {
    const useDirect = !validCommonTranslation
      || candidateStrictlyDominates(request, directMaximum, validCommonTranslation)
    metrics.fastPathValidationMs = nowMilliseconds() - fastPathStartedAt
    return successfulResult(
      request,
      unit,
      selectedIds,
      useDirect ? directMaximum : validCommonTranslation!,
      candidatesTested,
      useDirect ? 'DIRECT_MAXIMUM' : 'COMMON_TRANSLATION',
      [],
      metrics,
      solveStartedAt,
    )
  }
  directMaximum.reasons.forEach((reason) => failures.add(reason))
  if (validCommonTranslation) {
    metrics.fastPathValidationMs = nowMilliseconds() - fastPathStartedAt
    return successfulResult(
      request,
      unit,
      selectedIds,
      validCommonTranslation,
      candidatesTested,
      'COMMON_TRANSLATION',
      [],
      metrics,
      solveStartedAt,
    )
  }
  metrics.fastPathValidationMs = nowMilliseconds() - fastPathStartedAt
  const fallbackReasons = [...failures]
  const fallbackStartedAt = nowMilliseconds()

  const targetOrdered = planTargetOrderedFallback(request, unit, selectedModels, metrics)
  candidatesTested += targetOrdered.completeCandidatesTested
  targetOrdered.reasons.forEach((reason) => failures.add(reason))
  if (targetOrdered.planned) {
    metrics.fallbackSearchMs = nowMilliseconds() - fallbackStartedAt
    return successfulResult(
      request,
      unit,
      selectedIds,
      targetOrdered.planned,
      candidatesTested,
      'FALLBACK',
      fallbackReasons,
      metrics,
      solveStartedAt,
    )
  }

  const movableModels = selectedModels.filter((model) => remainingFor(request, model.id) > GEOMETRY_EPSILON)
  const templateModels = movableModels.length > 0 ? movableModels : selectedModels
  const circleTemplates = templateModels.every((model) => model.base.shape === 'circle')
  const largestRadius = circleTemplates
    ? Math.max(...templateModels.map((model) => baseRadiusInches(model.base)))
    : 0
  const spacings = circleTemplates
    ? formationSpacings(largestRadius, request.coherencyPolicy, templateModels.length)
    : genericFormationSeparations(request.coherencyPolicy, templateModels.length)
  const startCentroid = pointsCentroid(templateModels.map((model) => model.position))
  const focuses = formationFocuses(
    request.target,
    startCentroid,
    Math.max(0, ...movableModels.map((model) => remainingFor(request, model.id))),
  )
  const rotations = templateModels.length <= 1 ? [0] : FORMATION_ROTATIONS
  const templateLimit = maxTemplatesForSelection(selectedModels.length)
  let best: PlannedTemplate | null = null

  outer: for (const focus of focuses) {
    for (const spacing of spacings) {
      for (const rotation of rotations) {
        if (nowMilliseconds() >= deadlineAt) {
          metrics.searchBudgetExhausted = true
          break outer
        }
        if (candidatesTested >= templateLimit) break outer
        const slots = circleTemplates
          ? clampSlotsToBattlefield(
              generateHexSlots(templateModels.length, spacing, rotation, focus),
              largestRadius,
              request.battlefield,
            )
          : clampFootprintSlotsToBattlefield(
              generateFootprintFormationSlots(templateModels, spacing, rotation, focus),
              templateModels,
              request.battlefield,
            )
        candidatesTested += 1
        const planned = planTemplate(
          request,
          unit,
          templateModels,
          slots,
          candidatesTested - 1,
          candidatesTested % 2 === 0,
          metrics,
        )
        if ('reasons' in planned) {
          planned.reasons.forEach((reason) => failures.add(reason))
          continue
        }
        if (!best || compareScores(planned.score, best.score) < 0) best = planned
      }
    }
  }

  if (!best) {
    failures.add('NO_REACHABLE_FORMATION')
    if (candidatesTested >= templateLimit) failures.add('SEARCH_LIMIT')
    const reasons = [...failures]
    metrics.fallbackSearchMs = nowMilliseconds() - fallbackStartedAt
    return {
      ...failedResult(request.target, selectedIds, reasons),
      unitId: unit.id,
      candidatesTested,
      validation: validationFromFailures(reasons),
      diagnostics: deriveDiagnostics(
        request,
        [],
        'FALLBACK',
        fallbackReasons,
        metrics,
        solveStartedAt,
      ),
    }
  }

  metrics.fallbackSearchMs = nowMilliseconds() - fallbackStartedAt
  return successfulResult(
    request,
    unit,
    selectedIds,
    best,
    candidatesTested,
    'FALLBACK',
    fallbackReasons,
    metrics,
    solveStartedAt,
  )
}

const MAX_ORIENTATION_MODELS = 3
const MAX_ORIENTATIONS_PER_MODEL = 3
const MAX_ORIENTATION_ATTEMPTS = 4
const MIN_ROTATION_PROGRESS_GAIN = 0.1

/** A late, bounded escape hatch. The proven fixed-orientation solver always runs first. */
function tryOrientationFallback(request: SmartMoveRequest, fixed: SmartMoveResult, deadlineAt: number): SmartMoveResult {
  if (nowMilliseconds() >= deadlineAt) return fixed.valid ? fixed : withSearchLimit(fixed)
  const selected = request.selectedModelIds.flatMap((id) => {
    const model = request.allModels.find((candidate) => candidate.id === id)
    return model && model.base.shape !== 'circle' && remainingFor(request, id) > GEOMETRY_EPSILON
      ? [model] : []
  })
  if (selected.length === 0 || (fixed.valid && fixed.assignments.every((assignment) => {
    const useful = Math.min(distanceBetween(assignment.start, request.target), assignment.movementRemaining)
    const actual = distanceBetween(assignment.start, request.target)
      - distanceBetween(assignment.destination, request.target)
    return useful - actual <= MIN_ROTATION_PROGRESS_GAIN
  }))) return fixed
  // Large formations can have modest coherency-limited shortfalls even when
  // their fixed-orientation solve already made useful progress for everyone.
  if (selected.length > 3 && fixed.valid
    && (fixed.diagnostics?.minimumUsefulProgressPercent ?? 0) >= 50) return fixed
  if (!orientationMayHelp(request, selected)) return fixed

  const policy = request.movementPolicy ?? DEFAULT_MOVEMENT_POLICY
  const fixedProgress = fixed.valid ? totalTargetProgress(fixed.assignments, request.target) : Number.NEGATIVE_INFINITY
  let best = fixed
  let bestProgress = fixedProgress
  let attempts = 0
  const fixedById = new Map(fixed.assignments.map((assignment) => [assignment.modelId, assignment]))
  const ordered = selected.sort((left, right) => {
    const shortfall = (model: TabletopModel) => {
      const assignment = fixedById.get(model.id)
      const achieved = assignment
        ? distanceBetween(model.position, request.target) - distanceBetween(assignment.destination, request.target)
        : 0
      return Math.min(remainingFor(request, model.id), distanceBetween(model.position, request.target)) - achieved
    }
    return shortfall(right) - shortfall(left) || left.id.localeCompare(right.id)
  })
  const candidatesById = new Map(ordered.map((model) => [model.id, orientationCandidates(model, request)]))

  const variants: Array<Record<string, number>> = []
  if (ordered.length > 1 && ordered.length <= 6) {
    const shared = Object.fromEntries(ordered.flatMap((model) => {
      const angle = candidatesById.get(model.id)?.[0]
      return angle === undefined ? [] : [[model.id, angle]]
    }))
    if (Object.keys(shared).length > 1) variants.push(shared)
  }
  for (const model of ordered.slice(0, MAX_ORIENTATION_MODELS)) {
    const angle = candidatesById.get(model.id)?.[0]
    if (angle !== undefined) variants.push({ [model.id]: angle })
  }
  for (const model of ordered.slice(0, MAX_ORIENTATION_MODELS)) {
    for (const angle of candidatesById.get(model.id)?.slice(1, MAX_ORIENTATIONS_PER_MODEL) ?? []) {
      variants.push({ [model.id]: angle })
    }
  }
  for (const variant of variants.slice(0, MAX_ORIENTATION_ATTEMPTS)) {
    if (nowMilliseconds() >= deadlineAt) return best.valid ? best : withSearchLimit(best)
    attempts += 1
    const candidate = solveRotationVariant(request, variant, policy, deadlineAt)
    if (!candidate) continue
    const progress = totalTargetProgress(candidate.assignments, request.target)
    if (progress <= bestProgress + MIN_ROTATION_PROGRESS_GAIN) continue
    if (fixed.valid && candidate.assignments.some((assignment) => {
      const previous = fixed.assignments.find((other) => other.modelId === assignment.modelId)
      return previous && distanceBetween(assignment.destination, request.target)
        > distanceBetween(previous.destination, request.target) + SMART_MOVE_EFFECTIVE_PROGRESS_TOLERANCE
    })) continue
    bestProgress = progress
    best = candidate
  }
  if (nowMilliseconds() >= deadlineAt && !best.valid) return withSearchLimit(best)
  return best === fixed ? fixed : { ...best, candidatesTested: fixed.candidatesTested + attempts }
}

function solveRotationVariant(
  request: SmartMoveRequest,
  angles: Readonly<Record<string, number>>,
  policy: MovementPolicyConfig,
  deadlineAt: number,
): SmartMoveResult | null {
  let rotatedModels = [...request.allModels]
  const remaining = { ...request.movementRemaining }
  const deltas: Record<string, number> = {}
  for (const modelId of Object.keys(angles).sort((a, b) => a.localeCompare(b))) {
    if (nowMilliseconds() >= deadlineAt) return null
    const original = request.allModels.find((candidate) => candidate.id === modelId)
    if (!original) return null
    const delta = shortestSignedAngularDelta(original.rotation, angles[modelId])
    if (Math.abs(delta) <= 1e-3) continue
    const sweep = resolveModelRotation({
      allModels: rotatedModels, modelId, angularDelta: delta, battlefield: request.battlefield,
      terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
    })
    if (sweep.blocked || Math.abs(sweep.angularRotation - Math.abs(delta)) > 1e-6) return null
    const allowance = remainingFor(request, modelId)
    if (policy.type === 'movement-envelope' && !rotationFitsEnvelope(original, delta, allowance)) return null
    const rotationCharge = policy.type === 'fixed-rotation-charge' ? policy.rotationCharge : 0
    if (rotationCharge > allowance + GEOMETRY_EPSILON) return null
    const rotationReach = policy.type === 'movement-envelope'
      ? movementEnvelopeReach(original.base, poseForModel(original), {
        position: original.position, rotation: sweep.rotation,
      }).distance
      : 0
    // This is a conservative search radius. Final policy legality below uses
    // the full ordered trajectory relative to the original starting pose.
    remaining[modelId] = Math.max(0, allowance - rotationCharge - rotationReach)
    deltas[modelId] = delta
    rotatedModels = rotatedModels.map((model) => model.id === modelId
      ? { ...model, rotation: sweep.rotation } : model)
  }
  if (Object.keys(deltas).length === 0) return null
  const solved = solveFixedOrientationSmartMove({
    ...request, allModels: rotatedModels, movementRemaining: remaining,
  }, deadlineAt)
  if (!solved.valid) return null
  const assignments = solved.assignments.map((assignment) => {
    const original = request.allModels.find((model) => model.id === assignment.modelId)!
    const finalRotation = rotatedModels.find((model) => model.id === assignment.modelId)!.rotation
    let trajectory = createPoseTrajectory({ position: original.position, rotation: original.rotation })
    if (deltas[original.id] !== undefined) {
      trajectory = appendPoseTrajectorySegment(trajectory, {
        endPose: { position: original.position, rotation: finalRotation },
        angularDelta: deltas[original.id],
      })
    }
    for (const position of assignment.path.slice(1)) {
      trajectory = appendPoseTrajectorySegment(trajectory, {
        endPose: { position, rotation: finalRotation }, angularDelta: 0,
      })
    }
    const metrics = derivePoseTrajectoryMetrics(trajectory)
    const movementCost = policy.type === 'movement-envelope'
      ? envelopeTrajectoryCost(original, trajectory, remainingFor(request, original.id))
      : calculatePathMovementCost(policy, {
        translationDistance: metrics.centerPathLength,
        angularDistance: metrics.totalAbsoluteAngularTravel,
      }).totalCost
    return { ...assignment, finalRotation, trajectory, movementCost,
      movementRemaining: remainingFor(request, assignment.modelId) }
  })
  if (assignments.some((assignment) => !Number.isFinite(assignment.movementCost))) return null
  const rotations = Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.finalRotation!]))
  const unit = request.units.find((candidate) => candidate.id === solved.unitId)
  const validation = validateCandidateFormation({
    allModels: request.allModels, battlefield: request.battlefield,
    terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
    separationConstraints: request.separationConstraints,
    destinationConstraints: request.destinationConstraints,
    positions: solved.positions, rotations,
    reachability: {
      movementCosts: Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementCost])),
      movementAllowances: Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementRemaining])),
    },
    ...(request.coherencyPolicy && unit
      ? { coherency: { unit, policy: request.coherencyPolicy } } : {}),
  })
  if (!validation.valid) return null
  return {
    ...solved, assignments, formationValidation: validation,
    totalMovementCost: assignments.reduce((total, assignment) => total + assignment.movementCost, 0),
    coherency: request.coherencyPolicy && unit
      ? evaluateUnitCoherency(unit,
        projectCandidateModels(request.allModels, solved.positions, rotations), request.coherencyPolicy)
      : null,
    diagnostics: solved.diagnostics && { ...solved.diagnostics, solverStage: 'ROTATION_FALLBACK',
      fastPathAccepted: false, fallbackUsed: true },
  }
}

function orientationMayHelp(request: SmartMoveRequest, selected: ReadonlyArray<TabletopModel>): boolean {
  const selectedIds = new Set(request.selectedModelIds)
  const stationary = request.allModels.filter((model) => !selectedIds.has(model.id))
  return selected.some((model) => {
    const distance = distanceBetween(model.position, request.target)
    if (distance <= GEOMETRY_EPSILON) return false
    const travel = Math.min(distance, remainingFor(request, model.id))
    const direction = {
      x: (request.target.x - model.position.x) / distance,
      y: (request.target.y - model.position.y) / distance,
    }
    if (maximumBattlefieldAdvance(model, direction, request.battlefield)
      < travel - MIN_ROTATION_PROGRESS_GAIN) return true
    const translation = { x: direction.x * travel, y: direction.y * travel }
    return [...stationary,
      ...terrainObstacleModels(model, request.terrainFeatures, request.terrainPolicy, 'cross'),
      ...terrainObstacleModels(model, request.terrainFeatures, request.terrainPolicy, 'finish')]
      .some((obstacle) => {
      if (obstacle.unitId === model.unitId && request.coherencyPolicy
        && distanceBetween(model.position, obstacle.position)
          <= travel + request.coherencyPolicy.distance
            + footprintCircumradiusInches(model.base) + footprintCircumradiusInches(obstacle.base)) return true
      return sweepFootprintTranslation(model.base, poseForModel(model), translation,
        obstacle.base, poseForModel(obstacle)) !== null
      })
  })
}

function totalTargetProgress(assignments: ReadonlyArray<SmartMoveAssignment>, target: Point): number {
  return assignments.reduce((sum, assignment) => sum
    + distanceBetween(assignment.start, target) - distanceBetween(assignment.destination, target), 0)
}

function orientationCandidates(model: TabletopModel, request: SmartMoveRequest): number[] {
  const heading = Math.atan2(request.target.y - model.position.y, request.target.x - model.position.x)
  const majorAxis = model.base.shape === 'ellipse' || model.base.shape === 'rectangle'
    ? model.base.widthMm >= model.base.heightMm ? 0 : Math.PI / 2
    : longestPolygonAxis(model)
  const candidates = [heading - majorAxis, heading + Math.PI / 2 - majorAxis]
  const nearby = [...request.allModels,
    ...terrainObstacleModels(model, request.terrainFeatures, request.terrainPolicy, 'cross'),
    ...terrainObstacleModels(model, request.terrainFeatures, request.terrainPolicy, 'finish')]
    .filter((other) => other.id !== model.id && other.base.shape !== 'circle')
    .sort((a, b) => distanceBetween(a.position, model.position) - distanceBetween(b.position, model.position)
      || a.id.localeCompare(b.id))[0]
  if (nearby && distanceBetween(nearby.position, model.position)
    <= remainingFor(request, model.id) + footprintCircumradiusInches(model.base)
      + footprintCircumradiusInches(nearby.base)) {
    const obstacleAxis = nearby.base.shape === 'ellipse' || nearby.base.shape === 'rectangle'
      ? nearby.base.widthMm >= nearby.base.heightMm ? 0 : Math.PI / 2
      : longestPolygonAxis(nearby)
    candidates.push(nearby.rotation + obstacleAxis - majorAxis)
  }
  return candidates.map((angle) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
    .filter((angle, index, all) => Math.abs(shortestSignedAngularDelta(model.rotation, angle)) > 1e-3
      && all.findIndex((other) => Math.abs(shortestSignedAngularDelta(other, angle)) < 1e-3) === index)
}

function longestPolygonAxis(model: TabletopModel): number {
  if (model.base.shape !== 'polygon') return 0
  const vertices = model.base.verticesMm
  let bestLength = 0
  let angle = 0
  for (let first = 0; first < vertices.length; first += 1) {
    for (let second = first + 1; second < vertices.length; second += 1) {
      const dx = vertices[second].x - vertices[first].x
      const dy = vertices[second].y - vertices[first].y
      const length = dx * dx + dy * dy
      if (length > bestLength) { bestLength = length; angle = Math.atan2(dy, dx) }
    }
  }
  return angle
}

function rotationFitsEnvelope(model: TabletopModel, delta: number, allowance: number): boolean {
  const start = poseForModel(model)
  const radius = footprintCircumradiusInches(model.base)
  const steps = Math.max(16, Math.ceil(Math.abs(delta) / 0.02))
  for (let index = 0; index <= steps; index += 1) {
    const angle = model.rotation + delta * index / steps
    const reach = movementEnvelopeReach(model.base, start, { position: model.position, rotation: angle }).distance
    // A footprint point travels at most radius * angular delta between samples.
    const margin = radius * Math.abs(delta) / (2 * steps)
    if (reach + margin > allowance + GEOMETRY_EPSILON) return false
  }
  return true
}

function envelopeTrajectoryCost(model: TabletopModel, trajectory: PoseTrajectory, allowance: number): number {
  const start = trajectory.startPose
  let maximum = 0
  for (const segment of trajectory.segments) {
    const reach = movementEnvelopeReach(model.base, start, segment.endPose).distance
    if (reach > allowance + GEOMETRY_EPSILON) return Number.POSITIVE_INFINITY
    maximum = Math.max(maximum, reach)
  }
  return maximum
}

function candidateStrictlyDominates(
  request: SmartMoveRequest,
  candidate: PlannedTemplate,
  other: PlannedTemplate,
): boolean {
  const otherById = new Map(other.assignments.map((assignment) => [assignment.modelId, assignment]))
  let strictlyBetter = false
  for (const assignment of candidate.assignments) {
    const otherAssignment = otherById.get(assignment.modelId)
    if (!otherAssignment) return false
    const candidateProgress = distanceBetween(assignment.start, request.target)
      - distanceBetween(assignment.destination, request.target)
    const otherProgress = distanceBetween(otherAssignment.start, request.target)
      - distanceBetween(otherAssignment.destination, request.target)
    if (candidateProgress < otherProgress - GEOMETRY_EPSILON) return false
    if (candidateProgress > otherProgress + GEOMETRY_EPSILON) strictlyBetter = true
  }
  return strictlyBetter
}

function planCommonMaximumTranslation(
  request: SmartMoveRequest,
  unit: Unit,
  selectedModels: ReadonlyArray<TabletopModel>,
  strategyIndex: number,
  metrics: SolverMetrics,
): PlannedTemplate | TemplateFailure | null {
  if (selectedModels.length !== unit.modelIds.length
    || !unit.modelIds.every((id) => selectedModels.some((model) => model.id === id))) return null
  const remaining = selectedModels.map((model) => remainingFor(request, model.id))
  const commonMovement = remaining[0] ?? 0
  if (commonMovement <= GEOMETRY_EPSILON
    || remaining.some((value) => Math.abs(value - commonMovement) > GEOMETRY_EPSILON)) return null

  const centroid = pointsCentroid(selectedModels.map((model) => model.position))
  const targetDistance = distanceBetween(centroid, request.target)
  if (targetDistance <= commonMovement + GEOMETRY_EPSILON
    || selectedModels.some((model) => distanceBetween(model.position, request.target) <= commonMovement + GEOMETRY_EPSILON)) return null
  const translation = {
    x: (request.target.x - centroid.x) / targetDistance,
    y: (request.target.y - centroid.y) / targetDistance,
  }
  const commonAdvance = Math.min(
    commonMovement,
    ...selectedModels.map((model) => maximumBattlefieldAdvance(model, translation, request.battlefield)),
  )
  if (commonAdvance <= GEOMETRY_EPSILON) return null
  translation.x *= commonAdvance
  translation.y *= commonAdvance
  const selectedIdSet = new Set(selectedModels.map((model) => model.id))
  const stationaryObstacles = request.allModels.filter((model) => !selectedIdSet.has(model.id))
  const positions: Record<string, Point> = {}
  const assignments: SmartMoveAssignment[] = []

  for (let index = 0; index < selectedModels.length; index += 1) {
    const model = selectedModels[index]
    const destination = {
      x: model.position.x + translation.x,
      y: model.position.y + translation.y,
    }
    const path = findDirectPath({ model, destination, obstacles: stationaryObstacles, battlefield: request.battlefield,
      terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
      ...pathSeparationFor(request, model.id) }, metrics)
    if (!path || path.path.length !== 2 || Math.abs(path.distance - commonAdvance) > GEOMETRY_EPSILON) {
      return { reasons: [path ? 'COLLISION' : fastPathFailureReason(model, destination, request)] }
    }
    positions[model.id] = destination
    assignments.push({
      modelId: model.id,
      slotIndex: index,
      start: { ...model.position },
      destination: { ...destination },
      path: path.path.map((point) => ({ ...point })),
      movementCost: path.distance,
      movementRemaining: commonMovement,
    })
  }
  return validateFastPathPlan(request, unit, positions, assignments, strategyIndex, metrics)
}

function planDirectMaximumProgress(
  request: SmartMoveRequest,
  unit: Unit,
  selectedModels: ReadonlyArray<TabletopModel>,
  strategyIndex: number,
  metrics: SolverMetrics,
): PlannedTemplate | TemplateFailure {
  const movingIds = new Set(selectedModels
    .filter((model) => remainingFor(request, model.id) > GEOMETRY_EPSILON
      && distanceBetween(model.position, request.target) > GEOMETRY_EPSILON)
    .map((model) => model.id))
  const stationaryObstacles = request.allModels.filter((model) => !movingIds.has(model.id))
  const positions: Record<string, Point> = {}
  const assignments: SmartMoveAssignment[] = []

  for (let index = 0; index < selectedModels.length; index += 1) {
    const model = selectedModels[index]
    const remaining = remainingFor(request, model.id)
    const destination = maximumDirectProgressPosition(request, model)
    const advance = distanceBetween(model.position, destination)
    const path = findDirectPath({ model, destination, obstacles: stationaryObstacles, battlefield: request.battlefield,
      terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
      ...pathSeparationFor(request, model.id) }, metrics)
    if (!path || (advance > GEOMETRY_EPSILON && path.path.length !== 2)) {
      return { reasons: [path ? 'COLLISION' : fastPathFailureReason(model, destination, request)] }
    }
    positions[model.id] = destination
    assignments.push({
      modelId: model.id,
      slotIndex: index,
      start: { ...model.position },
      destination: { ...destination },
      path: path.path.map((point) => ({ ...point })),
      movementCost: path.distance,
      movementRemaining: remaining,
    })
  }

  if (hasSimultaneousSelectedPathCollision(selectedModels, positions)) {
    return { reasons: ['COLLISION'] }
  }
  return validateFastPathPlan(request, unit, positions, assignments, strategyIndex, metrics)
}

function hasSimultaneousSelectedPathCollision(
  selectedModels: ReadonlyArray<TabletopModel>,
  positions: Readonly<Record<string, Point>>,
): boolean {
  const allCircles = selectedModels.every((model) => model.base.shape === 'circle')
  for (let sourceIndex = 0; sourceIndex < selectedModels.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < selectedModels.length; targetIndex += 1) {
      const source = selectedModels[sourceIndex]
      const target = selectedModels[targetIndex]
      const relativeStart = {
        x: source.position.x - target.position.x,
        y: source.position.y - target.position.y,
      }
      const relativeEnd = {
        x: positions[source.id].x - positions[target.id].x,
        y: positions[source.id].y - positions[target.id].y,
      }
      if (allCircles) {
        if (firstCirclePathCollisionT(
          relativeStart,
          relativeEnd,
          { x: 0, y: 0 },
          baseRadiusInches(source.base) + baseRadiusInches(target.base),
        ) !== null) return true
        continue
      }
      if (sweepFootprintTranslation(
        source.base,
        { position: relativeStart, rotation: source.rotation },
        { x: relativeEnd.x - relativeStart.x, y: relativeEnd.y - relativeStart.y },
        target.base,
        { position: { x: 0, y: 0 }, rotation: target.rotation },
      ) !== null) return true
    }
  }
  return false
}

function validateFastPathPlan(
  request: SmartMoveRequest,
  unit: Unit,
  positions: Record<string, Point>,
  assignments: SmartMoveAssignment[],
  strategyIndex: number,
  metrics: SolverMetrics,
): PlannedTemplate | TemplateFailure {
  if (request.coherencyPolicy) metrics.coherencyEvaluations += 1
  const validation = validateCandidateFormation({
    allModels: request.allModels,
    battlefield: request.battlefield,
    terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
    separationConstraints: request.separationConstraints,
    destinationConstraints: request.destinationConstraints,
    positions,
    reachability: {
      movementCosts: Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementCost])),
      movementAllowances: Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementRemaining])),
    },
    ...(request.coherencyPolicy ? { coherency: { unit, policy: request.coherencyPolicy } } : {}),
  })
  if (!validation.valid) {
    const failures = new Set<SmartMoveFailureReason>()
    addValidationFailures(validation, failures)
    return { reasons: [...failures] }
  }
  const projected = projectCandidateModels(request.allModels, positions)
  if (request.coherencyPolicy) metrics.coherencyEvaluations += 1
  return {
    positions,
    assignments: assignments.sort((a, b) => a.modelId.localeCompare(b.modelId)),
    validation,
    coherency: request.coherencyPolicy
      ? evaluateUnitCoherency(unit, projected, request.coherencyPolicy)
      : null,
    score: candidateScore(request, assignments, positions, strategyIndex),
  }
}

function fastPathFailureReason(
  model: TabletopModel,
  destination: Point,
  request: SmartMoveRequest,
): SmartMoveFailureReason {
  return isModelPositionInsideBattlefield(destination, model, request.battlefield)
    ? 'COLLISION'
    : 'BATTLEFIELD'
}

function planTargetOrderedFallback(
  request: SmartMoveRequest,
  unit: Unit,
  selectedModels: ReadonlyArray<TabletopModel>,
  metrics: SolverMetrics,
): TargetOrderedFallbackResult {
  const orderingStartedAt = nowMilliseconds()
  const selectedIdSet = new Set(selectedModels.map((model) => model.id))
  const movable = selectedModels
    .filter((model) => remainingFor(request, model.id) > GEOMETRY_EPSILON)
    .sort((left, right) => {
      const distanceOrder = distanceBetween(left.position, request.target)
        - distanceBetween(right.position, request.target)
      return Math.abs(distanceOrder) > GEOMETRY_EPSILON
        ? distanceOrder
        : left.id.localeCompare(right.id)
    })
  metrics.fallbackOrder = movable.map((model) => model.id)
  metrics.fallbackOrderingMs += nowMilliseconds() - orderingStartedAt

  const positions: Record<string, Point> = {}
  const assignmentsById = new Map<string, SmartMoveAssignment>()
  for (let index = 0; index < selectedModels.length; index += 1) {
    const model = selectedModels[index]
    if (remainingFor(request, model.id) > GEOMETRY_EPSILON) continue
    positions[model.id] = { ...model.position }
    assignmentsById.set(model.id, stationaryAssignment(model, index, request))
  }

  const fixedAnchorIds = new Set(unit.modelIds.filter((id) => (
    !selectedIdSet.has(id) || remainingFor(request, id) <= GEOMETRY_EPSILON
  )))
  const placedIds = new Set(assignmentsById.keys())
  const failures = new Set<SmartMoveFailureReason>()
  let best: PlannedTemplate | null = null
  let completeCandidatesTested = 0
  let stableOrder = 0
  let effectivelyOptimal = false
  let greedyLargeUnitSolutionFound = false
  let alternativeLimit = selectedModels.length >= 15 ? 1 : SMART_MOVE_FALLBACK_MAX_ALTERNATIVES

  const search = (modelIndex: number) => {
    if (effectivelyOptimal
      || greedyLargeUnitSolutionFound
      || nowMilliseconds() >= metrics.deadlineAt
      || metrics.backtrackingNodes >= SMART_MOVE_FALLBACK_MAX_BACKTRACKING_NODES
      || completeCandidatesTested >= SMART_MOVE_FALLBACK_MAX_COMPLETE_CANDIDATES) {
      metrics.searchBudgetExhausted = true
      return
    }
    metrics.backtrackingNodes += 1

    if (modelIndex >= movable.length) {
      completeCandidatesTested += 1
      const totalProgress = [...assignmentsById.values()].reduce((total, assignment) => (
        total
        + distanceBetween(assignment.start, request.target)
        - distanceBetween(assignment.destination, request.target)
      ), 0)
      if (movable.length > 0 && totalProgress <= GEOMETRY_EPSILON) {
        failures.add('NO_REACHABLE_FORMATION')
        return
      }
      metrics.finalValidations += 1
      const assignments = [...assignmentsById.values()].sort((a, b) => a.modelId.localeCompare(b.modelId))
      const validationStartedAt = nowMilliseconds()
      const validation = validateCompleteFallbackCandidate(request, unit, positions, assignments, metrics)
      metrics.finalValidationMs += nowMilliseconds() - validationStartedAt
      if ('reasons' in validation) {
        validation.reasons.forEach((reason) => failures.add(reason))
        return
      }
      const scoringStartedAt = nowMilliseconds()
      const score = candidateScore(request, assignments, positions, stableOrder)
      metrics.candidateScoringMs += nowMilliseconds() - scoringStartedAt
      const planned: PlannedTemplate = {
        positions: copyPositions(positions),
        assignments: assignments.map(copyAssignment),
        validation: validation.validation,
        coherency: validation.coherency,
        score,
      }
      stableOrder += 1
      if (!best || compareScores(planned.score, best.score) < 0) best = planned
      if (isEffectivelyMaximumProgress(request, assignments, positions)) effectivelyOptimal = true
      if (selectedModels.length >= 15 && alternativeLimit === 1) greedyLargeUnitSolutionFound = true
      return
    }

    const model = movable[modelIndex]
    const slotIndex = selectedModels.findIndex((candidate) => candidate.id === model.id)
    const candidates = generateTargetOrderedCandidates(
      request,
      unit,
      model,
      slotIndex,
      positions,
      placedIds,
      fixedAnchorIds,
      movable.slice(modelIndex + 1),
      detourCandidateLimitFor(request, selectedModels),
      metrics,
    )
    if (candidates.length === 0) {
      failures.add(pathBudgetExhausted(metrics)
        ? 'SEARCH_LIMIT'
        : 'NO_REACHABLE_FORMATION')
      return
    }

    for (const assignment of selectFallbackAlternatives(candidates, alternativeLimit)) {
      positions[model.id] = { ...assignment.destination }
      assignmentsById.set(model.id, assignment)
      placedIds.add(model.id)
      const coherencyStartedAt = nowMilliseconds()
      const canComplete = provisionalCoherencyCanStillComplete(
        request,
        unit,
        positions,
        placedIds,
        fixedAnchorIds,
        movable.length - modelIndex - 1,
      )
      metrics.provisionalCoherencyMs += nowMilliseconds() - coherencyStartedAt
      if (canComplete) search(modelIndex + 1)
      placedIds.delete(model.id)
      assignmentsById.delete(model.id)
      delete positions[model.id]
      if (effectivelyOptimal || greedyLargeUnitSolutionFound || (metrics.searchBudgetExhausted && best)) break
    }
  }

  search(0)
  if (!best && selectedModels.length >= 15 && !metrics.searchBudgetExhausted) {
    alternativeLimit = 3
    search(0)
  }
  if (!best && failures.size === 0) failures.add('NO_REACHABLE_FORMATION')
  if (metrics.searchBudgetExhausted) failures.add('SEARCH_LIMIT')
  return { planned: best, reasons: [...failures], completeCandidatesTested }
}

function generateTargetOrderedCandidates(
  request: SmartMoveRequest,
  unit: Unit,
  model: TabletopModel,
  slotIndex: number,
  positions: Readonly<Record<string, Point>>,
  placedIds: ReadonlySet<string>,
  fixedAnchorIds: ReadonlySet<string>,
  futureModels: ReadonlyArray<TabletopModel>,
  detourCandidateLimit: number,
  metrics: SolverMetrics,
): SmartMoveAssignment[] {
  const projectedModels = projectCandidateModels(request.allModels, positions)
  const projectedById = new Map(projectedModels.map((candidate) => [candidate.id, candidate]))
  const currentModel = projectedById.get(model.id) ?? model
  const obstacles = projectedModels.filter((candidate) => candidate.id !== model.id)
  const anchors = unit.modelIds
    .filter((id) => placedIds.has(id) || fixedAnchorIds.has(id))
    .flatMap((id) => {
      const anchor = projectedById.get(id)
      return anchor ? [anchor] : []
    })
  const futureGuides = futureModels.map((futureModel) => ({
    model: futureModel,
    position: maximumDirectProgressPosition(request, futureModel),
  }))
  const generationStartedAt = nowMilliseconds()
  const rawPositions = generateMeaningfulPositions(request, currentModel, anchors, futureGuides)
  metrics.candidateGenerationMs += nowMilliseconds() - generationStartedAt
  metrics.candidatePositionsGenerated += rawPositions.length
  const deduplicationStartedAt = nowMilliseconds()
  const deduplicated = deduplicatePoints(rawPositions)
    .sort((left, right) => compareCandidatePoints(left, right, request.target))
  metrics.candidateDeduplicationMs += nowMilliseconds() - deduplicationStartedAt
  metrics.candidatePositionsDeduplicated += deduplicated.length
  const collisionStartedAt = nowMilliseconds()
  const viableDestinations = deduplicated
    .filter((destination) => isModelPositionInsideBattlefield(destination, model, request.battlefield))
    .filter((destination) => terrainDestinationLegal(model, poseForModel(model, destination),
      request.terrainFeatures, request.terrainPolicy))
    .filter((destination) => !obstacles.some((obstacle) => modelsOverlapAt(
      model,
      destination,
      obstacle,
    )))
    .slice(0, SMART_MOVE_FALLBACK_MAX_RAW_POSITIONS)
  metrics.collisionFilteringMs += nowMilliseconds() - collisionStartedAt

  const reachable: Array<SmartMoveAssignment & { anchorPotential: number; progress: number }> = []
  const remaining = remainingFor(request, model.id)
  const pathPlanner = createModelPathPlanner()
  let detourCandidatesTested = 0
  const evaluatedIndexes = new Set<number>()
  const evaluateDestination = (index: number) => {
    if (evaluatedIndexes.has(index)) return
    evaluatedIndexes.add(index)
    const destination = viableDestinations[index]
    if (!destination) return
    if (pathBudgetExhausted(metrics)) {
      metrics.searchBudgetExhausted = true
      return
    }
    const pathRequest = {
      model: currentModel,
      destination,
      obstacles,
      battlefield: request.battlefield,
      terrainFeatures: request.terrainFeatures,
      terrainPolicy: request.terrainPolicy,
      ...pathSeparationFor(request, model.id),
    }
    let foundPath = findDirectPath(pathRequest, metrics)
    if (!foundPath && detourCandidatesTested < detourCandidateLimit) {
      detourCandidatesTested += 1
      foundPath = findPath(pathRequest, metrics, pathPlanner)
    }
    if (!foundPath) return
    const path = foundPath.distance > remaining + GEOMETRY_EPSILON
      ? truncatePath(foundPath, remaining)
      : foundPath
    if (!path || path.distance > remaining + GEOMETRY_EPSILON) return
    const finalPosition = path.path.at(-1)!
    if (!isModelPositionInsideBattlefield(finalPosition, model, request.battlefield)) return
    if (!terrainDestinationLegal(model, poseForModel(model, finalPosition),
      request.terrainFeatures, request.terrainPolicy)) return
    if (obstacles.some((obstacle) => modelsOverlapAt(model, finalPosition, obstacle))) return
    const progress = distanceBetween(model.position, request.target)
      - distanceBetween(finalPosition, request.target)
    if (progress < -GEOMETRY_EPSILON) return
    reachable.push({
      modelId: model.id,
      slotIndex,
      start: { ...model.position },
      destination: { ...finalPosition },
      path: path.path.map((point) => ({ ...point })),
      movementCost: path.distance,
      movementRemaining: remaining,
      anchorPotential: anchors.filter((anchor) => modelsAreCoherentNeighbors(model, finalPosition, anchor, request.coherencyPolicy)).length,
      progress,
    })
  }
  for (let index = 0; index < viableDestinations.length; index += 1) {
    evaluateDestination(index)
    if (metrics.searchBudgetExhausted
      || reachable.length >= SMART_MOVE_FALLBACK_MAX_REACHABLE_CANDIDATES) break
  }
  if (!metrics.searchBudgetExhausted && viableDestinations.length > 0) {
    const last = viableDestinations.length - 1
    for (const index of [Math.floor(last / 2), Math.floor(last * 2 / 3), last]) {
      evaluateDestination(index)
      if (metrics.searchBudgetExhausted) break
    }
  }

  const uniqueReachable = deduplicateAssignments(reachable)
  uniqueReachable.sort((left, right) => {
    const progressOrder = right.progress - left.progress
    if (Math.abs(progressOrder) > GEOMETRY_EPSILON) return progressOrder
    const anchorOrder = right.anchorPotential - left.anchorPotential
    if (anchorOrder !== 0) return anchorOrder
    const costOrder = left.movementCost - right.movementCost
    if (Math.abs(costOrder) > GEOMETRY_EPSILON) return costOrder
    const xOrder = left.destination.x - right.destination.x
    return Math.abs(xOrder) > GEOMETRY_EPSILON ? xOrder : left.destination.y - right.destination.y
  })
  return uniqueReachable
}

function generateMeaningfulPositions(
  request: SmartMoveRequest,
  model: TabletopModel,
  anchors: ReadonlyArray<TabletopModel>,
  futureGuides: ReadonlyArray<{ model: TabletopModel; position: Point }>,
): Point[] {
  const positions: Point[] = []
  const targetDistance = distanceBetween(model.position, request.target)
  const maximumAdvance = Math.min(remainingFor(request, model.id), targetDistance)
  if (targetDistance <= GEOMETRY_EPSILON) positions.push({ ...model.position })
  else {
    const direction = {
      x: (request.target.x - model.position.x) / targetDistance,
      y: (request.target.y - model.position.y) / targetDistance,
    }
    for (const fraction of FALLBACK_PROGRESS_FRACTIONS) {
      positions.push({
        x: model.position.x + direction.x * maximumAdvance * fraction,
        y: model.position.y + direction.y * maximumAdvance * fraction,
      })
    }
  }

  if (!request.coherencyPolicy) return positions
  const allRelationshipModelsAreCircles = model.base.shape === 'circle'
    && anchors.every((anchor) => anchor.base.shape === 'circle')
    && futureGuides.every((guide) => guide.model.base.shape === 'circle')
  if (allRelationshipModelsAreCircles) {
    appendCircularRelationshipCandidates(
      positions,
      request,
      model,
      anchors,
      futureGuides,
    )
    return positions
  }

  const relationshipAnchors = anchors.slice(0, MAX_GENERIC_RELATIONSHIP_ANCHORS)
  const outlines = relationshipAnchors.map((anchor) => footprintExclusionOutline(
    anchor.base,
    poseForModel(anchor),
    model.base,
    model.rotation,
    request.coherencyPolicy!.distance,
    GENERIC_RELATIONSHIP_SAMPLES,
  ))
  for (const outline of outlines) positions.push(...outline)
  for (let sourceIndex = 0; sourceIndex < outlines.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < outlines.length; targetIndex += 1) {
      positions.push(...closedOutlineIntersections(outlines[sourceIndex], outlines[targetIndex]))
    }
  }
  for (const guide of futureGuides.slice(0, MAX_GENERIC_RELATIONSHIP_ANCHORS)) {
    const projectedGuide = { ...guide.model, position: guide.position }
    positions.push(...footprintExclusionOutline(
      projectedGuide.base,
      poseForModel(projectedGuide),
      model.base,
      model.rotation,
      request.coherencyPolicy.distance,
      GENERIC_RELATIONSHIP_SAMPLES,
    ))
  }
  return positions
}

function appendCircularRelationshipCandidates(
  positions: Point[],
  request: SmartMoveRequest,
  model: TabletopModel,
  anchors: ReadonlyArray<TabletopModel>,
  futureGuides: ReadonlyArray<{ model: TabletopModel; position: Point }>,
): void {
  const policy = request.coherencyPolicy
  if (!policy) return
  const modelRadius = baseRadiusInches(model.base)
  for (const anchor of anchors) {
    const relationshipRadius = modelRadius + baseRadiusInches(anchor.base) + policy.distance
    const targetAngle = Math.atan2(
      request.target.y - anchor.position.y,
      request.target.x - anchor.position.x,
    )
    for (const offset of [0, Math.PI / 3, -Math.PI / 3, Math.PI * 2 / 3, -Math.PI * 2 / 3, Math.PI]) {
      positions.push({
        x: anchor.position.x + Math.cos(targetAngle + offset) * relationshipRadius,
        y: anchor.position.y + Math.sin(targetAngle + offset) * relationshipRadius,
      })
    }
  }
  for (let sourceIndex = 0; sourceIndex < anchors.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < anchors.length; targetIndex += 1) {
      const source = anchors[sourceIndex]
      const target = anchors[targetIndex]
      positions.push(...circleIntersections(
        source.position,
        modelRadius + baseRadiusInches(source.base) + policy.distance,
        target.position,
        modelRadius + baseRadiusInches(target.base) + policy.distance,
      ))
    }
  }
  for (const guide of futureGuides) {
    const relationshipRadius = modelRadius + baseRadiusInches(guide.model.base) + policy.distance
    const targetAngle = directionAngle(guide.position, request.target, model.position)
    for (const offset of [0, Math.PI / 3, -Math.PI / 3]) {
      positions.push({
        x: guide.position.x + Math.cos(targetAngle + offset) * relationshipRadius,
        y: guide.position.y + Math.sin(targetAngle + offset) * relationshipRadius,
      })
    }
  }
}

function maximumDirectProgressPosition(
  request: SmartMoveRequest,
  model: TabletopModel,
): Point {
  const targetDistance = distanceBetween(model.position, request.target)
  if (targetDistance <= GEOMETRY_EPSILON) return { ...model.position }
  const direction = {
    x: (request.target.x - model.position.x) / targetDistance,
    y: (request.target.y - model.position.y) / targetDistance,
  }
  const advance = Math.min(
    targetDistance,
    remainingFor(request, model.id),
    maximumBattlefieldAdvance(model, direction, request.battlefield),
  )
  return {
    x: model.position.x + direction.x * advance,
    y: model.position.y + direction.y * advance,
  }
}

function maximumBattlefieldAdvance(
  model: TabletopModel,
  direction: Point,
  battlefield: Battlefield,
): number {
  const bounds = footprintBounds(model.base, poseForModel(model))
  const leftExtent = model.position.x - bounds.left
  const rightExtent = bounds.right - model.position.x
  const topExtent = model.position.y - bounds.top
  const bottomExtent = bounds.bottom - model.position.y
  let maximum = Number.POSITIVE_INFINITY
  if (direction.x > GEOMETRY_EPSILON) {
    maximum = Math.min(maximum, (battlefield.width - rightExtent - model.position.x) / direction.x)
  } else if (direction.x < -GEOMETRY_EPSILON) {
    maximum = Math.min(maximum, (leftExtent - model.position.x) / direction.x)
  }
  if (direction.y > GEOMETRY_EPSILON) {
    maximum = Math.min(maximum, (battlefield.height - bottomExtent - model.position.y) / direction.y)
  } else if (direction.y < -GEOMETRY_EPSILON) {
    maximum = Math.min(maximum, (topExtent - model.position.y) / direction.y)
  }
  return Math.max(0, maximum)
}

function isEffectivelyMaximumProgress(
  request: SmartMoveRequest,
  assignments: ReadonlyArray<SmartMoveAssignment>,
  positions: Readonly<Record<string, Point>>,
): boolean {
  return assignments.every((assignment) => {
    const startDistance = distanceBetween(assignment.start, request.target)
    const maximumUseful = Math.min(startDistance, assignment.movementRemaining)
    const destination = positions[assignment.modelId] ?? assignment.destination
    const actual = startDistance - distanceBetween(destination, request.target)
    return maximumUseful - actual <= SMART_MOVE_EFFECTIVE_PROGRESS_TOLERANCE
  })
}

function directionAngle(origin: Point, target: Point, fallback: Point): number {
  if (distanceBetween(origin, target) > GEOMETRY_EPSILON) {
    return Math.atan2(target.y - origin.y, target.x - origin.x)
  }
  if (distanceBetween(origin, fallback) > GEOMETRY_EPSILON) {
    return Math.atan2(origin.y - fallback.y, origin.x - fallback.x)
  }
  return 0
}

function validateCompleteFallbackCandidate(
  request: SmartMoveRequest,
  unit: Unit,
  positions: Readonly<Record<string, Point>>,
  assignments: ReadonlyArray<SmartMoveAssignment>,
  metrics: SolverMetrics,
): { validation: CandidateFormationResult; coherency: CoherencyResult | null } | TemplateFailure {
  if (request.coherencyPolicy) metrics.coherencyEvaluations += 1
  const validation = validateCandidateFormation({
    allModels: request.allModels,
    battlefield: request.battlefield,
    terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
    separationConstraints: request.separationConstraints,
    destinationConstraints: request.destinationConstraints,
    positions,
    reachability: {
      movementCosts: Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementCost])),
      movementAllowances: Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementRemaining])),
    },
    ...(request.coherencyPolicy ? { coherency: { unit, policy: request.coherencyPolicy } } : {}),
  })
  if (!validation.valid) {
    const failures = new Set<SmartMoveFailureReason>()
    addValidationFailures(validation, failures)
    return { reasons: [...failures] }
  }
  const projected = projectCandidateModels(request.allModels, positions)
  if (request.coherencyPolicy) metrics.coherencyEvaluations += 1
  return {
    validation,
    coherency: request.coherencyPolicy
      ? evaluateUnitCoherency(unit, projected, request.coherencyPolicy)
      : null,
  }
}

function provisionalCoherencyCanStillComplete(
  request: SmartMoveRequest,
  unit: Unit,
  positions: Readonly<Record<string, Point>>,
  placedIds: ReadonlySet<string>,
  fixedAnchorIds: ReadonlySet<string>,
  remainingModels: number,
): boolean {
  const policy = request.coherencyPolicy
  if (!policy || policy.requiredNeighbors <= 0) return true
  const projected = projectCandidateModels(request.allModels, positions)
  const byId = new Map(projected.map((model) => [model.id, model]))
  const resolvedIds = unit.modelIds.filter((id) => placedIds.has(id) || fixedAnchorIds.has(id))
  return resolvedIds.every((id) => {
    const model = byId.get(id)
    if (!model) return false
    const resolvedNeighbors = resolvedIds.filter((otherId) => {
      if (otherId === id) return false
      const other = byId.get(otherId)
      return Boolean(other && modelsAreCoherentNeighbors(model, model.position, other, policy))
    }).length
    return resolvedNeighbors + remainingModels >= policy.requiredNeighbors
  })
}

function planTemplate(
  request: SmartMoveRequest,
  unit: Unit,
  selectedModels: ReadonlyArray<TabletopModel>,
  slots: ReadonlyArray<Point>,
  templateIndex: number,
  preferSmallerBases: boolean,
  metrics: SolverMetrics,
): PlannedTemplate | TemplateFailure {
  const strategies = [
    { order: 'nearest' as const, reverseIds: false, slotRank: 0 },
    { order: 'farthest' as const, reverseIds: false, slotRank: 0 },
    { order: 'id' as const, reverseIds: false, slotRank: 0 },
    { order: 'id' as const, reverseIds: true, slotRank: 0 },
    { order: 'id' as const, reverseIds: false, slotRank: 1 },
  ]
  const failures = new Set<SmartMoveFailureReason>()
  let best: PlannedTemplate | null = null

  for (let strategyIndex = 0; strategyIndex < strategies.length; strategyIndex += 1) {
    const strategy = strategies[strategyIndex]
    const assigned = assignModelsToSlots(
      request,
      selectedModels,
      slots,
      preferSmallerBases,
      strategy.order,
      strategy.reverseIds,
      strategy.slotRank,
      metrics,
    )
    if ('reasons' in assigned) {
      assigned.reasons.forEach((reason) => failures.add(reason))
      continue
    }
    const { positions, assignments } = assigned
    const movementCosts = Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementCost]))
    const movementAllowances = Object.fromEntries(assignments.map((assignment) => [assignment.modelId, assignment.movementRemaining]))
    if (request.coherencyPolicy) metrics.coherencyEvaluations += 1
    const validation = validateCandidateFormation({
      allModels: request.allModels,
      battlefield: request.battlefield,
      terrainFeatures: request.terrainFeatures, terrainPolicy: request.terrainPolicy,
      separationConstraints: request.separationConstraints,
      destinationConstraints: request.destinationConstraints,
      positions,
      reachability: { movementCosts, movementAllowances },
      ...(request.coherencyPolicy
        ? { coherency: {
          unit,
          policy: request.coherencyPolicy,
          requireConnected: request.coherencyPolicy.requireConnected,
        } }
        : {}),
    })
    const projected = projectCandidateModels(request.allModels, positions)
    if (request.coherencyPolicy) metrics.coherencyEvaluations += 1
    const coherency = request.coherencyPolicy
      ? evaluateUnitCoherency(unit, projected, request.coherencyPolicy)
      : null
    if (!validation.valid) {
      addValidationFailures(validation, failures)
      continue
    }

    const planned: PlannedTemplate = {
      positions,
      assignments: assignments.sort((a, b) => a.modelId.localeCompare(b.modelId)),
      validation,
      coherency,
      score: candidateScore(
        request,
        assignments,
        positions,
        templateIndex * strategies.length + strategyIndex + 100,
      ),
    }
    if (selectedModels.length >= 10) return planned
    if (!best || compareScores(planned.score, best.score) < 0) best = planned
  }

  return best ?? { reasons: [...failures] }
}

function assignModelsToSlots(
  request: SmartMoveRequest,
  selectedModels: ReadonlyArray<TabletopModel>,
  slots: ReadonlyArray<Point>,
  preferSmallerBases: boolean,
  order: 'id' | 'nearest' | 'farthest',
  reverseIds: boolean,
  preferredSlotRank: number,
  metrics: SolverMetrics,
): { positions: Record<string, Point>; assignments: SmartMoveAssignment[] } | TemplateFailure {
  const positions: Record<string, Point> = {}
  const assignments: SmartMoveAssignment[] = []
  const availableSlots = new Set(slots.map((_, index) => index))
  const modelOrder = [...selectedModels].sort((a, b) => {
    const remainingOrder = remainingFor(request, a.id) - remainingFor(request, b.id)
    if (Math.abs(remainingOrder) > GEOMETRY_EPSILON) return remainingOrder
    const sizeOrder = preferSmallerBases
      ? footprintCircumradiusInches(a.base) - footprintCircumradiusInches(b.base)
      : footprintCircumradiusInches(b.base) - footprintCircumradiusInches(a.base)
    if (Math.abs(sizeOrder) > GEOMETRY_EPSILON) return sizeOrder
    if (order === 'nearest' || order === 'farthest') {
      const targetOrder = distanceBetween(b.position, request.target)
        - distanceBetween(a.position, request.target)
      if (Math.abs(targetOrder) > GEOMETRY_EPSILON) {
        return order === 'farthest' ? targetOrder : -targetOrder
      }
    }
    return (reverseIds ? -1 : 1) * a.id.localeCompare(b.id)
  })

  for (const model of modelOrder) {
    const obstacles = request.allModels
      .filter((candidate) => candidate.id !== model.id)
      .map((candidate) => positions[candidate.id]
        ? { ...candidate, position: { ...positions[candidate.id] } }
        : candidate)
    const remaining = remainingFor(request, model.id)
    const pathPlanner = createModelPathPlanner()
    let detourCandidatesTested = 0
    const detourCandidateLimit = detourCandidateLimitFor(request, selectedModels)
    const options = [...availableSlots]
      .map((slotIndex) => ({ slotIndex, destination: slots[slotIndex] }))
      .sort((a, b) => {
        const distanceOrder = distanceBetween(model.position, a.destination)
          - distanceBetween(model.position, b.destination)
        return Math.abs(distanceOrder) > GEOMETRY_EPSILON ? distanceOrder : a.slotIndex - b.slotIndex
      })

    const reachableOptions: SmartMoveAssignment[] = []
    let sawInside = false
    let sawCollisionFree = false
    let sawPath = false
    for (const option of options) {
      if (pathBudgetExhausted(metrics)) {
        metrics.searchBudgetExhausted = true
        return { reasons: ['SEARCH_LIMIT'] }
      }
      if (!isModelPositionInsideBattlefield(option.destination, model, request.battlefield)) continue
      if (!terrainDestinationLegal(model, poseForModel(model, option.destination),
        request.terrainFeatures, request.terrainPolicy)) continue
      sawInside = true
      if (obstacles.some((obstacle) => modelsOverlapAt(model, option.destination, obstacle))) continue
      sawCollisionFree = true
      const pathRequest = {
        model,
        destination: option.destination,
        obstacles,
        battlefield: request.battlefield,
        terrainFeatures: request.terrainFeatures,
        terrainPolicy: request.terrainPolicy,
        ...pathSeparationFor(request, model.id),
      }
      let path = findDirectPath(pathRequest, metrics)
      if (!path && detourCandidatesTested < detourCandidateLimit) {
        detourCandidatesTested += 1
        path = findPath(pathRequest, metrics, pathPlanner)
      }
      if (!path) continue
      sawPath = true
      if (path.distance > remaining + GEOMETRY_EPSILON) continue
      const assignment: SmartMoveAssignment = {
        modelId: model.id,
        slotIndex: option.slotIndex,
        start: { ...model.position },
        destination: { ...option.destination },
        path: path.path.map((point) => ({ ...point })),
        movementCost: path.distance,
        movementRemaining: remaining,
      }
      reachableOptions.push(assignment)
    }

    if (reachableOptions.length === 0) {
      const reasons: SmartMoveFailureReason[] = []
      if (!sawInside) reasons.push('BATTLEFIELD')
      else if (!sawCollisionFree) reasons.push('COLLISION')
      else if (!sawPath) reasons.push('COLLISION')
      else reasons.push('MOVEMENT_LIMIT')
      return { reasons }
    }
    reachableOptions.sort((a, b) => {
      const costOrder = a.movementCost - b.movementCost
      return Math.abs(costOrder) > GEOMETRY_EPSILON ? costOrder : a.slotIndex - b.slotIndex
    })
    const bestOption = reachableOptions[Math.min(preferredSlotRank, reachableOptions.length - 1)]
    positions[model.id] = { ...bestOption.destination }
    assignments.push(bestOption)
    availableSlots.delete(bestOption.slotIndex)
  }
  return { positions, assignments }
}

function stationaryAssignment(
  model: TabletopModel,
  slotIndex: number,
  request: SmartMoveRequest,
): SmartMoveAssignment {
  return {
    modelId: model.id,
    slotIndex,
    start: { ...model.position },
    destination: { ...model.position },
    path: [{ ...model.position }],
    movementCost: 0,
    movementRemaining: remainingFor(request, model.id),
  }
}

function copyPositions(positions: Readonly<Record<string, Point>>): Record<string, Point> {
  return Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, { ...position }]))
}

function copyAssignment(assignment: SmartMoveAssignment): SmartMoveAssignment {
  return {
    modelId: assignment.modelId,
    slotIndex: assignment.slotIndex,
    start: { ...assignment.start },
    destination: { ...assignment.destination },
    path: assignment.path.map((point) => ({ ...point })),
    movementCost: assignment.movementCost,
    movementRemaining: assignment.movementRemaining,
  }
}

function compareCandidatePoints(left: Point, right: Point, target: Point): number {
  const progressOrder = distanceBetween(left, target) - distanceBetween(right, target)
  if (Math.abs(progressOrder) > GEOMETRY_EPSILON) return progressOrder
  const xOrder = left.x - right.x
  return Math.abs(xOrder) > GEOMETRY_EPSILON ? xOrder : left.y - right.y
}

function deduplicatePoints(points: ReadonlyArray<Point>): Point[] {
  const unique: Point[] = []
  const cells = new Map<string, Point[]>()
  const coordinate = (value: number) => Math.floor(value / SMART_MOVE_CANDIDATE_DEDUPLICATION_TOLERANCE)
  for (const point of points) {
    const cellX = coordinate(point.x)
    const cellY = coordinate(point.y)
    let duplicate = false
    for (let offsetX = -1; offsetX <= 1 && !duplicate; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1 && !duplicate; offsetY += 1) {
        const candidates = cells.get(`${cellX + offsetX},${cellY + offsetY}`) ?? []
        duplicate = candidates.some((candidate) => distanceBetween(candidate, point)
          <= SMART_MOVE_CANDIDATE_DEDUPLICATION_TOLERANCE)
      }
    }
    if (duplicate) continue
    const copy = { ...point }
    unique.push(copy)
    const key = `${cellX},${cellY}`
    const cell = cells.get(key)
    if (cell) cell.push(copy)
    else cells.set(key, [copy])
  }
  return unique
}

function deduplicateAssignments<T extends SmartMoveAssignment>(assignments: ReadonlyArray<T>): T[] {
  const unique: T[] = []
  for (const assignment of assignments) {
    const existingIndex = unique.findIndex((candidate) => (
      distanceBetween(candidate.destination, assignment.destination)
        <= SMART_MOVE_CANDIDATE_DEDUPLICATION_TOLERANCE
    ))
    if (existingIndex === -1) unique.push(assignment)
    else if (assignment.movementCost < unique[existingIndex].movementCost - GEOMETRY_EPSILON) {
      unique[existingIndex] = assignment
    }
  }
  return unique
}

function truncatePath(path: ModelPathResult, maximumDistance: number): ModelPathResult | null {
  if (maximumDistance <= GEOMETRY_EPSILON) {
    return path.path.length > 0 ? { path: [{ ...path.path[0] }], distance: 0 } : null
  }
  const points: Point[] = [{ ...path.path[0] }]
  let used = 0
  for (let index = 1; index < path.path.length; index += 1) {
    const start = path.path[index - 1]
    const end = path.path[index]
    const segment = distanceBetween(start, end)
    if (used + segment <= maximumDistance + GEOMETRY_EPSILON) {
      points.push({ ...end })
      used += segment
      continue
    }
    const remaining = maximumDistance - used
    if (remaining > GEOMETRY_EPSILON && segment > GEOMETRY_EPSILON) {
      const fraction = remaining / segment
      points.push({
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      })
      used = maximumDistance
    }
    break
  }
  return points.length > 0 ? { path: points, distance: used } : null
}

function modelsAreCoherentNeighbors(
  model: TabletopModel,
  modelPosition: Point,
  anchor: TabletopModel,
  policy: CoherencyPolicy | undefined,
): boolean {
  if (!policy) return false
  return distanceBetweenBases({ ...model, position: modelPosition }, anchor)
    <= policy.distance + GEOMETRY_EPSILON
}

function modelsOverlapAt(
  model: TabletopModel,
  position: Point,
  obstacle: TabletopModel,
): boolean {
  if (model.base.shape === 'circle' && obstacle.base.shape === 'circle') {
    return circlesOverlap(
      position,
      baseRadiusInches(model.base),
      obstacle.position,
      baseRadiusInches(obstacle.base),
    )
  }
  return footprintsOverlap(
    model.base,
    poseForModel(model, position),
    obstacle.base,
    poseForModel(obstacle),
  )
}

function closedOutlineIntersections(
  first: ReadonlyArray<Point>,
  second: ReadonlyArray<Point>,
): Point[] {
  const intersections: Point[] = []
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex]
    const firstEnd = first[(firstIndex + 1) % first.length]
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondStart = second[secondIndex]
      const secondEnd = second[(secondIndex + 1) % second.length]
      const intersection = segmentIntersection(firstStart, firstEnd, secondStart, secondEnd)
      if (intersection) intersections.push(intersection)
    }
  }
  return intersections
}

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const ab = { x: b.x - a.x, y: b.y - a.y }
  const cd = { x: d.x - c.x, y: d.y - c.y }
  const determinant = ab.x * cd.y - ab.y * cd.x
  if (Math.abs(determinant) <= GEOMETRY_EPSILON) return null
  const offset = { x: c.x - a.x, y: c.y - a.y }
  const firstFraction = (offset.x * cd.y - offset.y * cd.x) / determinant
  const secondFraction = (offset.x * ab.y - offset.y * ab.x) / determinant
  if (firstFraction < -GEOMETRY_EPSILON || firstFraction > 1 + GEOMETRY_EPSILON
    || secondFraction < -GEOMETRY_EPSILON || secondFraction > 1 + GEOMETRY_EPSILON) return null
  return { x: a.x + ab.x * firstFraction, y: a.y + ab.y * firstFraction }
}

function circleIntersections(
  centerA: Point,
  radiusA: number,
  centerB: Point,
  radiusB: number,
): Point[] {
  const centerDistance = distanceBetween(centerA, centerB)
  if (centerDistance <= GEOMETRY_EPSILON
    || centerDistance > radiusA + radiusB + GEOMETRY_EPSILON
    || centerDistance < Math.abs(radiusA - radiusB) - GEOMETRY_EPSILON) return []
  const along = (radiusA * radiusA - radiusB * radiusB + centerDistance * centerDistance)
    / (2 * centerDistance)
  const heightSquared = Math.max(0, radiusA * radiusA - along * along)
  const height = Math.sqrt(heightSquared)
  const direction = {
    x: (centerB.x - centerA.x) / centerDistance,
    y: (centerB.y - centerA.y) / centerDistance,
  }
  const midpoint = {
    x: centerA.x + direction.x * along,
    y: centerA.y + direction.y * along,
  }
  const perpendicular = { x: -direction.y, y: direction.x }
  if (height <= GEOMETRY_EPSILON) return [midpoint]
  return [
    { x: midpoint.x + perpendicular.x * height, y: midpoint.y + perpendicular.y * height },
    { x: midpoint.x - perpendicular.x * height, y: midpoint.y - perpendicular.y * height },
  ]
}

function findPath(
  request: ModelPathRequest,
  metrics: SolverMetrics,
  planner?: ModelPathPlanner,
): ModelPathResult | null {
  metrics.pathfindingCalls += 1
  const startedAt = nowMilliseconds()
  // The caller already established that the exact direct path is blocked.
  const result = findModelPath(request, planner, true)
  metrics.pathfindingMs += nowMilliseconds() - startedAt
  if (!result) metrics.failedPaths += 1
  else if (result.path.length <= 2) metrics.directPaths += 1
  else metrics.routedPaths += 1
  return result
}

function pathBudgetExhausted(metrics: SolverMetrics): boolean {
  return nowMilliseconds() >= metrics.deadlineAt
    || metrics.pathfindingCalls >= SMART_MOVE_FALLBACK_MAX_PATH_ATTEMPTS
    || metrics.directPathChecks >= SMART_MOVE_FALLBACK_MAX_DIRECT_PATH_CHECKS
}

function detourCandidateLimitFor(
  request: SmartMoveRequest,
  selectedModels: ReadonlyArray<TabletopModel>,
): number {
  const usesGenericGeometry = selectedModels.some((model) => model.base.shape !== 'circle')
    || request.allModels.some((model) => model.base.shape !== 'circle')
  if (usesGenericGeometry) return SMART_MOVE_GENERIC_MAX_DETOUR_CANDIDATES
  if (selectedModels.length >= 15) {
    return (request.coherencyPolicy?.requiredNeighbors ?? 0) >= 2
      ? SMART_MOVE_FALLBACK_MAX_DETOUR_CANDIDATES_COMPLEX_POLICY
      : SMART_MOVE_FALLBACK_MAX_DETOUR_CANDIDATES
  }
  return SMART_MOVE_FALLBACK_MAX_DETOUR_CANDIDATES_SMALL_UNIT
}

function findDirectPath(request: ModelPathRequest, metrics: SolverMetrics): ModelPathResult | null {
  metrics.directPathChecks += 1
  const startedAt = nowMilliseconds()
  const result = findDirectModelPath(request)
  metrics.pathfindingMs += nowMilliseconds() - startedAt
  if (result) metrics.directPaths += 1
  return result
}

function pathSeparationFor(request: SmartMoveRequest, modelId: string) {
  const constraints = request.separationConstraints?.filter((constraint) =>
    constraint.movingModelId === modelId) ?? []
  return {
    traversalMinimumSeparation: Object.fromEntries(constraints
      .filter((constraint) => constraint.duringMovement)
      .map((constraint) => [constraint.obstacleModelId, constraint.minimumDistance])),
    destinationMinimumSeparation: Object.fromEntries(constraints
      .filter((constraint) => constraint.atDestination)
      .map((constraint) => [constraint.obstacleModelId, constraint.minimumDistance])),
  }
}

function selectFallbackAlternatives(
  candidates: ReadonlyArray<SmartMoveAssignment>,
  maximumAlternatives = SMART_MOVE_FALLBACK_MAX_ALTERNATIVES,
): SmartMoveAssignment[] {
  if (candidates.length <= maximumAlternatives) return [...candidates]
  const last = candidates.length - 1
  const indexes = maximumAlternatives <= 3
    ? [0, Math.floor(last / 2), last]
    : [0, 1, Math.floor(last / 4), Math.floor(last / 2), Math.floor(last * 2 / 3), last]
  return [...new Set(indexes)].map((index) => candidates[index])
}

function candidateScore(
  request: SmartMoveRequest,
  assignments: ReadonlyArray<SmartMoveAssignment>,
  positions: Readonly<Record<string, Point>>,
  stableOrder: number,
): PlannedTemplate['score'] {
  const normalized: number[] = []
  let totalProgress = 0
  let totalMovement = 0
  for (const assignment of assignments) {
    const startDistance = distanceBetween(assignment.start, request.target)
    const finalPosition = positions[assignment.modelId] ?? assignment.destination
    const progress = startDistance - distanceBetween(finalPosition, request.target)
    totalProgress += progress
    totalMovement += assignment.movementCost
    const theoreticalMaximum = Math.min(startDistance, assignment.movementRemaining)
    if (theoreticalMaximum > GEOMETRY_EPSILON) {
      normalized.push(Math.max(-1, Math.min(1, progress / theoreticalMaximum)))
    }
  }
  const totalNormalized = normalized.reduce((total, value) => total + value, 0)
  const minimumNormalized = normalized.length > 0 ? Math.min(...normalized) : 1
  const pathWaste = totalMovement - totalProgress
  return [
    -totalProgress,
    -minimumNormalized,
    -totalNormalized,
    pathWaste,
    stableOrder,
  ]
}

function addValidationFailures(
  validation: CandidateFormationResult,
  failures: Set<SmartMoveFailureReason>,
) {
  for (const violation of validation.violations) {
    if (violation.type === 'OUT_OF_BOUNDS') failures.add('BATTLEFIELD')
    if (violation.type === 'TERRAIN_FINISH_FORBIDDEN'
      || violation.type === 'COLLIDES_WITH_STATIONARY_MODEL'
      || violation.type === 'CANDIDATE_INTERNAL_OVERLAP'
      || violation.type === 'MODEL_SEPARATION_FAILED') failures.add('COLLISION')
    if (violation.type === 'MOVEMENT_ALLOWANCE_EXCEEDED') failures.add('MOVEMENT_LIMIT')
    if (violation.type === 'COHERENCY_FAILED') failures.add('COHERENCY')
    if (violation.type === 'DESTINATION_RELATIONSHIP_FAILED') failures.add('DESTINATION_RELATIONSHIP')
    if (violation.type === 'MODEL_NOT_FOUND') failures.add('INVALID_SELECTION')
  }
}

function generateHexAxial(count: number): Array<{ q: number; r: number }> {
  const axial: Array<{ q: number; r: number }> = [{ q: 0, r: 0 }]
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ]
  for (let ring = 1; axial.length < count; ring += 1) {
    let current = { q: -ring, r: ring }
    for (const direction of directions) {
      for (let step = 0; step < ring && axial.length < count; step += 1) {
        axial.push({ ...current })
        current = { q: current.q + direction.q, r: current.r + direction.r }
      }
    }
  }
  return axial.slice(0, count)
}

function generateHexSlots(count: number, spacing: number, rotation: number, focus: Point): Point[] {
  const raw = generateHexAxial(count).map(({ q, r }) => ({
    x: spacing * (q + r / 2),
    y: spacing * (Math.sqrt(3) / 2) * r,
  }))
  const center = pointsCentroid(raw)
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return raw.map((point) => {
    const x = point.x - center.x
    const y = point.y - center.y
    return {
      x: focus.x + x * cosine - y * sine,
      y: focus.y + x * sine + y * cosine,
    }
  })
}

function generateFootprintFormationSlots(
  models: ReadonlyArray<TabletopModel>,
  separation: number,
  rotation: number,
  focus: Point,
): Point[] {
  if (models.length === 0) return []
  const axial = generateHexAxial(models.length)
  const centerModel = { ...models[0], position: focus }
  return axial.map(({ q, r }, index) => {
    if (index === 0) return { ...focus }
    const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))
    const angle = Math.atan2((Math.sqrt(3) / 2) * r, q + r / 2) + rotation
    const direction = { x: Math.cos(angle), y: Math.sin(angle) }
    const outline = footprintExclusionOutline(
      centerModel.base,
      poseForModel(centerModel),
      models[index].base,
      models[index].rotation,
      separation,
      GENERIC_RELATIONSHIP_SAMPLES,
    )
    const boundary = outline.reduce((best, point) => (
      (point.x - focus.x) * direction.x + (point.y - focus.y) * direction.y
        > (best.x - focus.x) * direction.x + (best.y - focus.y) * direction.y
        ? point
        : best
    ))
    return {
      x: focus.x + (boundary.x - focus.x) * ring,
      y: focus.y + (boundary.y - focus.y) * ring,
    }
  })
}

function formationSpacings(
  largestRadius: number,
  policy: CoherencyPolicy | undefined,
  modelCount: number,
): number[] {
  const touching = largestRadius * 2 + GEOMETRY_EPSILON * 16
  if (modelCount <= 1 || !policy || policy.distance <= GEOMETRY_EPSILON) return [touching]
  // These are bounded samples of the legal distance envelope, not a preferred
  // gameplay gap. The real complete-unit evaluator decides which are legal.
  return [0.65, 0.4, 0.15, 0.9, 0].map((fraction) => touching + policy.distance * fraction)
}

function genericFormationSeparations(
  policy: CoherencyPolicy | undefined,
  modelCount: number,
): number[] {
  if (modelCount <= 1 || !policy || policy.distance <= GEOMETRY_EPSILON) {
    return [GEOMETRY_EPSILON * 16]
  }
  return [0.15, 0.4, 0.65, 0, 0.9].map((fraction) => policy.distance * fraction)
}

function formationFocuses(target: Point, start: Point, maximumProgress: number): Point[] {
  const targetDistance = distanceBetween(start, target)
  if (targetDistance <= GEOMETRY_EPSILON) return [{ ...target }]
  const progressSamples = [
    targetDistance,
    maximumProgress,
    maximumProgress * 0.75,
    maximumProgress * 0.5,
    maximumProgress * 0.25,
    4,
    3,
    2,
    1,
    0.5,
    0.25,
  ]
    .map((progress) => Math.min(targetDistance, Math.max(0, progress)))
    .filter((progress) => progress > GEOMETRY_EPSILON)
    .sort((a, b) => b - a)
  const uniqueProgress = progressSamples.filter((progress, index) => index === 0
    || Math.abs(progress - progressSamples[index - 1]) > GEOMETRY_EPSILON)
  const direction = {
    x: (target.x - start.x) / targetDistance,
    y: (target.y - start.y) / targetDistance,
  }
  return uniqueProgress.map((progress) => ({
    x: start.x + direction.x * progress,
    y: start.y + direction.y * progress,
  }))
}

function maxTemplatesForSelection(modelCount: number): number {
  if (modelCount >= 15) return 10
  if (modelCount >= 10) return 18
  return SMART_MOVE_MAX_FORMATION_TEMPLATES
}

function clampSlotsToBattlefield(
  slots: ReadonlyArray<Point>,
  radius: number,
  battlefield: Battlefield,
): Point[] {
  const minX = Math.min(...slots.map((slot) => slot.x))
  const maxX = Math.max(...slots.map((slot) => slot.x))
  const minY = Math.min(...slots.map((slot) => slot.y))
  const maxY = Math.max(...slots.map((slot) => slot.y))
  let shiftX = minX < radius ? radius - minX : 0
  let shiftY = minY < radius ? radius - minY : 0
  if (maxX + shiftX > battlefield.width - radius) shiftX += battlefield.width - radius - (maxX + shiftX)
  if (maxY + shiftY > battlefield.height - radius) shiftY += battlefield.height - radius - (maxY + shiftY)
  return slots.map((slot) => ({ x: slot.x + shiftX, y: slot.y + shiftY }))
}

function clampFootprintSlotsToBattlefield(
  slots: ReadonlyArray<Point>,
  models: ReadonlyArray<TabletopModel>,
  battlefield: Battlefield,
): Point[] {
  let minimumShiftX = Number.NEGATIVE_INFINITY
  let maximumShiftX = Number.POSITIVE_INFINITY
  let minimumShiftY = Number.NEGATIVE_INFINITY
  let maximumShiftY = Number.POSITIVE_INFINITY
  for (let index = 0; index < Math.min(slots.length, models.length); index += 1) {
    const bounds = footprintBounds(models[index].base, poseForModel(models[index], slots[index]))
    minimumShiftX = Math.max(minimumShiftX, -bounds.left)
    maximumShiftX = Math.min(maximumShiftX, battlefield.width - bounds.right)
    minimumShiftY = Math.max(minimumShiftY, -bounds.top)
    maximumShiftY = Math.min(maximumShiftY, battlefield.height - bounds.bottom)
  }
  const shiftX = minimumShiftX <= maximumShiftX
    ? Math.min(maximumShiftX, Math.max(minimumShiftX, 0))
    : 0
  const shiftY = minimumShiftY <= maximumShiftY
    ? Math.min(maximumShiftY, Math.max(minimumShiftY, 0))
    : 0
  return slots.map((slot) => ({ x: slot.x + shiftX, y: slot.y + shiftY }))
}

function remainingFor(request: SmartMoveRequest, modelId: string): number {
  return Math.max(0, request.movementRemaining[modelId] ?? 0)
}

function pointsCentroid(points: ReadonlyArray<Point>): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function compareScores(left: PlannedTemplate['score'], right: PlannedTemplate['score']): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index]
    if (Math.abs(difference) > GEOMETRY_EPSILON) return difference
  }
  return 0
}

function successfulResult(
  request: SmartMoveRequest,
  unit: Unit,
  selectedIds: string[],
  planned: PlannedTemplate,
  candidatesTested: number,
  solverStage: SmartMoveSolverStage,
  fallbackReasons: SmartMoveFailureReason[],
  metrics: SolverMetrics,
  solveStartedAt: number,
): SmartMoveResult {
  return {
    valid: true,
    target: { ...request.target },
    unitId: unit.id,
    selectedModelIds: selectedIds,
    positions: planned.positions,
    assignments: planned.assignments,
    totalMovementCost: planned.assignments.reduce((total, assignment) => total + assignment.movementCost, 0),
    validation: { movement: true, collision: true, battlefield: true, coherency: true },
    formationValidation: planned.validation,
    coherency: planned.coherency,
    failureReasons: [],
    candidatesTested,
    diagnostics: deriveDiagnostics(
      request,
      planned.assignments,
      solverStage,
      fallbackReasons,
      metrics,
      solveStartedAt,
    ),
  }
}

function deriveDiagnostics(
  request: SmartMoveRequest,
  assignments: ReadonlyArray<SmartMoveAssignment>,
  solverStage: SmartMoveSolverStage,
  fallbackReasons: SmartMoveFailureReason[],
  metrics: SolverMetrics,
  solveStartedAt: number,
): SmartMoveDiagnostics {
  const usefulPercentages: number[] = []
  let totalAvailableUsefulMovement = 0
  let totalActualPathMovement = 0
  let totalTargetProgress = 0
  for (const assignment of assignments) {
    const startDistance = distanceBetween(assignment.start, request.target)
    const finalDistance = distanceBetween(assignment.destination, request.target)
    const availableUseful = Math.min(assignment.movementRemaining, startDistance)
    const progress = startDistance - finalDistance
    totalAvailableUsefulMovement += availableUseful
    totalActualPathMovement += assignment.movementCost
    totalTargetProgress += progress
    if (availableUseful > GEOMETRY_EPSILON) {
      usefulPercentages.push(Math.max(-1, Math.min(1, progress / availableUseful)) * 100)
    }
  }
  return {
    solverStage,
    selectedModels: assignments.length,
    totalAvailableUsefulMovement,
    totalActualPathMovement,
    totalTargetProgress,
    averageTargetProgress: assignments.length > 0 ? totalTargetProgress / assignments.length : 0,
    averageUsefulProgressPercent: usefulPercentages.length > 0
      ? usefulPercentages.reduce((total, percentage) => total + percentage, 0) / usefulPercentages.length
      : 100,
    minimumUsefulProgressPercent: usefulPercentages.length > 0 ? Math.min(...usefulPercentages) : 100,
    fastPathAccepted: solverStage !== 'FALLBACK',
    fallbackUsed: solverStage === 'FALLBACK',
    fallbackReasons: [...fallbackReasons],
    fallbackOrder: [...metrics.fallbackOrder],
    candidatePositionsGenerated: metrics.candidatePositionsGenerated,
    candidatePositionsDeduplicated: metrics.candidatePositionsDeduplicated,
    pathfindingCalls: metrics.pathfindingCalls,
    directPathChecks: metrics.directPathChecks,
    directPaths: metrics.directPaths,
    routedPaths: metrics.routedPaths,
    failedPaths: metrics.failedPaths,
    coherencyEvaluations: metrics.coherencyEvaluations,
    backtrackingNodes: metrics.backtrackingNodes,
    finalValidations: metrics.finalValidations,
    searchBudgetExhausted: metrics.searchBudgetExhausted,
    requestSetupMs: metrics.requestSetupMs,
    fastPathValidationMs: metrics.fastPathValidationMs,
    fallbackOrderingMs: metrics.fallbackOrderingMs,
    candidateGenerationMs: metrics.candidateGenerationMs,
    candidateDeduplicationMs: metrics.candidateDeduplicationMs,
    collisionFilteringMs: metrics.collisionFilteringMs,
    pathfindingMs: metrics.pathfindingMs,
    provisionalCoherencyMs: metrics.provisionalCoherencyMs,
    finalValidationMs: metrics.finalValidationMs,
    candidateScoringMs: metrics.candidateScoringMs,
    fallbackSearchMs: metrics.fallbackSearchMs,
    solveTimeMs: nowMilliseconds() - solveStartedAt,
  }
}

function createSolverMetrics(deadlineAt: number): SolverMetrics {
  return {
    deadlineAt,
    fallbackOrder: [],
    candidatePositionsGenerated: 0,
    candidatePositionsDeduplicated: 0,
    pathfindingCalls: 0,
    directPathChecks: 0,
    directPaths: 0,
    routedPaths: 0,
    failedPaths: 0,
    coherencyEvaluations: 0,
    backtrackingNodes: 0,
    finalValidations: 0,
    searchBudgetExhausted: false,
    requestSetupMs: 0,
    fastPathValidationMs: 0,
    fallbackOrderingMs: 0,
    candidateGenerationMs: 0,
    candidateDeduplicationMs: 0,
    collisionFilteringMs: 0,
    pathfindingMs: 0,
    provisionalCoherencyMs: 0,
    finalValidationMs: 0,
    candidateScoringMs: 0,
    fallbackSearchMs: 0,
  }
}

function withSearchLimit(result: SmartMoveResult): SmartMoveResult {
  return result.failureReasons.includes('SEARCH_LIMIT') ? result : {
    ...result,
    failureReasons: [...result.failureReasons, 'SEARCH_LIMIT'],
    diagnostics: result.diagnostics && { ...result.diagnostics, searchBudgetExhausted: true },
  }
}

function nowMilliseconds(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function failedResult(
  target: Point,
  selectedModelIds: string[],
  failureReasons: SmartMoveFailureReason[],
): SmartMoveResult {
  return {
    valid: false,
    target: { ...target },
    selectedModelIds,
    positions: {},
    assignments: [],
    totalMovementCost: 0,
    validation: validationFromFailures(failureReasons),
    formationValidation: null,
    coherency: null,
    failureReasons,
    candidatesTested: 0,
    diagnostics: null,
  }
}

function validationFromFailures(failures: ReadonlyArray<SmartMoveFailureReason>): SmartMoveValidationStatus {
  return {
    movement: !failures.includes('MOVEMENT_LIMIT') && !failures.includes('NO_REACHABLE_FORMATION'),
    collision: !failures.includes('COLLISION') && !failures.includes('NO_REACHABLE_FORMATION'),
    battlefield: !failures.includes('BATTLEFIELD'),
    coherency: !failures.includes('COHERENCY'),
  }
}
