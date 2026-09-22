import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SmartMoveResult } from '../engine/smartMove'
import { SmartMovePanel } from './SmartMovePanel'
import { smartMoveBadge } from './smartMoveStatus'

afterEach(() => cleanup())

const previousValidResult: SmartMoveResult = {
  valid: true,
  target: { x: 10, y: 5 },
  selectedModelIds: ['model-a'],
  positions: { 'model-a': { x: 10, y: 5 } },
  assignments: [],
  totalMovementCost: 0,
  validation: { movement: true, collision: true, battlefield: true, coherency: true },
  formationValidation: null,
  coherency: null,
  failureReasons: [],
  candidatesTested: 1,
  diagnostics: null,
}

describe('Smart Move status', () => {
  it('shows neutral Calculating even when a previous valid ghost remains', () => {
    render(<SmartMovePanel
      selectedCount={1} unitSize={1} targetMode="locked"
      result={previousValidResult} asyncStatus="calculating" thinkingVisible
      canApply={false} onApply={vi.fn()} onCancel={vi.fn()}
    />)
    const badge = screen.getByText('CALCULATING')
    expect(badge.className).toContain('neutral')
    expect(screen.getByRole('button', { name: 'Apply Move' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('Candidates tested')).toBeNull()
  })

  it('keeps search limit in a warning tone and errors in a failure tone', () => {
    expect(smartMoveBadge('search-limit')).toEqual({ label: 'SEARCH LIMIT', tone: 'warning' })
    expect(smartMoveBadge('error')).toEqual({ label: 'ERROR', tone: 'invalid' })
    expect(smartMoveBadge('ready-valid').tone).toBe('valid')
    expect(smartMoveBadge('ready-invalid').tone).toBe('invalid')
  })
})
