export type PostMovementCommitView = {
  activeTool: 'select'
  contextPanel: 'movement' | 'inspector'
}

/** Return to ordinary selection after a committed staged movement action. */
export function postMovementCommitView(gameSystemId: string | undefined, movementPhaseActive: boolean): PostMovementCommitView {
  return {
    activeTool: 'select',
    contextPanel: gameSystemId === 'age-of-sigmar' && movementPhaseActive ? 'movement' : 'inspector',
  }
}

