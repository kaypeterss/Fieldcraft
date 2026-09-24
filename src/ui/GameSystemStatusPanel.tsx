import type { GameSystemUiContribution } from '../gameSystem/registry'
import type { GameState } from '../domain/types'
import { Scoreboard } from './Scoreboard'

export function GameSystemStatusPanel({ ui, gameState, onPrepare, onOpenDeployment, progression, playerMetrics }: {
  ui: GameSystemUiContribution
  gameState?: GameState
  onPrepare?: () => void
  onOpenDeployment?: () => void
  progression?: {
    lifecycle: string
    title: string
    detail?: string
    actionLabel: string
    onAction?: () => void
    disabled?: boolean
  }
  playerMetrics?: Readonly<Record<string, readonly { label: string; value: string | number }[]>>
}) {
  const deploymentData = gameState?.gameSystemState?.data && typeof gameState.gameSystemState.data === 'object'
    && !Array.isArray(gameState.gameSystemState.data)
    ? gameState.gameSystemState.data.deployment : undefined
  const ready = deploymentData && typeof deploymentData === 'object' && !Array.isArray(deploymentData)
    && deploymentData.phase === 'READY_FOR_BATTLE'
  return (
    <section className="game-system-status" aria-label="GameSystem status">
      {gameState && <Scoreboard players={gameState.players} events={gameState.scoreHistory ?? []}
        playerMetrics={playerMetrics} showControls={false} />}
      <div className="shell-state-summary">
        <span>{progression?.lifecycle ?? gameState?.matchLifecycle ?? 'SETUP'}</span>
        <strong>{progression?.title ?? (gameState?.matchLifecycle === 'DEPLOYMENT'
          ? ready ? 'Ready for battle' : 'Deployment in progress'
          : ui.status.title)}</strong>
      </div>
      {progression
        ? <button type="button" className="primary-progression" disabled={progression.disabled || !progression.onAction}
          onClick={progression.onAction}>{progression.actionLabel}</button>
        : gameState?.matchLifecycle === 'SETUP' && onPrepare
        ? <button type="button" className="primary-progression" onClick={onPrepare}>Prepare Match</button>
        : onOpenDeployment
          ? <button type="button" className="primary-progression" onClick={onOpenDeployment}>
              {ready ? 'Review Deployment' : 'Deployment'}
            </button>
          : <button type="button" className="primary-progression" disabled>Continue</button>}
      {!progression && gameState?.matchLifecycle === 'DEPLOYMENT' && <small className="progression-hint">
        {ready ? 'Deployment complete · Round 1 begins in M9.4.' : 'Resolve roles, territories, then alternate Deploy Unit abilities.'}
      </small>}
      {progression?.detail && <small className="progression-hint">{progression.detail}</small>}
    </section>
  )
}
