import type { BattlefieldFeature, GameState } from '../domain/types'
import type { AosUnitMovementStatus } from '../gameSystem/ageOfSigmar/movement'
import { featureObjectiveArea } from '../engine/battlefieldFeatures'
import { footprintOffsetOutline, poseForModel } from '../engine/geometry/footprints'
import { exteriorUnionOutlines } from '../engine/geometry/outlineUnion'
import type { Point } from '../engine/geometry/point'
import { activeBattlefieldModels } from '../game/modelPresence'
import { getUnitDefinition } from '../game/selectors'

export interface BoardOverlayPreferences {
  deploymentZones: boolean
  objectiveAreas: boolean
  terrainLabels: boolean
  objectiveLabels: boolean
  unitLabels: boolean
  movementStatus: boolean
  automaticRuleAssistance: boolean
}

/** Shared Pixi contract for all non-interactive battlefield annotations. */
export const PRESENTATION_ANNOTATION_EVENT_MODE = 'none' as const

export interface UnitBattlefieldPresentation {
  unitId: string
  name: string
  modelIds: string[]
  statusIcon?: string
  statusLabel?: string
  statusDetail?: string
  /** Optional unit-level state badge; never marks an individual model. */
  damageLabel?: string
  damageDetail?: string
}

export interface BattlefieldModelMarker {
  modelId: string
  kind: 'loadout' | 'role'
  symbol: string
  label: string
  profileId?: string
}

export interface BattlefieldActionFocus {
  actingUnitId: string
  actingModelIds: string[]
  targetUnitIds: string[]
  /** Explicit temporary target emphasis, independent of rule-constraint targets. */
  targetEnvelopeUnitIds: string[]
  targetModelIds: string[]
  eligibleModelIds: string[]
  profileModelIds: string[]
  casualtyCandidateModelIds: string[]
  casualtySelectedModelIds: string[]
}

export interface TargetUnitEnvelope {
  unitId: string
  outlines: Point[][]
}

/** The user can hide this aid without changing the action or its legality. */
export function fightRangeAssistanceVisible(enabled: boolean, targetModelIds?: readonly string[]): boolean {
  return enabled && Boolean(targetModelIds?.length)
}

/** Presentation only: actual active footprint union, with optional visual padding.
 * This never enters target eligibility, range, collision, or authoritative state.
 */
export function targetUnitFootprintEnvelopes(
  models: readonly GameState['models'][number][],
  targetUnitIds: readonly string[],
  presentationPadding = 0,
): TargetUnitEnvelope[] {
  return [...new Set(targetUnitIds)].flatMap((unitId) => {
    const active = models.filter((model) => model.unitId === unitId
      && (model.presence ?? 'ON_BATTLEFIELD') === 'ON_BATTLEFIELD')
    if (active.length === 0) return []
    return [{
      unitId,
      outlines: exteriorUnionOutlines(active.map((model) =>
        footprintOffsetOutline(model.base, poseForModel(model), presentationPadding))),
    }]
  })
}

/** Converts authoritative IDs into a generic, geometry-free rendering contract. */
export function deriveActionFocusPresentation(state: GameState, request?: {
  actingUnitId?: string
  targetUnitIds?: readonly string[]
  targetEnvelopeUnitIds?: readonly string[]
  eligibleModelIds?: readonly string[]
  profileModelIds?: readonly string[]
  casualtyCandidateModelIds?: readonly string[]
  casualtySelectedModelIds?: readonly string[]
}): BattlefieldActionFocus | null {
  if (!request?.actingUnitId) return null
  const activeModels = activeBattlefieldModels(state)
  const actingModelIds = activeModels.filter((model) => model.unitId === request.actingUnitId).map((model) => model.id)
  if (actingModelIds.length === 0) return null
  const targetUnitIds = [...new Set(request.targetUnitIds ?? [])]
  const activeIds = new Set(activeModels.map((model) => model.id))
  const targetEnvelopeUnitIds = [...new Set(request.targetEnvelopeUnitIds ?? [])]
    .filter((id) => targetUnitIds.includes(id) && activeModels.some((model) => model.unitId === id))
  return {
    actingUnitId: request.actingUnitId,
    actingModelIds,
    targetUnitIds,
    targetEnvelopeUnitIds,
    targetModelIds: activeModels.filter((model) => targetUnitIds.includes(model.unitId)).map((model) => model.id),
    eligibleModelIds: [...new Set(request.eligibleModelIds ?? [])].filter((id) => activeIds.has(id)),
    profileModelIds: [...new Set(request.profileModelIds ?? [])].filter((id) => activeIds.has(id)),
    casualtyCandidateModelIds: [...new Set(request.casualtyCandidateModelIds ?? [])].filter((id) => activeIds.has(id)),
    casualtySelectedModelIds: [...new Set(request.casualtySelectedModelIds ?? [])].filter((id) => activeIds.has(id)),
  }
}

