import { describe, expect, it } from 'vitest'
import type { GameState, JsonValue } from '../../domain/types'
import { rollDice } from '../../engine/dice'
import { distanceBetweenBases } from '../../engine/spatial'
import { validateCandidateFormation } from '../../engine/candidateFormation'
import { solveSmartMove } from '../../engine/smartMove'
import { gameReducer } from '../../state/reducer'
import { reduceGameCommand } from '../../state/commandBoundary'
import { gameSystemRegistry } from '../registeredGameSystems'
import { authorizeMovement, loadRegisteredMatchRuntime } from '../runtime'
import { createAgeOfSigmarAlphaMatch } from './ageOfSigmarMatch'
import { initialAosDeploymentState, type AosDeploymentFact, type AosMatchStateData } from './deployment'
import {
  aosMovementRuleAssistance,
  aosMovementAvailability,
  aosUnitMovementStatus,
  ensureAosMovementState,
  rollAosMovementActionDie,
  rollAosCharge,
  resolveAosMovementContext,
  unitIsInCombat,
} from './movement'
import { prepareAgeOfSigmarMatch } from './prepareAgeOfSigmarMatch'

function command(state: GameState, type: string, actorPlayerId: string, payload?: JsonValue): GameState {
  return reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
    type: 'gameSystem/command', command: { type, actorPlayerId, payload },
  })
}

function movementPhaseState(): GameState {
  let state = prepareAgeOfSigmarMatch(createAgeOfSigmarAlphaMatch({ matchId: 'movement-test' }))
  let sequence = 1
  const facts: AosDeploymentFact[] = state.players.flatMap((player) => state.units
    .filter((unit) => unit.ownerId === player.id)
    .map((unit) => ({ sequence: sequence++, type: 'UNIT_DEPLOYED' as const, playerId: player.id,
      unitId: unit.id, ability: 'DEPLOY_UNIT' as const })))
  const deployment = {
    ...initialAosDeploymentState(), phase: 'READY_FOR_BATTLE' as const,
    deployedUnitIds: state.units.map((unit) => unit.id), facts,
    attackerPlayerId: 'player-1', defenderPlayerId: 'player-2',
    territoryByPlayerId: { 'player-1': 'attacker-territory', 'player-2': 'defender-territory' },
  }
  const activeIds = new Set(['sce-knight-questor-1', 'skv-clawlord-1'])
  state = {
    ...state,
    models: state.models.map((model) => ({
      ...model,
      presence: activeIds.has(model.id) ? 'ON_BATTLEFIELD' as const : 'OFF_BOARD' as const,
      position: model.id === 'sce-knight-questor-1' ? { x: 10, y: 10 }
        : model.id === 'skv-clawlord-1' ? { x: 30, y: 10 } : model.position,
    })),
    gameSystemState: {
      ...state.gameSystemState!,
      data: { status: 'deployment', setup: (state.gameSystemState!.data as Record<string, JsonValue>).setup,
        deployment } as unknown as JsonValue,
    },
  }
  state = command(state, 'aos/battle/start', 'player-1')
  state = command(state, 'aos/battle/choose-first-player', 'player-1', { firstPlayerId: 'player-1' })
  state = command(state, 'aos/battle/continue', 'player-1')
  state = command(state, 'aos/battle/end-phase', 'player-1')
  return command(state, 'aos/battle/end-phase', 'player-1')
}

function declare(state: GameState, unitId: string, actionId: string, rollRecordId?: string): GameState {
  const unit = state.units.find((candidate) => candidate.id === unitId)!
  return command(state, 'aos/movement/declare', unit.ownerId, {
    unitId, actionId, ...(rollRecordId ? { rollRecordId } : {}),
  })
}

function recordRoll(state: GameState, sides: number, result: number): { state: GameState; id: string } {
  const id = `dice-${state.nextActionSequence}`
  const rolled = rollDice({ count: 1, sides }, { next: () => (result - 0.5) / sides })
  return {
    state: gameReducer(state, { type: 'dice/rollRecorded', playerId: state.gameContext.activePlayerId, result: rolled }),
    id,
  }
}

