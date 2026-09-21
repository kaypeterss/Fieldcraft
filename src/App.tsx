import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { initialGameState } from './game/initialState'
import { canUndoLastMovement, getMovementAllowance, getPlayerForModel, getUnitDefinition, getUnitForModel } from './game/selectors'
import { TabletopCanvas } from './rendering/pixi/TabletopCanvas'
import { gameReducer } from './state/reducer'
import { measureBetweenCircularModels, type MeasurementPair } from './tools/measurement'
import { DebugPanel } from './ui/DebugPanel'
import { Toolbar, type ActiveTool } from './ui/Toolbar'
import { MovementPanel, type MovementSummary } from './ui/MovementPanel'
import { isEditableKeyboardTarget, isUndoMovementShortcut } from './tools/keyboard'
import { evaluateUnitCoherency, type CoherencyPolicy } from './engine/coherency'
import type { SpatialMode, SpatialOverlayConfig } from './tools/spatialOverlay'
import { SpatialPanel } from './ui/SpatialPanel'
import { GameStatusPanel } from './ui/GameStatusPanel'
import './styles.css'

export default function App() {
  const [gameState, dispatch] = useReducer(gameReducer, initialGameState)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [measurementStartId, setMeasurementStartId] = useState<string | null>(null)
  const [measurementPair, setMeasurementPair] = useState<MeasurementPair | null>(null)
  const [resetCameraSignal, setResetCameraSignal] = useState(0)
  const [spatialMode, setSpatialMode] = useState<SpatialMode>('range')
  const [rangeInches, setRangeInches] = useState(3)
  const [requiredSeparation, setRequiredSeparation] = useState(3)
  const [targetBaseDiameterMm, setTargetBaseDiameterMm] = useState(32)
  const [coherencyPolicy, setCoherencyPolicy] = useState<CoherencyPolicy>({ distance: 1, requiredNeighbors: 1 })
  const [blockedMovementSessionId, setBlockedMovementSessionId] = useState<string | null>(null)

  const selectedModel = useMemo(
    () => gameState.models.find((model) => selectedIds.has(model.id)),
    [gameState.models, selectedIds],
  )

  const selectedWholeUnit = useMemo(() => gameState.units.find((unit) =>
    unit.modelIds.length === selectedIds.size && unit.modelIds.every((id) => selectedIds.has(id))), [gameState.units, selectedIds])
  const selectedWholeUnitName = selectedWholeUnit
    ? getUnitDefinition(gameState, selectedWholeUnit)?.name
    : undefined

  const spatialSourceIds = useMemo(() => {
    if (selectedWholeUnit) return selectedWholeUnit.modelIds
    return selectedModel ? [selectedModel.id] : []
  }, [selectedModel, selectedWholeUnit])

  const coherencyUnit = useMemo(
    () => selectedWholeUnit ?? (selectedIds.size === 1 && selectedModel
      ? getUnitForModel(gameState, selectedModel.id)
      : undefined),
    [gameState, selectedIds.size, selectedModel, selectedWholeUnit],
  )

  const coherency = useMemo(
    () => coherencyUnit
      ? evaluateUnitCoherency(coherencyUnit, gameState.models, coherencyPolicy)
      : null,
    [coherencyPolicy, coherencyUnit, gameState.models],
  )

  const spatialOverlay = useMemo<SpatialOverlayConfig | null>(() => activeTool === 'spatial' ? {
    mode: spatialMode,
    sourceModelIds: spatialMode === 'coherency' ? coherencyUnit?.modelIds ?? [] : spatialSourceIds,
    range: rangeInches,
    requiredSeparation,
    targetBaseDiameterMm,
    coherencyPolicy,
    coherency,
  } : null, [activeTool, coherency, coherencyPolicy, coherencyUnit, rangeInches, requiredSeparation, spatialMode, spatialSourceIds, targetBaseDiameterMm])

  const movementSummary = useMemo<MovementSummary | null>(() => {
    const session = gameState.movementSession
    if (!session) return null
    const participants = gameState.models.filter((model) => session.modelIds.includes(model.id))
    const allowances = participants.map((model) => getMovementAllowance(gameState, model))
    const used = participants.map((model) => session.models[model.id]?.movementUsed ?? 0)
    const remaining = participants.map((_, index) => Math.max(0, allowances[index] - used[index]))
    const distinctAllowances = [...new Set(allowances)]
    return {
      participantCount: participants.length,
      allowanceLabel: distinctAllowances.length === 1
        ? `${distinctAllowances[0].toFixed(2)}\u2033`
        : `${Math.min(...allowances).toFixed(2)}–${Math.max(...allowances).toFixed(2)}\u2033`,
      maximumUsed: Math.max(0, ...used),
      minimumRemaining: Math.min(...remaining),
    }
  }, [gameState])

  const measurement = useMemo(() => {
    if (!measurementPair) return null
    const from = gameState.models.find((model) => model.id === measurementPair.fromModelId)
    const to = gameState.models.find((model) => model.id === measurementPair.toModelId)
    return from && to ? measureBetweenCircularModels(from, to) : null
  }, [gameState.models, measurementPair])

  const changeTool = useCallback((tool: ActiveTool) => {
    setActiveTool(tool)
    if (tool !== 'measure') setMeasurementStartId(null)
  }, [])

  const handleMeasureModel = useCallback((id: string) => {
    if (!measurementStartId || measurementStartId === id) {
      setMeasurementStartId(id)
      setMeasurementPair(null)
      return
    }
    const from = gameState.models.find((model) => model.id === measurementStartId)
    const to = gameState.models.find((model) => model.id === id)
    if (from && to) setMeasurementPair({ fromModelId: from.id, toModelId: to.id })
    setMeasurementStartId(null)
  }, [gameState.models, measurementStartId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return
      if (isUndoMovementShortcut(event)) {
        event.preventDefault()
        if (canUndoLastMovement(gameState)) dispatch({ type: 'movement/undoLastConfirmed' })
        return
      }
      if (event.key === 'Enter' && gameState.movementSession && !event.isComposing) {
        event.preventDefault()
        dispatch({ type: 'movement/confirmed' })
        return
      }
      if (event.key.toLowerCase() === 'v') changeTool('select')
      if (event.key.toLowerCase() === 'm') changeTool('measure')
      if (event.key.toLowerCase() === 's') changeTool('spatial')
      if (event.key.toLowerCase() === 'f') setResetCameraSignal((value) => value + 1)
      if (event.key === 'Escape') {
        if (gameState.movementSession) {
          dispatch({ type: 'movement/cancelled' })
          return
        }
        setSelectedIds(new Set())
        setMeasurementStartId(null)
        setMeasurementPair(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [changeTool, gameState])

  const handleEndTurn = useCallback(() => {
    if (gameState.movementSession) {
      setBlockedMovementSessionId(gameState.movementSession.id)
      return
    }
    setBlockedMovementSessionId(null)
    dispatch({ type: 'game/turnEnded' })
  }, [gameState.movementSession])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">FIELDCRAFT</div>
          <div className="brand-subtitle">COMPETITIVE TABLETOP LAB</div>
        </div>
        <GameStatusPanel
          gameState={gameState}
          blockedMessage={gameState.movementSession?.id === blockedMovementSessionId
            ? 'Finish or cancel the current movement first.'
            : null}
          onEndTurn={handleEndTurn}
        />
        <div className="session-info">
          <span className="status-dot" /> LOCAL SANDBOX
          <span className="divider" />
          <strong>60 × 44</strong>
        </div>
      </header>
      <Toolbar
        activeTool={activeTool}
        onToolChange={changeTool}
        onResetCamera={() => setResetCameraSignal((value) => value + 1)}
      />
      <section className="workspace">
        <TabletopCanvas
          gameState={gameState}
          activeTool={activeTool}
          selectedIds={selectedIds}
          measurement={measurement}
          measurementStartId={measurementStartId}
          spatialOverlay={spatialOverlay}
          resetCameraSignal={resetCameraSignal}
          onSelectionChange={setSelectedIds}
          onMeasureModel={handleMeasureModel}
          dispatch={dispatch}
        />
        <DebugPanel
          model={selectedModel}
          selectedCount={selectedIds.size}
          wholeUnitName={selectedWholeUnitName}
          ownerDisplayName={selectedModel ? getPlayerForModel(gameState, selectedModel)?.displayName : undefined}
        />
        {activeTool === 'spatial' && (
          <SpatialPanel
            mode={spatialMode}
            range={rangeInches}
            requiredSeparation={requiredSeparation}
            targetBaseDiameterMm={targetBaseDiameterMm}
            coherencyPolicy={coherencyPolicy}
            coherency={coherency}
            sourceCount={spatialMode === 'coherency' ? coherencyUnit?.modelIds.length ?? 0 : spatialSourceIds.length}
            coherencyUnitAvailable={Boolean(coherencyUnit)}
            onModeChange={setSpatialMode}
            onRangeChange={setRangeInches}
            onRequiredSeparationChange={setRequiredSeparation}
            onTargetBaseDiameterChange={setTargetBaseDiameterMm}
            onCoherencyPolicyChange={setCoherencyPolicy}
          />
        )}
        {movementSummary && (
          <MovementPanel
            summary={movementSummary}
            onConfirm={() => dispatch({ type: 'movement/confirmed' })}
            onCancel={() => dispatch({ type: 'movement/cancelled' })}
          />
        )}
      </section>
      <footer className="statusbar">
        <span><i className="legend-swatch player-1" /> PLAYER 1</span>
        <span><i className="legend-swatch player-2" /> PLAYER 2</span>
        <span className="statusbar-spacer" />
        <span>COORDINATES: INCHES</span>
        <span>ORIGIN: TOP LEFT</span>
      </footer>
    </main>
  )
}
