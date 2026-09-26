import type { GameState, TabletopModel } from '../../domain/types'
import type { BattlefieldModelMarker } from '../../tools/battlefieldPresentation'
import { activeBattlefieldModels } from '../../game/modelPresence'
import type { AosWeaponProfile } from './content/types'
import {
  aosAttackProfileOptions,
  aosAttackingModelIdsForTarget,
  aosMeleeAttackRange,
  aosProfileModelIds,
  aosUnitAllocatedDamage,
  aosUnitProfile,
  type AosActiveFight,
} from './combat'
import { aosMovementAvailability } from './movement'

export interface AosFightPresentationFocus {
  profileId: string
  targetUnitId: string
  profileModelIds: string[]
  eligibleModelIds: string[]
  targetModelIds: string[]
  attackRange: number
}

/** Data-only target relationship for one selected melee profile. The generic
 * spatial layer alone expands and unions the returned target footprints.
 */
export function targetRangeForProfile(
  models: readonly TabletopModel[],
  targetUnitId: string,
  profile: AosWeaponProfile,
): Pick<AosFightPresentationFocus, 'targetModelIds' | 'attackRange'> | null {
  const targetModelIds = models.filter((model) => model.unitId === targetUnitId
    && (model.presence ?? 'ON_BATTLEFIELD') === 'ON_BATTLEFIELD').map((model) => model.id)
  return targetModelIds.length ? { targetModelIds, attackRange: aosMeleeAttackRange(profile) } : null
}

/** Chooses one relevant profile and target for transient Fight presentation.
 * The state may contain projected poses; it is never mutated or committed here.
 */
export function deriveAosFightPresentationFocus(
  state: GameState,
  fight: AosActiveFight | undefined,
  focused?: { profileId: string; targetUnitId: string | null } | null,
): AosFightPresentationFocus | null {
  if (!fight) return null
  const options = aosAttackProfileOptions(state, fight.unitId)
    .filter((option) => !option.unsupportedReason
      && (fight.stage !== 'ATTACKS' || !fight.resolvedProfileIds.includes(option.profile.id)))
  const profileId = fight.pendingDamage?.profileId ?? focused?.profileId
  const option = options.find((candidate) => candidate.profile.id === profileId) ?? options[0]
  if (!option) return null
  const declaration = fight.declaredAttacks?.find((entry) => entry.profileId === option.profile.id)
  const requestedTarget = focused?.profileId === option.profile.id ? focused.targetUnitId : null
  const pileInTarget = fight.stage === 'PILE_IN'
    ? aosMovementAvailability(state, fight.unitId).selected?.targetUnitId : null
  const targetUnitId = fight.pendingDamage?.targetUnitId ?? declaration?.targetUnitId
    ?? (requestedTarget && option.eligibleTargetUnitIds.includes(requestedTarget) ? requestedTarget : null)
    ?? pileInTarget ?? option.eligibleTargetUnitIds[0]
  if (!targetUnitId) return null
  const targetRange = targetRangeForProfile(state.models, targetUnitId, option.profile)
  if (!targetRange) return null
  return {
    profileId: option.profile.id,
    targetUnitId,
    profileModelIds: option.profileModelIds,
    eligibleModelIds: aosAttackingModelIdsForTarget(state, fight.unitId, option.profile.id, targetUnitId),
    ...targetRange,
  }
}

/** Read-only unit damage display; partial AoS damage never belongs to a model. */
export function aosUnitDamagePresentation(state: GameState, unitId: string) {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (!unit || !activeBattlefieldModels(state).some((model) => model.unitId === unitId)) return null
  const healthThreshold = aosUnitProfile(state, unit)?.health
  if (!healthThreshold) return null
  const currentDamage = aosUnitAllocatedDamage(state, unitId)
  return {
    healthThreshold,
    currentDamage,
    untilNextSlain: Math.max(0, healthThreshold - currentDamage),
    badgeText: currentDamage > 0 ? `✚ ${currentDamage}/${healthThreshold}` : null,
  }
}

/** AoS content adapter: authored loadouts become generic, pointer-transparent model markers. */
export function deriveAosCombatModelMarkers(state: GameState): BattlefieldModelMarker[] {
  return state.units.flatMap((unit) => {
    const profile = aosUnitProfile(state, unit)
    if (!profile) return []
    return profile.weapons.flatMap((weapon) => weapon.modelMarker
      ? aosProfileModelIds(state, unit.id, weapon.id).map((modelId) => ({
        modelId,
        kind: weapon.modelMarker!.kind,
        symbol: weapon.modelMarker!.symbol,
        label: weapon.name,
        profileId: weapon.id,
      }))
      : [])
  })
}

/** Stable model IDs are the only bridge between the authoritative allocation options and either UI picker. */
export function aosCasualtyCandidateModelIds(options: readonly (readonly string[])[]): string[] {
  return [...new Set(options.flatMap((option) => option))]
}

export function aosAllocationForModel(
  options: readonly (readonly string[])[],
  modelId: string,
  damageIsLethal: boolean,
): string[] | null {
  const option = options.find((candidate) => candidate.includes(modelId))
  if (!option) return null
  return damageIsLethal ? [modelId] : []
}
