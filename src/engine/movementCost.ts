import type { MovementPolicyConfig } from '../domain/types'
import { GEOMETRY_EPSILON } from './geometry/tolerance'

export interface MovementMetrics {
  translationDistance: number
  angularDistance: number
}

export interface MovementCostBreakdown {
  translationCost: number
  rotationCost: number
  totalCost: number
}

export type PathCostPolicyConfig = Exclude<MovementPolicyConfig, { type: 'movement-envelope' }>

export const DEFAULT_MOVEMENT_POLICY: MovementPolicyConfig = { type: 'movement-envelope' }

/** Scalar path-cost policies only. Movement Envelope is a pose constraint, not a cost formula. */
export function calculatePathMovementCost(
  policy: PathCostPolicyConfig,
  metrics: MovementMetrics,
): MovementCostBreakdown {
  const translationCost = finiteNonNegative(metrics.translationDistance)
  const angularDistance = finiteNonNegative(metrics.angularDistance)
  const rotationCost = policy.type === 'fixed-rotation-charge' && angularDistance > GEOMETRY_EPSILON
    ? validateFixedCharge(policy.rotationCharge)
    : 0
  return { translationCost, rotationCost, totalCost: translationCost + rotationCost }
}

export function maximumAdditionalPathTranslation(
  policy: PathCostPolicyConfig,
  metrics: MovementMetrics,
  allowance: number,
): number {
  return Math.max(0, finiteNonNegative(allowance) - calculatePathMovementCost(policy, metrics).totalCost)
}

export function maximumAdditionalPathRotation(
  policy: PathCostPolicyConfig,
  metrics: MovementMetrics,
  allowance: number,
): number {
  const remaining = Math.max(0, finiteNonNegative(allowance)
    - calculatePathMovementCost(policy, metrics).totalCost)
  if (policy.type === 'free-rotation') return Number.POSITIVE_INFINITY
  if (metrics.angularDistance > GEOMETRY_EPSILON) return Number.POSITIVE_INFINITY
  return remaining + GEOMETRY_EPSILON >= validateFixedCharge(policy.rotationCharge)
    ? Number.POSITIVE_INFINITY
    : 0
}

export function movementPolicyLabel(policy: MovementPolicyConfig): string {
  switch (policy.type) {
    case 'movement-envelope': return 'Movement envelope'
    case 'fixed-rotation-charge': return `Fixed rotation (${policy.rotationCharge.toFixed(2)}\u2033)`
    case 'free-rotation': return 'Free rotation'
    default: return assertNever(policy)
  }
}

export function normalizeMovementPolicy(
  policy: MovementPolicyConfig | undefined,
): MovementPolicyConfig {
  if (!policy) return DEFAULT_MOVEMENT_POLICY
  if (policy.type === 'fixed-rotation-charge') {
    return { type: policy.type, rotationCharge: validateFixedCharge(policy.rotationCharge) }
  }
  return policy
}

export function isPathCostPolicy(policy: MovementPolicyConfig): policy is PathCostPolicyConfig {
  return policy.type !== 'movement-envelope'
}

function validateFixedCharge(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Rotation charge must be finite and non-negative')
  return value
}

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Movement values must be finite and non-negative')
  return value
}

function assertNever(value: never): never {
  throw new Error(`Unsupported movement policy: ${JSON.stringify(value)}`)
}
