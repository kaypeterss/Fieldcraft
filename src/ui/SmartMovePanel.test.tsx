import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SmartMoveResult } from '../engine/smartMove'
import { SmartMovePanel } from './SmartMovePanel'

afterEach(() => cleanup())

const validResult: SmartMoveResult = {
  valid: true,
  target: { x: 10, y: 10 },
  unitId: 'unit-a',
  selectedModelIds: ['a'],
  positions: { a: { x: 10, y: 10 } },
  assignments: [],
  totalMovementCost: 2,
  validation: { movement: true, collision: true, battlefield: true, coherency: true },
  formationValidation: null,
  coherency: null,
  failureReasons: [],
  candidatesTested: 1,
  diagnostics: {
    solverStage: 'DIRECT_MAXIMUM',
    selectedModels: 1,
    totalAvailableUsefulMovement: 2,
    totalActualPathMovement: 2,
    totalTargetProgress: 2,
    averageTargetProgress: 2,
    averageUsefulProgressPercent: 100,
    minimumUsefulProgressPercent: 100,
    fastPathAccepted: true,
    fallbackUsed: false,
    fallbackReasons: [],
    fallbackOrder: [],
    candidatePositionsGenerated: 0,
    candidatePositionsDeduplicated: 0,
    pathfindingCalls: 2,
    directPathChecks: 2,
    directPaths: 2,
    routedPaths: 0,
    failedPaths: 0,
    coherencyEvaluations: 1,
    backtrackingNodes: 0,
    finalValidations: 0,
    searchBudgetExhausted: false,
    requestSetupMs: 0.01,
    fastPathValidationMs: 0.2,
    fallbackOrderingMs: 0,
    candidateGenerationMs: 0,
    candidateDeduplicationMs: 0,
    collisionFilteringMs: 0,
    pathfindingMs: 0.1,
    provisionalCoherencyMs: 0,
    finalValidationMs: 0,
    candidateScoringMs: 0,
    fallbackSearchMs: 0,
    solveTimeMs: 0.3,
  },
}

function renderPanel(
  result: SmartMoveResult | null,
  message?: string,
  targetMode: 'live' | 'locked' = 'live',
  async: {
    status?: 'idle' | 'calculating' | 'ready-valid' | 'ready-invalid' | 'error'
    thinkingVisible?: boolean
    canApply?: boolean
    errorMessage?: string
  } = {},
) {
  const onApply = vi.fn()
  const onCancel = vi.fn()
  render(
    <SmartMovePanel
      selectedCount={1}
      unitSize={5}
      unitName="Vanguard"
      targetMode={targetMode}
      coherencyPolicy={{ distance: 2, requiredNeighbors: 3 }}
      result={result}
      asyncStatus={async.status ?? (result?.valid ? 'ready-valid' : result ? 'ready-invalid' : 'idle')}
      thinkingVisible={async.thinkingVisible ?? false}
      canApply={async.canApply ?? Boolean(result?.valid)}
      errorMessage={async.errorMessage}
      message={message}
      onApply={onApply}
      onCancel={onCancel}
    />,
  )
  return { onApply, onCancel }
}

describe('Smart Move panel', () => {
  it('waits for a target and allows cancellation without enabling Apply', () => {
    const { onCancel } = renderPanel(null)
    expect(screen.getByText('AWAITING TARGET')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply Move' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows a valid preview and applies only when requested', () => {
    const { onApply } = renderPanel(validResult)
    expect(screen.getByText('VALID')).toBeTruthy()
    expect(screen.getByText('1 / 5 models')).toBeTruthy()
    expect(screen.getByText('Vanguard')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('2″')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('Direct Maximum')).toBeTruthy()
    expect(screen.getAllByText('100%')).toHaveLength(2)
    const apply = screen.getByRole('button', { name: 'Apply Move' })
    expect((apply as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(apply)
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('shows the locked state without changing the candidate', () => {
    const { onApply } = renderPanel(validResult, undefined, 'locked')
    expect(screen.getByText('Locked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply Move' }))
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('disables Apply and explains an invalid preview', () => {
    renderPanel({
      ...validResult,
      valid: false,
      validation: { movement: false, collision: true, battlefield: true, coherency: false },
      failureReasons: ['MOVEMENT_LIMIT', 'COHERENCY'],
      candidatesTested: 8,
    })
    expect(screen.getByText('INVALID')).toBeTruthy()
    expect(screen.getByText('MOVEMENT LIMIT · COHERENCY')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply Move' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a stale ghost visible but disables Apply while the current intent calculates', () => {
    renderPanel(validResult, undefined, 'live', {
      status: 'calculating',
      thinkingVisible: true,
      canApply: false,
    })
    expect(screen.getByText('CALCULATING')).toBeTruthy()
    expect(screen.getByText('Calculating...')).toBeTruthy()
    expect(screen.getByText('Direct Maximum')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply Move' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows compact worker failure feedback without enabling Apply', () => {
    renderPanel(null, undefined, 'locked', {
      status: 'error',
      errorMessage: 'Unable to calculate Smart Move',
      canApply: false,
    })
    expect(screen.getByText('ERROR')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Unable to calculate')
    expect((screen.getByRole('button', { name: 'Apply Move' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
