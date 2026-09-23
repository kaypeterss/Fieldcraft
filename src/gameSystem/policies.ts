import type {
  CoherencyPolicy,
  GameAction,
  GameContext,
  TabletopModel,
  TerrainPolicyConfig,
  TurnConfiguration,
  Unit,
  UnitDefinition,
} from '../domain/types'
import type { ModelAreaRelationship } from '../engine/areaRelationships'
import type {
  CoherencyConfiguration,
  GameSystem,
  MovementPermissionFacts,
  MovementPermissionPolicy,
  MovementPermissionResult,
  ObjectiveControlPolicy,
  ObjectiveQualification,
} from './types'

export interface ObjectiveControlContext {
  model: TabletopModel
  unit?: Unit
  unitDefinition?: UnitDefinition
  gameContext: GameContext
}

export function evaluateMovementPermission(
  policy: MovementPermissionPolicy,
  facts: MovementPermissionFacts,
): MovementPermissionResult {
  const baseAllowance = finiteNonNegative(facts.baseAllowance, 'Base movement allowance')
  const additionalAllowance = finiteNonNegative(facts.additionalAllowance ?? 0, 'Additional movement allowance')
  const movementUsed = finiteNonNegative(facts.movementUsed, 'Movement used')
  const actionsUsed = nonNegativeInteger(facts.actionsUsed, 'Actions used')
  const additionalActions = nonNegativeInteger(facts.additionalActions ?? 0, 'Additional actions')

  const actionsRemaining = policy.actionLimit.type === 'unlimited'
    ? null
    : Math.max(0, nonNegativeInteger(policy.actionLimit.maximumActions, 'Maximum actions')
      + additionalActions - actionsUsed)
  const canStartAction = actionsRemaining === null || actionsRemaining > 0
  const allowance = baseAllowance + additionalAllowance
  const remainingAllowance = policy.allowance.type === 'reset-per-action'
    ? allowance
    : Math.max(0, allowance - movementUsed)

  return { canStartAction, remainingAllowance, actionsRemaining }
}

/** Derives scoped action/allowance facts for one unit from confirmed movement history. */
export function movementPermissionForUnit(request: {
  policy: MovementPermissionPolicy
  actions: readonly GameAction[]
  gameContext: GameContext
  unitId: string
  modelIds: readonly string[]
  baseAllowance: number
  additionalActions?: number
  additionalAllowance?: number
}): MovementPermissionResult {
  const actionScope = request.policy.actionLimit.type === 'limited'
    ? request.policy.actionLimit.scope : null
  const allowanceScope = request.policy.allowance.type === 'shared'
    ? request.policy.allowance.scope : null
  const scoped = (action: GameAction, scope: 'turn' | 'phase' | null) => (
    action.turnId === request.gameContext.turnId
      && (scope !== 'phase' || action.phase === request.gameContext.phase)
  )
  const movementActions = request.actions.filter((action) => (
    action.type === 'MOVE' && action.payload.unitIds.includes(request.unitId)
  ))
  const actionsUsed = actionScope === null
    ? 0
    : movementActions.filter((action) => scoped(action, actionScope)).length
  const movementUsed = allowanceScope === null ? 0 : movementActions
    .filter((action) => scoped(action, allowanceScope))
    .reduce((total, action) => total + request.modelIds.reduce(
      (sum, modelId) => sum + (action.payload.movementUsed[modelId] ?? 0), 0,
    ), 0)
  return evaluateMovementPermission(request.policy, {
    baseAllowance: request.baseAllowance,
    actionsUsed,
    movementUsed,
    additionalActions: request.additionalActions,
    additionalAllowance: request.additionalAllowance,
  })
}

export function objectiveRelationshipQualifies(
  qualification: ObjectiveQualification,
  relationship: ModelAreaRelationship,
): boolean {
  switch (qualification) {
    case 'intersects': return relationship.intersects
    case 'center-within': return relationship.centerWithin
    case 'wholly-within': return relationship.whollyWithin
  }
}

/**
 * Resolves the unmodified OC value. The full context is deliberately retained
 * so future policy variants can inspect phase, keywords, statuses, or abilities.
 */
export function effectiveObjectiveControl(
  policy: ObjectiveControlPolicy,
  context: ObjectiveControlContext,
): number {
  switch (policy.type) {
    case 'model-or-unit-value':
      return finiteNonNegative(
        context.model.objectiveControl
          ?? context.unitDefinition?.objectiveControl
          ?? policy.defaultValue,
        'Objective Control',
      )
  }
}

export function coherencyPolicyFor(
  configuration: CoherencyConfiguration,
  unitPolicy: CoherencyPolicy | undefined,
): CoherencyPolicy | undefined {
  return configuration.type === 'unit-definition' ? unitPolicy : configuration.policy
}

/** Development/QA state may deliberately override the normal system policy. */
export function terrainPolicyFor(
  gameSystem: GameSystem,
  developmentOverride?: TerrainPolicyConfig,
): TerrainPolicyConfig {
  return developmentOverride ?? gameSystem.terrain
}

export function turnConfigurationFor(
  gameSystem: GameSystem,
  playerOrder: string[],
): TurnConfiguration {
  const phases = gameSystem.turns.phases.map((phase) => phase.id)
  return { playerOrder, ...(phases.length > 0 ? { phases } : {}) }
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`)
  return value
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`)
  return value
}
