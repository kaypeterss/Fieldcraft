import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoherencyPolicy } from '../engine/coherency'
import { normalizeNumericDraft } from './numberInput'
import { SpatialPanel } from './SpatialPanel'
import { resolveSpatialCoherencyPolicy, resolveSpatialCoherencyUnit } from '../tools/spatialOverlay'

afterEach(() => cleanup())

const policy: CoherencyPolicy = { distance: 1, requiredNeighbors: 1 }

function renderPanel(overrides: Partial<Parameters<typeof SpatialPanel>[0]> = {}) {
  const props: Parameters<typeof SpatialPanel>[0] = {
    mode: 'range',
    range: 3,
    requiredSeparation: 3,
    sourceGeometryLabel: 'Circle 25mm',
    coherencyAnalysisMode: 'unit-policy',
    coherencyPolicy: policy,
    customCoherencyPolicy: policy,
    coherency: null,
    sourceCount: 1,
    coherencyUnitAvailable: false,
    unitPolicyAvailable: false,
    onModeChange: vi.fn(),
    onRangeChange: vi.fn(),
    onRequiredSeparationChange: vi.fn(),
    onCoherencyAnalysisModeChange: vi.fn(),
    onCoherencyPolicyChange: vi.fn(),
    ...overrides,
  }
  render(<SpatialPanel {...props} />)
  return props
}

