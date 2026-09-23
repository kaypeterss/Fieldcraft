import type {
  DicePoolResult,
  DiceRollRecord,
  DiceSequenceRecord,
  DiceSequenceResolution,
  GameContext,
} from '../domain/types'
import { assertDicePoolIntegrity, cloneDicePool } from '../engine/dice'
import { cloneResolution } from '../engine/diceSequence'

export interface CreateDiceRollRecordRequest {
  sequence: number
  playerId: string
  gameContext: GameContext
  result: DicePoolResult
}

export function createDiceRollRecord(request: CreateDiceRollRecordRequest): DiceRollRecord {
  assertDicePoolIntegrity(request.result)
  return {
    id: `dice-${request.sequence}`,
    sequence: request.sequence,
    type: 'DICE_ROLL',
    playerId: request.playerId,
    round: request.gameContext.round,
    turn: request.gameContext.turn,
    turnSequence: request.gameContext.turnSequence,
    turnId: request.gameContext.turnId,
    ...(request.gameContext.phase ? { phase: request.gameContext.phase } : {}),
    ...cloneDicePool(request.result),
  }
}

export function updateDiceRollRecord(record: DiceRollRecord, result: DicePoolResult): DiceRollRecord {
  assertDicePoolIntegrity(result)
  return { ...record, ...cloneDicePool(result) }
}

export interface CreateDiceSequenceRecordRequest {
  sequence: number
  playerId: string
  gameContext: GameContext
  resolution: DiceSequenceResolution
}

export function createDiceSequenceRecord(request: CreateDiceSequenceRecordRequest): DiceSequenceRecord {
  if (!request.resolution.complete || request.resolution.finalResult === undefined) {
    throw new RangeError('Only a complete dice sequence can be recorded')
  }
  return {
    id: `dice-sequence-${request.sequence}`,
    sequence: request.sequence,
    type: 'DICE_SEQUENCE',
    playerId: request.playerId,
    round: request.gameContext.round,
    turn: request.gameContext.turn,
    turnSequence: request.gameContext.turnSequence,
    turnId: request.gameContext.turnId,
    ...(request.gameContext.phase ? { phase: request.gameContext.phase } : {}),
    ...cloneResolution(request.resolution),
  }
}
