import type { GameAction, GameContext } from '../domain/types'

export function actionsInRound(actions: readonly GameAction[], round: number): GameAction[] {
  return actions.filter((action) => action.round === round)
}

export function actionsInTurn(actions: readonly GameAction[], context: Pick<GameContext, 'turnId'>): GameAction[] {
  return actions.filter((action) => action.turnId === context.turnId)
}

export function actionsByPlayerInTurn(
  actions: readonly GameAction[],
  playerId: string,
  context: Pick<GameContext, 'turnId'>,
): GameAction[] {
  return actionsInTurn(actions, context).filter((action) => action.playerId === playerId)
}

export function actionsByUnitInTurn(
  actions: readonly GameAction[],
  unitId: string,
  context: Pick<GameContext, 'turnId'>,
): GameAction[] {
  return actionsInTurn(actions, context).filter(
    (action) => action.type === 'MOVE' && action.payload.unitIds.includes(unitId),
  )
}

export function hasUnitPerformedAction(
  actions: readonly GameAction[],
  unitId: string,
  actionType: GameAction['type'],
  context: Pick<GameContext, 'turnId'>,
): boolean {
  return actionsByUnitInTurn(actions, unitId, context).some((action) => action.type === actionType)
}

export function mostRecentAction(actions: readonly GameAction[]): GameAction | undefined {
  return actions.at(-1)
}