describe('objective analysis overlay', () => {
  it('shows independent area counts and offers a generic objective selector', () => {
    const onObjectiveChange = vi.fn()
    renderPanel({
      mode: 'objectives',
      objectiveOptions: [{ id: 'signal', name: 'Signal Ruin' }, { id: 'beacon', name: 'Signal Beacon' }],
      selectedObjectiveId: 'signal', onObjectiveChange,
      objectiveAnalysis: {
        featureName: 'Signal Ruin', areaType: 'feature-base', unitName: 'Infantry 10',
        modelRelationship: { placement: 'intersecting', intersects: true, whollyWithin: false,
          centerWithin: true, distanceInches: 0 },
        unitSummary: { modelCount: 10, intersectingCount: 7, whollyWithinCount: 4,
          centerWithinCount: 6, distanceInches: 0, closestModelId: 'one' },
        controlPreview: true,
        control: {
          state: 'controlled', controllingPlayerId: 'player-2',
          players: [
            { playerId: 'player-1', playerName: 'Player 1', qualifyingModelIds: ['a', 'b'],
              qualifyingModelCount: 2, totalControl: 2 },
            { playerId: 'player-2', playerName: 'Player 2', qualifyingModelIds: ['x'],
              qualifyingModelCount: 1, totalControl: 10 },
          ],
        },
      },
    })
    expect(screen.getByText('PROJECTED CONTROL')).toBeTruthy()
    expect(screen.getByText('Controlled by Player 2')).toBeTruthy()
    expect(screen.getByText('10 Control')).toBeTruthy()
    expect(screen.getByText('Infantry 10')).toBeTruthy()
    expect(screen.getByText('7 / 10')).toBeTruthy()
    expect(screen.getByText('4 / 10')).toBeTruthy()
    expect(screen.getByText('6 / 10')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Analyze objective'), { target: { value: 'beacon' } })
    expect(onObjectiveChange).toHaveBeenCalledWith('beacon')
  })
})

describe('visibility analysis overlay', () => {
  it('offers viewer, target, policy, and separate crossing facts', () => {
    const onPolicyChange = vi.fn()
    const onModeChange = vi.fn()
    renderPanel({
      mode: 'visibility',
      modelOptions: [{ id: 'viewer', label: 'Viewer Oval' }, { id: 'target', label: 'Target Hull' }],
      visibilityViewerId: 'viewer',
      visibilityTargetId: 'target',
      visibilityMode: 'any-to-any',
      visibilityPolicy: 'objects-block',
      visibilityAnalysis: {
        viewerId: 'viewer', targetId: 'target', distance: 8,
        mode: 'any-to-any',
        basesCrossed: [{ featureId: 'ruin', featureName: 'Irregular Ruin' }],
        objectsCrossed: [], policy: 'objects-block', visible: true,
        segments: [{ startAnchor: { x: 1, y: 2 }, endAnchor: { x: 9, y: 2 }, blocked: false }],
      },
      onVisibilityModeChange: onModeChange,
      onVisibilityPolicyChange: onPolicyChange,
    })
    expect(screen.getByRole('combobox', { name: 'Viewer' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Target' })).toBeTruthy()
    expect(screen.getByText('Irregular Ruin')).toBeTruthy()
    expect(screen.getByText('VISIBLE')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Any → All' }))
    expect(onModeChange).toHaveBeenCalledWith('any-to-all')
    fireEvent.click(screen.getByRole('button', { name: 'Base Blocks' }))
    expect(onPolicyChange).toHaveBeenCalledWith('base-blocks')
  })

  it('offers direct viewer and target battlefield pick buttons', () => {
    const onPick = vi.fn()
    renderPanel({
      mode: 'visibility',
      modelOptions: [{ id: 'viewer', label: 'Viewer' }, { id: 'target', label: 'Target' }],
      visibilityPickTarget: 'viewer',
      onVisibilityPick: onPick,
    })
    expect(screen.getByRole('button', { name: 'Pick Viewer' }).textContent).toContain('Picking')
    fireEvent.click(screen.getByRole('button', { name: 'Pick Target' }))
    expect(onPick).toHaveBeenCalledWith('target')
  })
})

describe('spatial numeric input editing', () => {
  it('keeps unit policy and custom analysis as explicit independent sources', () => {
    const unitPolicy = { distance: 2, requiredNeighbors: 3, requireConnected: true }
    const customPolicy = { distance: 4, requiredNeighbors: 1, requireConnected: false }
    expect(resolveSpatialCoherencyPolicy('unit-policy', unitPolicy, customPolicy)).toBe(unitPolicy)
    expect(resolveSpatialCoherencyPolicy('custom', unitPolicy, customPolicy)).toBe(customPolicy)

    const onModeChange = vi.fn()
    renderPanel({
      mode: 'coherency',
      coherencyAnalysisMode: 'unit-policy',
      coherencyPolicy: unitPolicy,
      customCoherencyPolicy: customPolicy,
      unitPolicyAvailable: true,
      coherencyUnitAvailable: true,
      onCoherencyAnalysisModeChange: onModeChange,
    })
    expect(screen.getByText('Connected required')).toBeTruthy()
    expect(screen.getByText('Yes')).toBeTruthy()
    expect(screen.queryByLabelText('Neighbor distance')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Custom Analysis' }))
    expect(onModeChange).toHaveBeenCalledWith('custom')
  })

  it('resolves a complete unit from any same-unit partial selection', () => {
    const units = [
      { id: 'unit-a', ownerId: 'player-a', definitionId: 'def-a', modelIds: ['a', 'b', 'c'] },
      { id: 'unit-b', ownerId: 'player-b', definitionId: 'def-b', modelIds: ['x'] },
    ]
    expect(resolveSpatialCoherencyUnit(units, new Set(['a', 'b']))?.id).toBe('unit-a')
    expect(resolveSpatialCoherencyUnit(units, new Set(['a', 'x']))).toBeUndefined()
    expect(resolveSpatialCoherencyUnit(units, new Set())).toBeUndefined()
  })

  it('allows a draft to be empty and replaces 3 with 12 without a leading zero', () => {
    const props = renderPanel()
    const input = screen.getByLabelText('Custom range')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.change(input, { target: { value: '12' } })
    expect((input as HTMLInputElement).value).toBe('12')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRangeChange).toHaveBeenLastCalledWith(12)
  })

  it('accepts decimal range values and preserves the active value on empty commit', () => {
    const props = renderPanel()
    const input = screen.getByLabelText('Custom range')
    fireEvent.change(input, { target: { value: '2.5' } })
    fireEvent.blur(input)
    expect(props.onRangeChange).toHaveBeenLastCalledWith(2.5)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(props.onRangeChange).toHaveBeenLastCalledWith(2.5)
  })

  it('normalizes invalid and negative committed values without NaN', () => {
    expect(normalizeNumericDraft('', { min: 0, fallback: 3 })).toBe(3)
    expect(normalizeNumericDraft('not-a-number', { min: 0, fallback: 3 })).toBe(3)
    expect(normalizeNumericDraft('-5', { min: 0, fallback: 3 })).toBe(0)
    expect(normalizeNumericDraft('2.5', { min: 0, fallback: 3 })).toBe(2.5)
    expect(normalizeNumericDraft('1.9', { min: 0, integer: true, fallback: 1 })).toBe(1)
    expect(Number.isNaN(normalizeNumericDraft('', { min: 0, fallback: 3 }))).toBe(false)
  })

  it('updates custom range and allows a preset to replace it', () => {
    const props = renderPanel()
    const input = screen.getByLabelText('Custom range')
    fireEvent.change(input, { target: { value: '7.5' } })
    fireEvent.blur(input)
    expect(props.onRangeChange).toHaveBeenLastCalledWith(7.5)
    fireEvent.click(screen.getByRole('button', { name: '3″' }))
    expect(props.onRangeChange).toHaveBeenLastCalledWith(3)
  })

  it('keeps Enter inside the input instead of bubbling to movement shortcuts', () => {
    const parentKeyDown = vi.fn()
    render(
      <div onKeyDown={parentKeyDown}>
        <SpatialPanel
          mode="range"
          range={3}
          requiredSeparation={3}
          sourceGeometryLabel="Circle 25mm"
          coherencyAnalysisMode="unit-policy"
          coherencyPolicy={policy}
          customCoherencyPolicy={policy}
          coherency={null}
          sourceCount={1}
          coherencyUnitAvailable={false}
          unitPolicyAvailable={false}
          onModeChange={vi.fn()}
          onRangeChange={vi.fn()}
          onRequiredSeparationChange={vi.fn()}
          onCoherencyAnalysisModeChange={vi.fn()}
          onCoherencyPolicyChange={vi.fn()}
        />
      </div>,
    )
    const input = screen.getByLabelText('Custom range')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('commits exclusion distance decimals and integer neighbor counts separately', () => {
    const separation = vi.fn()
    renderPanel({ mode: 'exclusion', onRequiredSeparationChange: separation })
    const separationInput = screen.getByLabelText('Required separation')
    fireEvent.change(separationInput, { target: { value: '2.5' } })
    fireEvent.blur(separationInput)
    expect(separation).toHaveBeenLastCalledWith(2.5)

    const coherency = vi.fn()
    cleanup()
    renderPanel({ mode: 'coherency', coherencyAnalysisMode: 'custom', onCoherencyPolicyChange: coherency })
    const neighborInput = screen.getByLabelText('Required neighbors')
    fireEvent.change(neighborInput, { target: { value: '' } })
    fireEvent.change(neighborInput, { target: { value: '2' } })
    fireEvent.keyDown(neighborInput, { key: 'Enter' })
    expect(coherency).toHaveBeenLastCalledWith({ distance: 1, requiredNeighbors: 2 })
    fireEvent.change(neighborInput, { target: { value: '-2.5' } })
    fireEvent.blur(neighborInput)
    expect(coherency).toHaveBeenLastCalledWith({ distance: 1, requiredNeighbors: 0 })
  })

  it('shows automatic actual-footprint guidance without manual target controls', () => {
    renderPanel({
      mode: 'exclusion',
      sourceGeometryLabel: 'Rectangle 80×45mm @ 45°',
    })
    expect(screen.getByText('Rectangle 80×45mm @ 45°')).toBeTruthy()
    expect(screen.getByText('Each selected model uses its actual footprint and current orientation.')).toBeTruthy()
    expect(screen.queryByLabelText('Target footprint')).toBeNull()
    expect(screen.queryByText('Manual circle presets')).toBeNull()
  })

  it('asks for a model instead of falling back to a generic exclusion target', () => {
    renderPanel({ mode: 'exclusion', sourceCount: 0 })
    expect(screen.getByText('Select one model or a complete unit to visualize this overlay.')).toBeTruthy()
  })
})
