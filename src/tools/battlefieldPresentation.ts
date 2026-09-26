import type { BattlefieldFeature, GameState } from '../domain/types'
import type { AosUnitMovementStatus } from '../gameSystem/ageOfSigmar/movement'
import { featureObjectiveArea } from '../engine/battlefieldFeatures'
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