function recordChargeRoll(state: GameState, first: number, second: number): { state: GameState; id: string } {
  const id = `dice-${state.nextActionSequence}`
  let index = 0
  const results = [first, second]
  const rolled = rollDice({ count: 2, sides: 6 }, { next: () => (results[index++] - 0.5) / 6 })
  return { state: gameReducer(state, { type: 'dice/rollRecorded', playerId: state.gameContext.activePlayerId, result: rolled }), id }
}

function chargePhaseState(): GameState {
  let state = movementPhaseState()
  state = command(state, 'aos/battle/end-phase', 'player-1')
  return command(state, 'aos/battle/end-phase', 'player-1')
}

function combatPhaseState(): GameState {
  return command(chargePhaseState(), 'aos/battle/end-phase', 'player-1')
}

describe('Age of Sigmar movement abilities', () => {
  it('uses the injected dice-engine random source for genuine Run results', () => {
    expect(rollAosMovementActionDie('RUN', { next: () => 0 }).finalResults).toEqual([1])
    expect(rollAosMovementActionDie('RUN', { next: () => 0.999 }).finalResults).toEqual([6])
  })

  it('rolls retained Charge distance through the generic dice engine', () => {
    expect(rollAosCharge({ next: () => 0 }).finalResults).toEqual([1, 1])
    expect(rollAosCharge({ next: () => 0.999 }).finalResults).toEqual([6, 6])
  })

  it('declares Charge in the Charge Phase and requires a legal visible-enemy finish', () => {
    let state = chargePhaseState()
    expect(aosMovementAvailability(state, 'sce-knight-questor').available).toEqual(['CHARGE'])
    expect(aosMovementAvailability(state, 'skv-clawlord').available).toEqual([])
    const recorded = recordChargeRoll(state, 3, 4)
    state = declare(recorded.state, 'sce-knight-questor', 'CHARGE', recorded.id)
    const resolution = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(resolution.allowed && resolution.context).toMatchObject({
      label: 'Charge', movementAllowanceByModel: { 'sce-knight-questor-1': 7 },
      destinationConstraints: [{ type: 'ANY_SOURCE_WITHIN_TARGETS', maximumDistance: 0.5 }],
    })
    const context = resolution.allowed ? resolution.context : undefined
    expect(context && validateCandidateFormation({
      allModels: state.models.filter((model) => model.presence === 'ON_BATTLEFIELD'),
      battlefield: state.battlefield,
      positions: { 'sce-knight-questor-1': { x: 12, y: 10 } },
      destinationConstraints: context.destinationConstraints,
    }).violations).toContainEqual(expect.objectContaining({ type: 'DESTINATION_RELATIONSHIP_FAILED' }))
  })

  it('feeds the same Charge context to Smart Move and finds an exact legal finish', () => {
    let state = chargePhaseState()
    state = { ...state, models: state.models.map((model) => model.id === 'skv-clawlord-1'
      ? { ...model, position: { x: 18, y: 10 } } : model) }
    const recorded = recordChargeRoll(state, 3, 4)
    state = declare(recorded.state, 'sce-knight-questor', 'CHARGE', recorded.id)
    const resolution = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(resolution.allowed).toBe(true)
    if (!resolution.allowed) return
    const result = solveSmartMove({
      allModels: state.models.filter((model) => model.presence === 'ON_BATTLEFIELD'), units: state.units,
      battlefield: state.battlefield, selectedModelIds: ['sce-knight-questor-1'], target: { x: 18, y: 10 },
      movementRemaining: resolution.context.movementAllowanceByModel,
      movementPolicy: { type: 'movement-envelope' },
      separationConstraints: resolution.context.separationConstraints,
      destinationConstraints: resolution.context.destinationConstraints,
      searchBudgetMs: 1_000,
    })
    expect(result.valid).toBe(true)
    expect(result.formationValidation?.valid).toBe(true)
  })

  it('commits Charge as one persisted fact and Cancel preserves its revealed 2D6 roll', () => {
    let state = chargePhaseState()
    state = { ...state, models: state.models.map((model) => model.id === 'skv-clawlord-1'
      ? { ...model, position: { x: 18, y: 10 } } : model) }
    const recorded = recordChargeRoll(state, 3, 4)
    state = declare(recorded.state, 'sce-knight-questor', 'CHARGE', recorded.id)
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/sessionStarted', sessionId: 'cancel-charge', modelIds: ['sce-knight-questor-1'],
    })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, { type: 'movement/cancelled' })
    expect(aosMovementAvailability(state, 'sce-knight-questor').selected).toMatchObject({
      actionId: 'CHARGE', rollRecordId: recorded.id, rollResult: 7,
    })
    expect(state.diceHistory).toHaveLength(1)

    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { 'sce-knight-questor-1': { x: 10, y: 10 } },
      finalPositions: { 'sce-knight-questor-1': { x: 15.5, y: 10 } },
      paths: { 'sce-knight-questor-1': [{ x: 10, y: 10 }, { x: 15.5, y: 10 }] },
      movementUsed: { 'sce-knight-questor-1': 5.5 },
    })
    const cloned = structuredClone(state)
    expect(ensureAosMovementState(cloned.gameSystemState!.data as unknown as AosMatchStateData).facts.at(-1))
      .toMatchObject({ actionId: 'CHARGE', rollResult: 7, rollRecordId: recorded.id })
  })

  it('rejects Charge after Run and when already in combat', () => {
    let state = movementPhaseState()
    const recorded = recordRoll(state, 6, 4)
    state = declare(recorded.state, 'sce-knight-questor', 'RUN', recorded.id)
    const runtime = loadRegisteredMatchRuntime(state, gameSystemRegistry)
    state = reduceGameCommand(runtime, state, { type: 'movement/sessionStarted', sessionId: 'run-before-charge', modelIds: ['sce-knight-questor-1'] })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, { type: 'movement/confirmed' })
    state = command(command(state, 'aos/battle/end-phase', 'player-1'), 'aos/battle/end-phase', 'player-1')
    expect(aosMovementAvailability(state, 'sce-knight-questor').reason).toContain('Ran or Retreated')

    let engaged = chargePhaseState()
    engaged = { ...engaged, models: engaged.models.map((model) => model.id === 'skv-clawlord-1'
      ? { ...model, position: { x: 14.5, y: 10 } } : model) }
    expect(aosMovementAvailability(engaged, 'sce-knight-questor').reason).toContain('in combat')
  })

  it('captures the pile-in target and enforces closer-or-equal plus continued engagement', () => {
    let state = combatPhaseState()
    state = { ...state, models: state.models.map((model) => model.id === 'skv-clawlord-1'
      ? { ...model, position: { x: 14.5, y: 10 } } : model) }
    expect(aosMovementAvailability(state, 'sce-knight-questor')).toMatchObject({
      available: ['PILE_IN'], inCombat: true, eligibleTargetUnitIds: ['skv-clawlord'],
    })
    state = command(state, 'aos/movement/declare', 'player-1', {
      unitId: 'sce-knight-questor', actionId: 'PILE_IN', targetUnitId: 'skv-clawlord',
    })
    const resolution = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(resolution.allowed && resolution.context).toMatchObject({
      label: 'Pile-in', movementAllowanceByModel: { 'sce-knight-questor-1': 3 },
      destinationConstraints: [
        { type: 'EACH_SOURCE_NO_FARTHER_FROM_TARGETS' },
        { type: 'ANY_SOURCE_WITHIN_EACH_TARGET_GROUP', maximumDistance: 3 },
      ],
    })
    const context = resolution.allowed ? resolution.context : undefined
    expect(context && validateCandidateFormation({
      allModels: state.models.filter((model) => model.presence === 'ON_BATTLEFIELD'), battlefield: state.battlefield,
      positions: { 'sce-knight-questor-1': { x: 7, y: 10 } }, destinationConstraints: context.destinationConstraints,
    }).valid).toBe(false)
  })

  it('feeds the same Pile-in context to Smart Move', () => {
    let state = combatPhaseState()
    state = { ...state, models: state.models.map((model) => model.id === 'skv-clawlord-1'
      ? { ...model, position: { x: 14.5, y: 10 } } : model) }
    state = command(state, 'aos/movement/declare', 'player-1', {
      unitId: 'sce-knight-questor', actionId: 'PILE_IN', targetUnitId: 'skv-clawlord',
    })
    const resolution = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(resolution.allowed).toBe(true)
    if (!resolution.allowed) return
    const result = solveSmartMove({
      allModels: state.models.filter((model) => model.presence === 'ON_BATTLEFIELD'), units: state.units,
      battlefield: state.battlefield, selectedModelIds: ['sce-knight-questor-1'], target: { x: 14.5, y: 10 },
      movementRemaining: resolution.context.movementAllowanceByModel, movementPolicy: { type: 'movement-envelope' },
      destinationConstraints: resolution.context.destinationConstraints, searchBudgetMs: 1_000,
    })
    expect(result.valid).toBe(true)
  })

  it('allows the active player only in the Movement Phase and applies exact footprint-edge combat range', () => {
    let state = movementPhaseState()
    expect(aosMovementAvailability(state, 'sce-knight-questor')).toMatchObject({
      available: ['NORMAL_MOVE', 'RUN'], inCombat: false,
    })
    expect(aosMovementAvailability(state, 'skv-clawlord').available).toEqual([])

    const knight = state.models.find((model) => model.id === 'sce-knight-questor-1')!
    const clawlord = state.models.find((model) => model.id === 'skv-clawlord-1')!
    const touchingCombatRange = 20 / 25.4 + 37.5 / 25.4 + 3
    state = { ...state, models: state.models.map((model) => model.id === clawlord.id
      ? { ...model, position: { x: knight.position.x + touchingCombatRange, y: knight.position.y } } : model) }
    expect(unitIsInCombat(state, state.units.find((unit) => unit.id === 'sce-knight-questor')!)).toBe(true)
    expect(aosMovementAvailability(state, 'sce-knight-questor').available).toEqual(['RETREAT'])
  })

  it('resolves Normal Move and Run through one generic action context', () => {
    let state = declare(movementPhaseState(), 'sce-knight-questor', 'NORMAL_MOVE')
    const normal = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(normal.allowed && normal.context).toMatchObject({
      label: 'Normal Move', unitId: 'sce-knight-questor',
      movementAllowanceByModel: { 'sce-knight-questor-1': 5 }, requireCoherency: true,
    })
    expect(normal.allowed && normal.context?.separationConstraints[0]).toMatchObject({
      minimumDistance: 3, duringMovement: true, atDestination: true,
    })

    const recorded = recordRoll(movementPhaseState(), 6, 4)
    state = declare(recorded.state, 'sce-knight-questor', 'RUN', recorded.id)
    const run = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(run.allowed && run.context?.movementAllowanceByModel['sce-knight-questor-1']).toBe(9)
    expect(run.allowed && run.context?.details).toMatchObject({ actionId: 'RUN', moveCharacteristic: 5, rollResult: 4 })
    expect(structuredClone(run.allowed && run.context)).toEqual(run.allowed && run.context)
  })

  it('derives the visual combat-range boundary from the authoritative active context only', () => {
    const normalState = declare(movementPhaseState(), 'sce-knight-questor', 'NORMAL_MOVE')
    const normal = resolveAosMovementContext(normalState, 'sce-knight-questor')
    expect(normal.allowed && aosMovementRuleAssistance(normal.context)).toEqual(
      normal.allowed ? normal.context?.separationConstraints : [],
    )

    let retreatState = movementPhaseState()
    const mover = retreatState.models.find((model) => model.id === 'sce-knight-questor-1')!
    retreatState = { ...retreatState, models: retreatState.models.map((model) => model.id === 'skv-clawlord-1'
      ? { ...model, position: { x: mover.position.x + 4.5, y: mover.position.y } } : model) }
    const recorded = recordRoll(retreatState, 3, 2)
    retreatState = declare(recorded.state, 'sce-knight-questor', 'RETREAT', recorded.id)
    const retreat = resolveAosMovementContext(retreatState, 'sce-knight-questor')
    expect(retreat.allowed && aosMovementRuleAssistance(retreat.context)).toEqual([])
  })

  it('records one Run fact, prevents a second Core move, and keeps the revealed roll beyond Undo', () => {
    const recorded = recordRoll(movementPhaseState(), 6, 5)
    let state = declare(recorded.state, 'sce-knight-questor', 'RUN', recorded.id)
    const runtime = loadRegisteredMatchRuntime(state, gameSystemRegistry)
    state = reduceGameCommand(runtime, state, {
      type: 'movement/sessionStarted', sessionId: 'run', modelIds: ['sce-knight-questor-1'],
    })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/requested', positions: { 'sce-knight-questor-1': { x: 12, y: 10 } },
    })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, { type: 'movement/confirmed' })
    expect(ensureAosMovementState(state.gameSystemState!.data as unknown as AosMatchStateData).facts)
      .toHaveLength(1)
    expect(aosMovementAvailability(state, 'sce-knight-questor').reason).toContain('already used')
    expect(aosUnitMovementStatus(state, 'sce-knight-questor')).toMatchObject({
      kind: 'RUN', label: 'MOVED — RUN', baseMove: 5, rollResult: 5, allowance: 10,
    })

    const undone = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'history/undoLastCommitted',
    })
    const movement = (undone.gameSystemState!.data as unknown as { movement: {
      revealedByKey: Record<string, { rollRecordId: string; result: number }>
    } }).movement
    expect(Object.values(movement.revealedByKey)).toContainEqual({ rollRecordId: recorded.id, result: 5 })
    expect(undone.diceHistory).toEqual(state.diceHistory)
  })

  it('cancels a staged Run without consuming the action or duplicating its revealed roll', () => {
    const recorded = recordRoll(movementPhaseState(), 6, 3)
    let state = declare(recorded.state, 'sce-knight-questor', 'RUN', recorded.id)
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/sessionStarted', sessionId: 'cancel-run', modelIds: ['sce-knight-questor-1'],
    })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/cancelled',
    })
    expect(aosMovementAvailability(state, 'sce-knight-questor').selected).toMatchObject({
      actionId: 'RUN', rollRecordId: recorded.id, rollResult: 3,
    })
    expect(ensureAosMovementState(state.gameSystemState!.data as unknown as AosMatchStateData).facts).toHaveLength(0)
    expect(state.diceHistory).toHaveLength(1)
  })

  it('reports active-player unit status without changing movement permission', () => {
    const state = movementPhaseState()
    expect(aosUnitMovementStatus(state, 'sce-knight-questor')).toMatchObject({
      kind: 'READY', label: 'READY TO MOVE', baseMove: 5, allowance: 5,
    })
    expect(aosUnitMovementStatus(state, 'skv-clawlord')).toBeNull()
  })

  it('lets Retreat cross combat range, requires a legal destination, and records D3 mortal damage', () => {
    let state = movementPhaseState()
    const knight = state.models.find((model) => model.id === 'sce-knight-questor-1')!
    const clawlord = state.models.find((model) => model.id === 'skv-clawlord-1')!
    state = { ...state, models: state.models.map((model) => model.id === clawlord.id
      ? { ...model, position: { x: knight.position.x + 4.5, y: knight.position.y } } : model) }
    const recorded = recordRoll(state, 3, 2)
    state = declare(recorded.state, 'sce-knight-questor', 'RETREAT', recorded.id)
    const resolution = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(resolution.allowed && resolution.context?.separationConstraints[0]).toMatchObject({
      minimumDistance: 3, duringMovement: false, atDestination: true,
    })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/validatedCandidateApplied',
      startingPositions: { [knight.id]: knight.position }, finalPositions: { [knight.id]: { x: 5, y: 10 } },
      paths: { [knight.id]: [knight.position, { x: 5, y: 10 }] },
      movementUsed: { [knight.id]: 5 },
    })
    const fact = ((state.gameSystemState!.data as unknown as { movement: { facts: Array<Record<string, unknown>> } }).movement.facts).at(-1)
    expect(fact).toMatchObject({ actionId: 'RETREAT', retreatMortalDamage: 2 })
  })

  it('uses the same declaration and context for manual and Smart Move entry points', () => {
    const state = declare(movementPhaseState(), 'sce-knight-questor', 'NORMAL_MOVE')
    const runtime = loadRegisteredMatchRuntime(state, gameSystemRegistry)
    const authorization = authorizeMovement(runtime, state, ['sce-knight-questor-1'])
    const manual = reduceGameCommand(runtime, state, {
      type: 'movement/sessionStarted', sessionId: 'manual', modelIds: ['sce-knight-questor-1'],
    })
    expect(authorization.allowed && authorization.actionContext?.id).toBe(manual.movementSession?.actionContext?.id)
    expect(manual.movementSession?.movementAllowanceByModel).toEqual({ 'sce-knight-questor-1': 5 })
  })

  it('stops a Normal Move at the exact enemy combat-range frontier', () => {
    let state = movementPhaseState()
    const enemyId = 'skv-clawlord-1'
    state = { ...state, models: state.models.map((model) => model.id === enemyId
      ? { ...model, position: { x: 20, y: 10 } } : model) }
    state = declare(state, 'sce-knight-questor', 'NORMAL_MOVE')
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/sessionStarted', sessionId: 'combat-frontier', modelIds: ['sce-knight-questor-1'],
    })
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/requested', positions: { 'sce-knight-questor-1': { x: 19, y: 10 } },
    })
    const mover = state.models.find((model) => model.id === 'sce-knight-questor-1')!
    const enemy = state.models.find((model) => model.id === enemyId)!
    expect(distanceBetweenBases(mover, enemy)).toBeCloseTo(3, 5)
  })

  it('maps FLY to generic model pass-over and combat-range traversal facts', () => {
    let state = movementPhaseState()
    state = {
      ...state,
      unitDefinitions: state.unitDefinitions.map((definition) => definition.id === 'aos-knight-questor'
        ? { ...definition, keywords: [...(definition.keywords ?? []), 'FLY'] } : definition),
    }
    state = declare(state, 'sce-knight-questor', 'NORMAL_MOVE')
    const resolution = resolveAosMovementContext(state, 'sce-knight-questor')
    expect(resolution.allowed && resolution.context?.passOverModelIds).toEqual(['sce-knight-questor-1'])
    expect(resolution.allowed && resolution.context?.separationConstraints[0]).toMatchObject({
      duringMovement: false, atDestination: true,
    })
  })

  it('blocks phase advancement while a movement transaction is staged', () => {
    let state = declare(movementPhaseState(), 'sce-knight-questor', 'NORMAL_MOVE')
    state = reduceGameCommand(loadRegisteredMatchRuntime(state, gameSystemRegistry), state, {
      type: 'movement/sessionStarted', sessionId: 'staged', modelIds: ['sce-knight-questor-1'],
    })
    const blocked = command(state, 'aos/battle/end-phase', 'player-1')
    expect(blocked).toBe(state)
  })
})
