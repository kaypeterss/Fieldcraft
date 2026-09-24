import { ghb2026Battlepack } from './content/battlepacks/ghb2026'

export const AOS_BASE_COMMAND_POINTS = ghb2026Battlepack.roundResources.commandPoints.basePerRound
export const AOS_UNDERDOG_COMMAND_POINT_BONUS = ghb2026Battlepack.roundResources.commandPoints.underdogBonus
export const AOS_FURY_CAP = ghb2026Battlepack.roundResources.fury.maximum

export interface AosRageDie {
  /** Stable resource identity; a Rage die is not rolled when it is gained. */
  id: string
  sides: 6
  generatedRound: number
}

export interface AosPlayerRoundResources {
  commandPoints: number
  fury: number
  rageDice: AosRageDie[]
}

export interface AosRoundResources {
  byPlayerId: Record<string, AosPlayerRoundResources>
  generatedForRound?: number
}

export function initialAosRoundResources(
  playerIds: readonly string[],
  attackerPlayerId?: string,
  defenderPlayerId?: string,
): AosRoundResources {
  return {
    byPlayerId: Object.fromEntries(playerIds.map((playerId) => [playerId, {
      commandPoints: 0,
      fury: playerId === attackerPlayerId
        ? ghb2026Battlepack.roundResources.fury.attackerInitial
        : playerId === defenderPlayerId ? ghb2026Battlepack.roundResources.fury.defenderInitial : 0,
      rageDice: [],
    }])),
  }
}

export function ensureAosRoundResources(
  resources: AosRoundResources | undefined,
  playerIds: readonly string[],
  attackerPlayerId?: string,
  defenderPlayerId?: string,
): AosRoundResources {
  if (!resources) return initialAosRoundResources(playerIds, attackerPlayerId, defenderPlayerId)
  return {
    ...resources,
    byPlayerId: Object.fromEntries(playerIds.map((playerId) => [playerId,
      resources.byPlayerId[playerId] ?? {
        commandPoints: 0,
        fury: playerId === attackerPlayerId
          ? ghb2026Battlepack.roundResources.fury.attackerInitial
          : playerId === defenderPlayerId ? ghb2026Battlepack.roundResources.fury.defenderInitial : 0,
        rageDice: [],
      },
    ])),
  }
}

/** Start-of-round resource generation occurs after the underdog is determined. */
export function generateAosRoundResources(
  resources: AosRoundResources,
  playerIds: readonly string[],
  round: number,
  underdogPlayerId?: string,
): AosRoundResources {
  return {
    generatedForRound: round,
    byPlayerId: Object.fromEntries(playerIds.map((playerId) => {
      const current = resources.byPlayerId[playerId]
      const fury = clampFury(current?.fury ?? 0)
      return [playerId, {
        commandPoints: AOS_BASE_COMMAND_POINTS
          + (playerId === underdogPlayerId ? AOS_UNDERDOG_COMMAND_POINT_BONUS : 0),
        fury,
        rageDice: Array.from({ length: fury }, (_, index): AosRageDie => ({
          id: `rage-r${round}-${playerId}-${index + 1}`,
          sides: 6,
          generatedRound: round,
        })),
      }]
    })),
  }
}

/** Unspent CP and Rage dice expire at the end of the battle round; Fury persists. */
export function expireAosRoundResources(resources: AosRoundResources): AosRoundResources {
  return {
    ...resources,
    byPlayerId: Object.fromEntries(Object.entries(resources.byPlayerId).map(([playerId, current]) => [playerId, {
      ...current,
      commandPoints: 0,
      rageDice: [],
    }])),
  }
}

export function spendAosCommandPoints(
  resources: AosRoundResources,
  playerId: string,
  amount: number,
): AosRoundResources | null {
  const current = resources.byPlayerId[playerId]
  if (!current || !validSpend(amount) || current.commandPoints < amount) return null
  return replacePlayer(resources, playerId, { ...current, commandPoints: current.commandPoints - amount })
}

export function spendAosRageDice(
  resources: AosRoundResources,
  playerId: string,
  amount: number,
): AosRoundResources | null {
  const current = resources.byPlayerId[playerId]
  if (!current || !validSpend(amount) || current.rageDice.length < amount) return null
  return replacePlayer(resources, playerId, { ...current, rageDice: current.rageDice.slice(amount) })
}

/** Future GHB abilities may raise or lower Fury through this capped seam. */
export function changeAosFury(
  resources: AosRoundResources,
  playerId: string,
  delta: number,
): AosRoundResources | null {
  const current = resources.byPlayerId[playerId]
  if (!current || !Number.isInteger(delta)) return null
  return replacePlayer(resources, playerId, { ...current, fury: clampFury(current.fury + delta) })
}

export function isAosRoundResources(value: unknown): value is AosRoundResources {
  if (!isRecord(value) || !isRecord(value.byPlayerId)) return false
  if (value.generatedForRound !== undefined
    && (typeof value.generatedForRound !== 'number' || !Number.isInteger(value.generatedForRound))) return false
  return Object.values(value.byPlayerId).every((entry) => isRecord(entry)
    && typeof entry.commandPoints === 'number' && Number.isInteger(entry.commandPoints) && entry.commandPoints >= 0
    && typeof entry.fury === 'number' && Number.isInteger(entry.fury) && entry.fury >= 0 && entry.fury <= AOS_FURY_CAP
    && Array.isArray(entry.rageDice) && entry.rageDice.every((die) => isRecord(die)
      && typeof die.id === 'string' && die.sides === 6
      && typeof die.generatedRound === 'number' && Number.isInteger(die.generatedRound)))
}

function replacePlayer(
  resources: AosRoundResources,
  playerId: string,
  player: AosPlayerRoundResources,
): AosRoundResources {
  return { ...resources, byPlayerId: { ...resources.byPlayerId, [playerId]: player } }
}

function validSpend(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0
}

function clampFury(value: number): number {
  return Math.max(0, Math.min(AOS_FURY_CAP, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