export function defaultBoardOverlayPreferences(development = false): BoardOverlayPreferences {
  return {
    deploymentZones: false,
    objectiveAreas: true,
    terrainLabels: development,
    objectiveLabels: development,
    unitLabels: true,
    movementStatus: true,
    automaticRuleAssistance: true,
  }
}

/** Deployment owns the automatic visibility; this preference only opts in outside it. */
export function deploymentZonesVisible(deploymentActive: boolean, manuallyShown: boolean): boolean {
  return deploymentActive || manuallyShown
}

export function movementStatusPresentation(status: AosUnitMovementStatus): Pick<UnitBattlefieldPresentation,
  'statusIcon' | 'statusLabel' | 'statusDetail'> {
  switch (status.kind) {
    case 'READY':
      return { statusIcon: '◇', statusLabel: status.label || 'Ready to move', statusDetail: status.label === 'READY TO FIGHT' ? 'Pile-in up to 3″' : `Move ${status.baseMove}″` }
    case 'NORMAL_MOVE':
      return { statusIcon: '✓', statusLabel: 'Moved — Normal', statusDetail: `Move ${status.baseMove}″` }
    case 'RUN':
      return {
        statusIcon: 'R', statusLabel: 'Moved — Run',
        statusDetail: `Move ${status.baseMove}″ · Run roll ${status.rollResult ?? 0} · Allowance ${status.allowance}″`,
      }
    case 'RETREAT':
      return {
        statusIcon: '↩', statusLabel: 'Moved — Retreat',
        statusDetail: `Move ${status.baseMove}″ · Retreat roll ${status.rollResult ?? 0}`,
      }
    case 'CHARGE':
      return { statusIcon: '⚡', statusLabel: 'Charged this turn', statusDetail: `Charge roll ${status.rollResult ?? 0}″` }
    case 'PILE_IN':
      return { statusIcon: '⚔', statusLabel: 'Pile-in complete', statusDetail: 'Ready to fight' }
  }
}

export function deriveUnitBattlefieldPresentations(
  state: GameState,
  statuses: readonly AosUnitMovementStatus[] = [],
): UnitBattlefieldPresentation[] {
  const activeIds = new Set(activeBattlefieldModels(state).map((model) => model.id))
  const statusByUnit = new Map(statuses.map((status) => [status.unitId, status]))
  return state.units.flatMap((unit) => {
    const modelIds = unit.modelIds.filter((id) => activeIds.has(id))
    if (modelIds.length === 0) return []
    const status = statusByUnit.get(unit.id)
    return [{
      unitId: unit.id,
      name: getUnitDefinition(state, unit)?.name ?? unit.id,
      modelIds,
      ...(status ? movementStatusPresentation(status) : {}),
    }]
  })
}

/** Shared objective geometry with presentation emphasis only; no duplicate control-zone dimensions. */
export function objectiveControlAreaPresentation(
  feature: BattlefieldFeature,
  spatialActive = false,
  selected = false,
) {
  const area = featureObjectiveArea(feature)
  if (!area) return null
  return {
    ...area,
    fillAlpha: spatialActive ? selected ? 0.08 : 0.035 : 0.025,
    strokeAlpha: spatialActive ? selected ? 0.95 : 0.65 : 0.32,
    strokeWidth: spatialActive ? selected ? 0.22 : 0.13 : 0.09,
  }
}
