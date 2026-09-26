import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { initialGameState } from '../game/initialState'
import { battlefieldFeatureDemoGameState } from '../game/battlefieldFeatureDemo'
import { effectiveTerrainPermissions } from '../engine/terrainPolicy'
import { evaluateUnitCoherency, isCoherencyResultValid } from '../engine/coherency'
import {
  getPlayerForModel,
  getUnitCoherencyPolicy,
  getUnitDefinition,
} from '../game/selectors'
import { DebugPanel } from './DebugPanel'

afterEach(cleanup)

describe('DebugPanel ownership display', () => {
  it('describes authoritative AoS partial damage as unit-level', () => {
    render(<DebugPanel model={initialGameState.models[0]} selectedCount={1} health={2} allocatedDamage={1} />)
    expect(screen.getByText('Health threshold')).toBeTruthy()
    expect(screen.getByText('Current unit damage')).toBeTruthy()
    expect(screen.getByText('Until next model slain')).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(screen.getByText('1 more damage')).toBeTruthy()
  })
  it('renders the Player display name instead of the raw owner ID', () => {
    const model = initialGameState.models[0]
    render(<DebugPanel model={model} selectedCount={1} ownerDisplayName="Player 1" />)
    expect(screen.getByText('Player 1')).toBeTruthy()
    expect(screen.queryByText('player-1')).toBeNull()
  })

  it('reflects a renamed Player without changing model ownership', () => {
    const state = structuredClone(initialGameState)
    state.players[0].displayName = 'Kay'
    const model = state.models[0]
    render(<DebugPanel model={model} selectedCount={1} ownerDisplayName={getPlayerForModel(state, model)?.displayName} />)
    expect(screen.getByText('Kay')).toBeTruthy()
    expect(model.ownerId).toBe('player-1')
  })

  it('renders authoritative unit policy and live coherency data', () => {
    const unit = initialGameState.units[2]
    const model = initialGameState.models.find((candidate) => candidate.id === unit.modelIds[0])!
    const definition = getUnitDefinition(initialGameState, unit)!
    const policy = getUnitCoherencyPolicy(initialGameState, unit)!
    const coherency = evaluateUnitCoherency(unit, initialGameState.models, policy)

    render(<DebugPanel
      model={model}
      selectedCount={1}
      ownerDisplayName={getPlayerForModel(initialGameState, model)?.displayName}
      unitName={definition.name}
      unitModelCount={unit.modelIds.length}
      movementAllowance={definition.movementAllowance}
      coherencyPolicy={policy}
      coherency={coherency}
      coherencyValid={isCoherencyResultValid(coherency, policy)}
    />)

    expect(screen.getByText('Oval Cavalry')).toBeTruthy()
    expect(screen.getByText('Player 1')).toBeTruthy()
    expect(screen.getByText('Oval 75 × 42mm @ 0°')).toBeTruthy()
    expect(screen.getByText('10.00″')).toBeTruthy()
    expect(screen.getByText('1.00″')).toBeTruthy()
    expect(screen.getAllByText('Valid')).toHaveLength(2)
    expect(screen.getByText('Yes')).toBeTruthy()
    expect(screen.getByText('Components')).toBeTruthy()
  })

  it('derives Invalid from current model positions instead of cached UI text', () => {
    const state = structuredClone(initialGameState)
    const unit = state.units[0]
    const model = state.models.find((candidate) => candidate.id === unit.modelIds[0])!
    model.position = { x: 55, y: 40 }
    const definition = getUnitDefinition(state, unit)!
    const policy = getUnitCoherencyPolicy(state, unit)!
    const coherency = evaluateUnitCoherency(unit, state.models, policy)

    render(<DebugPanel
      model={model}
      selectedCount={1}
      unitName={definition.name}
      unitModelCount={unit.modelIds.length}
      movementAllowance={definition.movementAllowance}
      coherencyPolicy={policy}
      coherency={coherency}
      coherencyValid={isCoherencyResultValid(coherency, policy)}
    />)

    expect(screen.getAllByText('Invalid')).toHaveLength(2)
    expect(screen.getByText('No')).toBeTruthy()
    expect(screen.getByText(`0 / ${policy.requiredNeighbors}`)).toBeTruthy()
  })

  it('shows movement used and remaining for the current operation', () => {
    const model = initialGameState.models[0]
    render(<DebugPanel
      model={model}
      selectedCount={1}
      movementAllowance={6}
      movementUsed={2.4}
      movementRemaining={3.6}
    />)
    expect(screen.getByText('Movement Used')).toBeTruthy()
    expect(screen.getByText('2.40″')).toBeTruthy()
    expect(screen.getByText('Movement Remaining')).toBeTruthy()
    expect(screen.getByText('3.60″')).toBeTruthy()
  })

  it('shows a homogeneous hull unit and the selected model footprint dimensions', () => {
    const unit = initialGameState.units.find((candidate) => candidate.id === 'unit-vehicles')!
    const model = initialGameState.models.find((candidate) => candidate.id === unit.modelIds[0])!
    render(<DebugPanel
      model={model}
      selectedCount={1}
      unitName="Vehicle / Hull Unit"
      unitModelCount={unit.modelIds.length}
      unitBaseLabel="Hull 105 × 44 mm"
    />)
    expect(screen.getByText('Unit Bases')).toBeTruthy()
    expect(screen.getByText('Hull 105 × 44 mm')).toBeTruthy()
    expect(screen.getByText('Hull 105 × 44mm (6-point) @ 0°')).toBeTruthy()
  })

  it('labels selected-model terrain permissions separately from current occupancy', () => {
    const state = battlefieldFeatureDemoGameState
    const crossingModel = state.models.find((model) => model.id === 'qa-phaser')!
    const ruinPermissions = effectiveTerrainPermissions(crossingModel.id,
      state.battlefieldFeatures, state.terrainPolicy, new Set(['demo-ruin']))
    const view = render(<DebugPanel model={crossingModel} selectedCount={1}
      terrainRelationships={[]} effectiveTerrainPermissions={ruinPermissions} />)
    expect(screen.getByText('CURRENT TERRAIN RELATION')).toBeTruthy()
    expect(screen.getByText('None')).toBeTruthy()
    expect(screen.getByText('EFFECTIVE TERRAIN PERMISSIONS')).toBeTruthy()
    expect(screen.getByText('For this selected model only')).toBeTruthy()
    expect(screen.getByText('Wall B · Object').parentElement?.textContent).toContain('Cross: Yes')
    expect(screen.getByText('Wall B · Object').parentElement?.textContent).toContain('Finish: No')

    const groundPermissions = effectiveTerrainPermissions(crossingModel.id,
      state.battlefieldFeatures, state.terrainPolicy, new Set(['demo-impassable']))
    view.rerender(<DebugPanel model={crossingModel} selectedCount={1}
      terrainRelationships={[]} effectiveTerrainPermissions={groundPermissions} />)
    const base = screen.getByText('Base').parentElement?.textContent
    expect(base).toContain('Enter: No')
    expect(base).toContain('Cross: No')
    expect(base).toContain('Finish: No')
  })
})
