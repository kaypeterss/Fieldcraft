import type { MatchLifecycleStatus } from '../domain/types'
import type { AosDeploymentPhase } from '../gameSystem/ageOfSigmar/deployment'

/**
 * Resolves the shell presentation from authoritative lifecycle state.
 *
 * Capability flags describe what an adapter can do; they never imply that a
 * match has reached that part of its lifecycle.
 */
export type AosLifecyclePresentation = 'SETUP' | 'DEPLOYMENT' | 'READY_FOR_BATTLE' | 'IN_PROGRESS' | 'COMPLETED'

export function resolveAosLifecyclePresentation(
  lifecycle: MatchLifecycleStatus | undefined,
  deploymentPhase?: AosDeploymentPhase,
): AosLifecyclePresentation {
  if (lifecycle === 'COMPLETED') return 'COMPLETED'
  if (lifecycle === 'IN_PROGRESS') return 'IN_PROGRESS'
  if (lifecycle === 'DEPLOYMENT') {
    return deploymentPhase === 'READY_FOR_BATTLE' ? 'READY_FOR_BATTLE' : 'DEPLOYMENT'
  }
  return 'SETUP'
}
