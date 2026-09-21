import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { initialGameState } from './game/initialState'
import { canUndoLastMovement, getMovementAllowance, getUnitDefinition } from './game/selectors'
import { TabletopCanvas } from './rendering/pixi/TabletopCanvas'
import { gameReducer } from './state/reducer'
import { measureBetweenCircularModels, type MeasurementPair } from './tools/measurement'
import { DebugPanel } from './ui/DebugPanel'
import { Toolbar, type ActiveTool } from './ui/Toolbar'
import { MovementPanel, type MovementSummary } from './ui/MovementPanel'
import { isEditableKeyboardTarget, isUndoMovementShortcut } from './tools/keyboard'
import './styles.css'

export default function App() {
  const [gameState, dispatch] = useReducer(gameReducer, initialGameState)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [measurementStartId, setMeasurementStartId] = useState<string | null>(null)
  const [measurementPair, setMeasurementPair] = useState<MeasurementPair | null>(null)
  const [resetCameraSignal, setResetCameraSignal] = useState(0)

  const selectedModel = useMemo(
    () => gameState.models.find((model) => selectedIds.has(model.id)),
    [gameState.models, selectedIds],
  )

  const selectedWholeUnit = useMemo(() => gameState.units.find((unit) =>
    unit.modelIds.length === selectedIds.size && unit.modelIds.every((id) => selectedIds.has(id))), [gameState.units, selectedIds])
  const selectedWholeUnitName = selectedWholeUnit
    ? getUnitDefinition(gameState, selectedWholeUnit)?.name
    : undefined

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">FIELDCRAFT</div>
          <div className="brand-subtitle">COMPETITIVE TABLETOP LAB</div>
        </div>
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
          resetCameraSignal={resetCameraSignal}
          onSelectionChange={setSelectedIds}
          onMeasureModel={handleMeasureModel}
          dispatch={dispatch}
        />
        <DebugPanel model={selectedModel} selectedCount={selectedIds.size} wholeUnitName={selectedWholeUnitName} />
        {movementSummary && (
          <MovementPanel
            summary={movementSummary}
            onConfirm={() => dispatch({ type: 'movement/confirmed' })}
            onCancel={() => dispatch({ type: 'movement/cancelled' })}
          />
        )}
      </section>
      <footer className="statusbar">
        <span><i className="legend-swatch player-a" /> PLAYER A</span>
        <span><i className="legend-swatch player-b" /> PLAYER B</span>
        <span className="statusbar-spacer" />
        <span>COORDINATES: INCHES</span>
        <span>ORIGIN: TOP LEFT</span>
      </footer>
    </main>
  )
}
