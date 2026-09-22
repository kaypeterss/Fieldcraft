import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { footprintDemoGameState, initialGameState, orientationGapGameState } from './game/initialState'
import type { GameState, MovementPolicyConfig } from './domain/types'
import {
  canUndoLastMovement,
  getMovementAllowance,
  getPlayerForModel,
  getUnitCoherencyPolicy,
  getUnitBaseLabel,
  getUnitDefinition,
  getUnitForModel,
} from './game/selectors'
import { TabletopCanvas } from './rendering/pixi/TabletopCanvas'
import { gameReducer } from './state/reducer'
import type { GameStateAction } from './state/actions'
import {
  measureBetweenTargets,
  type MeasurementPair,
  type MeasurementTarget,
} from './tools/measurement'
import { DebugPanel } from './ui/DebugPanel'
import { Toolbar, type ActiveTool } from './ui/Toolbar'
import { MovementPanel, type MovementSummary } from './ui/MovementPanel'
import { MovementCostPolicyPanel } from './ui/MovementCostPolicyPanel'
import { isEditableKeyboardTarget, isUndoMovementShortcut } from './tools/keyboard'
import { evaluateUnitCoherency, isCoherencyResultValid, type CoherencyPolicy } from './engine/coherency'
import {
  resolveSpatialCoherencyPolicy,
  resolveSpatialCoherencyUnit,
  describeFootprint,
  describeSpatialSources,
  type CoherencyAnalysisMode,
  type SpatialMode,
  type SpatialOverlayConfig,
} from './tools/spatialOverlay'
import { SpatialPanel } from './ui/SpatialPanel'
import { GameStatusPanel } from './ui/GameStatusPanel'
import type { SmartMoveRequest } from './engine/smartMove'
import { validateCandidateFormation } from './engine/candidateFormation'
import { GEOMETRY_EPSILON } from './engine/geometry/tolerance'
import { SmartMovePanel } from './ui/SmartMovePanel'
import {
  initialSmartMoveTargetState,
  lockSmartMoveTarget as lockTarget,
  resolveSmartMoveEnterAction,
  previewSmartMoveTarget as previewTarget,
} from './tools/smartMoveTarget'
import {
  initialSmartMoveAsyncState,
  SmartMoveWorkerController,
  type SmartMoveSchedulingDiagnostics,
} from './tools/smartMoveWorkerController'
import './styles.css'
import { calculatePathMovementCost, isPathCostPolicy, movementPolicyLabel } from './engine/movementCost'

interface SmartMoveSessionState {
  modelIds: string[]
  unitId: string
}

export default function App() {
  const footprintDemoEnabled = new URLSearchParams(window.location.search).has('footprints')
  const orientationGapEnabled = new URLSearchParams(window.location.search).has('orientationGap')
  const startupGameState = orientationGapEnabled ? orientationGapGameState
    : footprintDemoEnabled ? footprintDemoGameState : initialGameState
  const [{ gameState, revision: gameStateRevision }, dispatch] = useReducer(
    versionedGameReducer,
    { gameState: startupGameState, revision: 0 },
  )
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [spatialEnabled, setSpatialEnabled] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [measurementStartTarget, setMeasurementStartTarget] = useState<MeasurementTarget | null>(null)
  const [measurementPair, setMeasurementPair] = useState<MeasurementPair | null>(null)
  const [resetCameraSignal, setResetCameraSignal] = useState(0)
  const [spatialMode, setSpatialMode] = useState<SpatialMode>('range')
  const [rangeInches, setRangeInches] = useState(3)
  const [requiredSeparation, setRequiredSeparation] = useState(3)
  const [targetBaseDiameterMm, setTargetBaseDiameterMm] = useState(32)
  const [exclusionTargetModelId, setExclusionTargetModelId] = useState<string | null>(null)
  const [coherencyAnalysisMode, setCoherencyAnalysisMode] = useState<CoherencyAnalysisMode>('unit-policy')
  const [analysisCoherencyPolicy, setAnalysisCoherencyPolicy] = useState<CoherencyPolicy>({ distance: 1, requiredNeighbors: 1, requireConnected: false })
  const [blockedMovementSessionId, setBlockedMovementSessionId] = useState<string | null>(null)
  const [movementPolicy, setMovementPolicy] = useState<MovementPolicyConfig>({ type: 'movement-envelope' })
  const [smartMoveSession, setSmartMoveSession] = useState<SmartMoveSessionState | null>(null)
  const [smartMoveTargeting, setSmartMoveTargeting] = useState(initialSmartMoveTargetState)
  const [smartMoveAsync, setSmartMoveAsync] = useState(initialSmartMoveAsyncState)
  const [smartMoveDiagnostics, setSmartMoveDiagnostics] = useState<SmartMoveSchedulingDiagnostics | null>(null)
  const [smartMoveMessage, setSmartMoveMessage] = useState<string | null>(null)
  const smartMoveControllerRef = useRef<SmartMoveWorkerController | null>(null)

  useEffect(() => {
    const controller = new SmartMoveWorkerController({
      createWorker: () => new Worker(
        new URL('./workers/smartMove.worker.ts', import.meta.url),
        { type: 'module' },
      ),
      onStateChange: (state) => {
        setSmartMoveAsync(state)
        if (import.meta.env.DEV) setSmartMoveDiagnostics(controller.getDiagnostics())
      },
    })
    smartMoveControllerRef.current = controller
    const diagnosticsWindow = window as Window & {
      __fieldcraftSmartMoveDiagnostics?: () => ReturnType<SmartMoveWorkerController['getDiagnostics']>
    }
    if (import.meta.env.DEV) {
      diagnosticsWindow.__fieldcraftSmartMoveDiagnostics = () => controller.getDiagnostics()
    }
    return () => {
      smartMoveControllerRef.current = null
      if (diagnosticsWindow.__fieldcraftSmartMoveDiagnostics) {
        delete diagnosticsWindow.__fieldcraftSmartMoveDiagnostics
      }
      controller.dispose()
    }
  }, [])

  const selectedModel = useMemo(
    () => gameState.models.find((model) => selectedIds.has(model.id)),
    [gameState.models, selectedIds],
  )

  const selectedWholeUnit = useMemo(() => gameState.units.find((unit) =>
    unit.modelIds.length === selectedIds.size && unit.modelIds.every((id) => selectedIds.has(id))), [gameState.units, selectedIds])
  const selectedWholeUnitName = selectedWholeUnit
    ? getUnitDefinition(gameState, selectedWholeUnit)?.name
    : undefined
  const selectedUnit = selectedModel ? getUnitForModel(gameState, selectedModel.id) : undefined
  const selectedUnitDefinition = selectedUnit ? getUnitDefinition(gameState, selectedUnit) : undefined
  const selectedUnitPolicy = selectedUnit ? getUnitCoherencyPolicy(gameState, selectedUnit) : undefined
  const selectedUnitCoherency = useMemo(
    () => selectedUnit && selectedUnitPolicy
      ? evaluateUnitCoherency(selectedUnit, gameState.models, selectedUnitPolicy)
      : null,
    [gameState.models, selectedUnit, selectedUnitPolicy],
  )

  const spatialSourceIds = useMemo(() => {
    if (selectedWholeUnit) return selectedWholeUnit.modelIds
    return selectedModel ? [selectedModel.id] : []
  }, [selectedModel, selectedWholeUnit])

  const exclusionTargetModel = useMemo(
    () => gameState.models.find((model) => model.id === exclusionTargetModelId),
    [exclusionTargetModelId, gameState.models],
  )
  const exclusionTargetFootprint = useMemo(
    () => exclusionTargetModel?.base ?? { shape: 'circle' as const, diameterMm: targetBaseDiameterMm },
    [exclusionTargetModel, targetBaseDiameterMm],
  )
  const exclusionTargetRotation = exclusionTargetModel?.rotation ?? 0
  const exclusionTargetOptions = useMemo(() => {
    const seen = new Set<string>()
    return gameState.models.flatMap((model) => {
      const geometryKey = JSON.stringify({
        footprint: model.base,
        rotation: model.base.shape === 'circle' ? 0 : model.rotation,
      })
      if (seen.has(geometryKey)) return []
      seen.add(geometryKey)
      return [{
        id: model.id,
        label: `${model.label ?? model.id} · ${describeFootprint(model.base, model.rotation)}`,
      }]
    })
  }, [gameState.models])

  const coherencyUnit = useMemo(
    () => selectedWholeUnit ?? resolveSpatialCoherencyUnit(gameState.units, selectedIds),
    [gameState.units, selectedIds, selectedWholeUnit],
  )

  const coherencyUnitPolicy = coherencyUnit
    ? getUnitCoherencyPolicy(gameState, coherencyUnit)
    : undefined
  const spatialCoherencyPolicy = resolveSpatialCoherencyPolicy(
    coherencyAnalysisMode,
    coherencyUnitPolicy,
    analysisCoherencyPolicy,
  )

  const coherency = useMemo(
    () => coherencyUnit
      ? evaluateUnitCoherency(coherencyUnit, gameState.models, spatialCoherencyPolicy)
      : null,
    [coherencyUnit, gameState.models, spatialCoherencyPolicy],
  )

  const spatialDisplaySourceIds = spatialMode === 'coherency'
    ? coherencyUnit?.modelIds ?? []
    : spatialSourceIds
  const spatialDisplaySources = gameState.models.filter((model) => spatialDisplaySourceIds.includes(model.id))

  const spatialOverlay = useMemo<SpatialOverlayConfig | null>(() => spatialEnabled ? {
    mode: spatialMode,
    sourceModelIds: spatialMode === 'coherency' ? coherencyUnit?.modelIds ?? [] : spatialSourceIds,
    range: rangeInches,
    requiredSeparation,
    targetFootprint: exclusionTargetFootprint,
    targetRotation: exclusionTargetRotation,
    coherencyPolicy: spatialCoherencyPolicy,
    coherency,
  } : null, [coherency, coherencyUnit, exclusionTargetFootprint, exclusionTargetRotation, rangeInches, requiredSeparation, spatialCoherencyPolicy, spatialEnabled, spatialMode, spatialSourceIds])

  const movementSummary = useMemo<MovementSummary | null>(() => {
    const session = gameState.movementSession
    if (!session) return null
    const participants = gameState.models.filter((model) => session.modelIds.includes(model.id))
    const allowances = participants.map((model) => getMovementAllowance(gameState, model))
    const used = participants.map((model) => session.models[model.id]?.movementUsed ?? 0)
    const translationDistance = participants.map((model) => session.models[model.id]?.translationDistance ?? 0)
    const angularRotation = participants.map((model) => session.models[model.id]?.angularRotation ?? 0)
    const rotationCost = participants.map((model) => {
      const movement = session.models[model.id]
      return movement && isPathCostPolicy(session.movementPolicy) ? calculatePathMovementCost(session.movementPolicy, {
        translationDistance: movement.translationDistance,
        angularDistance: movement.angularRotation,
      }).rotationCost : 0
    })
    const remaining = participants.map((_, index) => Math.max(0, allowances[index] - used[index]))
    const distinctAllowances = [...new Set(allowances)]
    return {
      participantCount: participants.length,
      allowanceLabel: distinctAllowances.length === 1
        ? `${distinctAllowances[0].toFixed(2)}\u2033`
        : `${Math.min(...allowances).toFixed(2)}–${Math.max(...allowances).toFixed(2)}\u2033`,
      maximumUsed: Math.max(0, ...used),
      minimumRemaining: Math.min(...remaining),
      maximumTranslationDistance: Math.max(0, ...translationDistance),
      maximumRotationCost: Math.max(0, ...rotationCost),
      maximumRotationDegrees: Math.max(0, ...angularRotation) * 180 / Math.PI,
      policyLabel: movementPolicyLabel(session.movementPolicy),
    }
  }, [gameState])

  const selectedModelMovement = useMemo(() => {
    if (!selectedModel) return null
    const allowance = getMovementAllowance(gameState, selectedModel)
    const liveUsed = gameState.movementSession?.models[selectedModel.id]?.movementUsed ?? 0
    return { used: liveUsed, remaining: Math.max(0, allowance - liveUsed) }
  }, [gameState, selectedModel])

  const measurement = useMemo(() => {
    if (!measurementPair) return null
    return measureBetweenTargets(gameState, measurementPair.targetA, measurementPair.targetB)
  }, [gameState, measurementPair])

  const smartMoveUnit = useMemo(
    () => smartMoveSession
      ? gameState.units.find((unit) => unit.id === smartMoveSession.unitId)
      : undefined,
    [gameState.units, smartMoveSession],
  )
  const smartMoveDefinition = smartMoveUnit ? getUnitDefinition(gameState, smartMoveUnit) : undefined
  const smartMovePolicy = smartMoveUnit ? getUnitCoherencyPolicy(gameState, smartMoveUnit) : undefined

  const smartMoveRequestFactory = useMemo(() => (
    smartMoveSession && smartMovePolicy
      ? createSmartMoveRequestFactory(gameState, smartMoveSession.modelIds, smartMovePolicy, movementPolicy)
      : null
  ), [gameState, movementPolicy, smartMovePolicy, smartMoveSession])

  useEffect(() => {
    if (!smartMoveRequestFactory || !smartMoveSession) return
    smartMoveControllerRef.current?.updateSnapshot(gameStateRevision, smartMoveRequestFactory)
  }, [gameStateRevision, smartMoveRequestFactory, smartMoveSession])

  const smartMoveResult = smartMoveAsync.result

  const previewSmartMoveTarget = useCallback((target: { x: number; y: number }) => {
    if (!smartMoveSession) return
    setSmartMoveTargeting((state) => previewTarget(state, target))
    smartMoveControllerRef.current?.previewTarget(target)
  }, [smartMoveSession])

  const lockSmartMoveTarget = useCallback((target: { x: number; y: number }) => {
    if (!smartMoveSession) return
    setSmartMoveTargeting(lockTarget(target))
    smartMoveControllerRef.current?.lockTarget(target)
  }, [smartMoveSession])

  const cancelSmartMove = useCallback(() => {
    smartMoveControllerRef.current?.cancelSession()
    setSmartMoveSession(null)
    setSmartMoveTargeting(initialSmartMoveTargetState())
    setSmartMoveMessage(null)
  }, [])

  const handleSelectionChange = useCallback((nextSelectedIds: Set<string>) => {
    setSelectedIds(nextSelectedIds)
    if (activeTool !== 'smart-move') return
    smartMoveControllerRef.current?.cancelSession()
    setSmartMoveSession(null)
    setSmartMoveTargeting(initialSmartMoveTargetState())
    const models = gameState.models
      .filter((model) => nextSelectedIds.has(model.id))
      .sort((a, b) => a.id.localeCompare(b.id))
    const unitIds = [...new Set(models.map((model) => model.unitId))]
    if (models.length === 0) {
      setSmartMoveMessage('Select one or more models first.')
      return
    }
    if (unitIds.length !== 1) {
      setSmartMoveMessage('Smart Move requires models from a single unit.')
      return
    }
    const unit = gameState.units.find((candidate) => candidate.id === unitIds[0])
    const policy = unit ? getUnitCoherencyPolicy(gameState, unit) : undefined
    if (!unit || !policy) {
      setSmartMoveMessage('This unit has no configured coherency policy.')
      return
    }
    const session = { modelIds: models.map((model) => model.id), unitId: unit.id }
    setSmartMoveSession(session)
    setSmartMoveMessage(null)
    smartMoveControllerRef.current?.beginSession(
      gameStateRevision,
      createSmartMoveRequestFactory(gameState, session.modelIds, policy, movementPolicy),
    )
  }, [activeTool, gameState, gameStateRevision, movementPolicy])

  const applySmartMove = useCallback(() => {
    const result = smartMoveControllerRef.current?.getApplicableResult()
    if (!result?.valid || !smartMoveSession || !smartMovePolicy || !smartMoveUnit) return
    const startsCurrent = result.assignments.every((assignment) => {
      const model = gameState.models.find((candidate) => candidate.id === assignment.modelId)
      return model
        && Math.abs(model.position.x - assignment.start.x) <= GEOMETRY_EPSILON
        && Math.abs(model.position.y - assignment.start.y) <= GEOMETRY_EPSILON
        && (!assignment.trajectory
          || Math.abs(model.rotation - assignment.trajectory.startPose.rotation) <= GEOMETRY_EPSILON)
    })
    const authoritativeValidation = validateCandidateFormation({
      allModels: gameState.models,
      battlefield: gameState.battlefield,
      positions: result.positions,
      rotations: Object.fromEntries(result.assignments.map((assignment) => {
        const model = gameState.models.find((candidate) => candidate.id === assignment.modelId)
        return [assignment.modelId, assignment.finalRotation ?? model?.rotation ?? 0]
      })),
      reachability: {
        movementCosts: Object.fromEntries(result.assignments.map((assignment) => [
          assignment.modelId,
          assignment.movementCost,
        ])),
        movementAllowances: Object.fromEntries(smartMoveSession.modelIds.map((modelId) => {
          const model = gameState.models.find((candidate) => candidate.id === modelId)
          return [modelId, model ? getMovementAllowance(gameState, model) : 0]
        })),
      },
      coherency: { unit: smartMoveUnit, policy: smartMovePolicy },
    })
    if (!startsCurrent || !authoritativeValidation.valid) {
      setSmartMoveMessage('Smart Move is no longer current. Move or relock the target to recalculate.')
      return
    }
    dispatch({
      type: 'movement/validatedCandidateApplied',
      startingPositions: Object.fromEntries(result.assignments.map((assignment) => [
        assignment.modelId,
        assignment.start,
      ])),
      finalPositions: Object.fromEntries(result.assignments.map((assignment) => [
        assignment.modelId,
        assignment.destination,
      ])),
      startingRotations: Object.fromEntries(result.assignments.map((assignment) => {
        const model = gameState.models.find((candidate) => candidate.id === assignment.modelId)
        return [assignment.modelId, model?.rotation ?? 0]
      })),
      finalRotations: Object.fromEntries(result.assignments.map((assignment) => {
        const model = gameState.models.find((candidate) => candidate.id === assignment.modelId)
        return [assignment.modelId, assignment.finalRotation ?? model?.rotation ?? 0]
      })),
      trajectories: Object.fromEntries(result.assignments.flatMap((assignment) =>
        assignment.trajectory ? [[assignment.modelId, assignment.trajectory]] : [])),
      movementUsed: Object.fromEntries(result.assignments.map((assignment) => [
        assignment.modelId,
        assignment.movementCost,
      ])),
      paths: Object.fromEntries(result.assignments.map((assignment) => [
        assignment.modelId,
        assignment.path,
      ])),
    })
    cancelSmartMove()
    setActiveTool('select')
  }, [cancelSmartMove, gameState, smartMovePolicy, smartMoveSession, smartMoveUnit])

  const changeTool = useCallback((tool: ActiveTool) => {
    if (tool === 'smart-move') {
      if (gameState.movementSession) {
        setBlockedMovementSessionId(gameState.movementSession.id)
        return
      }
      const models = gameState.models
        .filter((model) => selectedIds.has(model.id))
        .sort((a, b) => a.id.localeCompare(b.id))
      const unitIds = [...new Set(models.map((model) => model.unitId))]
      setActiveTool('smart-move')
      smartMoveControllerRef.current?.cancelSession()
      setSmartMoveTargeting(initialSmartMoveTargetState())
      if (models.length === 0) {
        setSmartMoveSession(null)
        setSmartMoveMessage('Select one or more models first.')
        return
      }
      if (unitIds.length !== 1) {
        setSmartMoveSession(null)
        setSmartMoveMessage('Smart Move requires models from a single unit.')
        return
      }
      const unit = gameState.units.find((candidate) => candidate.id === unitIds[0])
      const policy = unit ? getUnitCoherencyPolicy(gameState, unit) : undefined
      if (!unit || !policy) {
        setSmartMoveSession(null)
        setSmartMoveMessage('This unit has no configured coherency policy.')
        return
      }
      setSmartMoveMessage(null)
      const session = { modelIds: models.map((model) => model.id), unitId: unitIds[0] }
      setSmartMoveSession(session)
      smartMoveControllerRef.current?.beginSession(
        gameStateRevision,
        createSmartMoveRequestFactory(gameState, session.modelIds, policy, movementPolicy),
      )
      return
    }
    cancelSmartMove()
    setActiveTool(tool)
    if (tool !== 'measure') setMeasurementStartTarget(null)
  }, [cancelSmartMove, gameState, gameStateRevision, movementPolicy, selectedIds])

  const toggleSpatialOverlay = useCallback(() => {
    if (!spatialEnabled) {
      // Opening analysis returns the pointer to ordinary tabletop manipulation.
      cancelSmartMove()
      setActiveTool('select')
      setMeasurementStartTarget(null)
    }
    setSpatialEnabled((enabled) => !enabled)
  }, [cancelSmartMove, spatialEnabled])

  const handleMeasureTarget = useCallback((target: MeasurementTarget) => {
    if (!measurementStartTarget || measurementPair) {
      setMeasurementStartTarget(target)
      setMeasurementPair(null)
      return
    }
    setMeasurementPair({ targetA: measurementStartTarget, targetB: target })
    setMeasurementStartTarget(null)
  }, [measurementPair, measurementStartTarget])

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
      if (event.key === 'Enter' && activeTool === 'smart-move' && !event.isComposing) {
        event.preventDefault()
        const enterAction = resolveSmartMoveEnterAction(
          smartMoveTargeting,
          smartMoveControllerRef.current?.getRawTarget() ?? null,
          smartMoveAsync.canApply,
        )
        if (enterAction.type === 'lock') {
          setSmartMoveTargeting(lockTarget(enterAction.target))
          smartMoveControllerRef.current?.lockTarget(enterAction.target)
        } else if (enterAction.type === 'apply') applySmartMove()
        return
      }
      if (event.key.toLowerCase() === 'v') changeTool('select')
      if (event.key.toLowerCase() === 'm') changeTool('measure')
      if (event.key.toLowerCase() === 's') toggleSpatialOverlay()
      if (event.key.toLowerCase() === 'g') changeTool('smart-move')
      if (event.key.toLowerCase() === 'f') setResetCameraSignal((value) => value + 1)
      if (event.key === 'Escape') {
        if (gameState.movementSession) {
          dispatch({ type: 'movement/cancelled' })
          return
        }
        if (activeTool === 'smart-move') {
          cancelSmartMove()
          setActiveTool('select')
          return
        }
        if (measurementStartTarget || measurementPair) {
          setMeasurementStartTarget(null)
          setMeasurementPair(null)
          return
        }
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTool, applySmartMove, cancelSmartMove, changeTool, gameState, measurementPair, measurementStartTarget, smartMoveAsync.canApply, smartMoveTargeting, toggleSpatialOverlay])

  const handleEndTurn = useCallback(() => {
    if (gameState.movementSession) {
      setBlockedMovementSessionId(gameState.movementSession.id)
      return
    }
    if (activeTool === 'smart-move') {
      cancelSmartMove()
      setActiveTool('select')
    }
    setBlockedMovementSessionId(null)
    dispatch({ type: 'game/turnEnded' })
  }, [activeTool, cancelSmartMove, gameState.movementSession])

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
          <strong>{gameState.battlefield.width} × {gameState.battlefield.height}</strong>
        </div>
      </header>
      <Toolbar
        activeTool={activeTool}
        spatialEnabled={spatialEnabled}
        onToolChange={changeTool}
        onSpatialToggle={toggleSpatialOverlay}
        onResetCamera={() => setResetCameraSignal((value) => value + 1)}
      />
      <section className="workspace">
        <TabletopCanvas
          gameState={gameState}
          activeTool={activeTool}
          selectedIds={selectedIds}
          measurement={measurement}
          measurementTargetA={measurementPair?.targetA ?? measurementStartTarget}
          measurementTargetB={measurementPair?.targetB ?? null}
          spatialOverlay={spatialOverlay}
          smartMoveResult={smartMoveResult}
          smartMoveRawTarget={smartMoveTargeting.target}
          smartMoveTargetLocked={smartMoveTargeting.mode === 'locked'}
          resetCameraSignal={resetCameraSignal}
          movementPolicy={movementPolicy}
          onSelectionChange={handleSelectionChange}
          onMeasureTarget={handleMeasureTarget}
          onSmartMoveTargetPreview={previewSmartMoveTarget}
          onSmartMoveTargetLock={lockSmartMoveTarget}
          dispatch={dispatch}
        />
        {(footprintDemoEnabled || orientationGapEnabled) && (
          <MovementCostPolicyPanel
            policy={movementPolicy}
            disabled={Boolean(gameState.movementSession)}
            onChange={setMovementPolicy}
          />
        )}
        <DebugPanel
          model={selectedModel}
          selectedCount={selectedIds.size}
          wholeUnitName={selectedWholeUnitName}
          ownerDisplayName={selectedModel ? getPlayerForModel(gameState, selectedModel)?.displayName : undefined}
          unitName={selectedUnitDefinition?.name}
          unitModelCount={selectedUnit?.modelIds.length}
          unitBaseLabel={selectedUnit ? getUnitBaseLabel(gameState, selectedUnit) : undefined}
          movementAllowance={selectedUnitDefinition?.movementAllowance}
          movementUsed={selectedModelMovement?.used}
          movementRemaining={selectedModelMovement?.remaining}
          coherencyPolicy={selectedUnitPolicy}
          coherency={selectedUnitCoherency}
          coherencyValid={selectedUnitPolicy && selectedUnitCoherency
            ? isCoherencyResultValid(selectedUnitCoherency, selectedUnitPolicy)
            : undefined}
        />
        {spatialEnabled && (
          <SpatialPanel
            mode={spatialMode}
            range={rangeInches}
            requiredSeparation={requiredSeparation}
            targetBaseDiameterMm={targetBaseDiameterMm}
            targetModelId={exclusionTargetModel?.id ?? null}
            targetModelOptions={exclusionTargetOptions}
            sourceGeometryLabel={describeSpatialSources(spatialDisplaySources)}
            targetGeometryLabel={describeFootprint(exclusionTargetFootprint, exclusionTargetRotation)}
            coherencyAnalysisMode={coherencyAnalysisMode}
            coherencyPolicy={spatialCoherencyPolicy}
            customCoherencyPolicy={analysisCoherencyPolicy}
            coherency={coherency}
            sourceCount={spatialMode === 'coherency' ? coherencyUnit?.modelIds.length ?? 0 : spatialSourceIds.length}
            coherencyUnitAvailable={Boolean(coherencyUnit)}
            unitPolicyAvailable={Boolean(coherencyUnitPolicy)}
            onModeChange={setSpatialMode}
            onRangeChange={setRangeInches}
            onRequiredSeparationChange={setRequiredSeparation}
            onTargetBaseDiameterChange={(diameterMm) => {
              setTargetBaseDiameterMm(diameterMm)
              setExclusionTargetModelId(null)
            }}
            onTargetModelChange={setExclusionTargetModelId}
            onCoherencyAnalysisModeChange={setCoherencyAnalysisMode}
            onCoherencyPolicyChange={setAnalysisCoherencyPolicy}
          />
        )}
        {movementSummary && (
          <MovementPanel
            summary={movementSummary}
            onConfirm={() => dispatch({ type: 'movement/confirmed' })}
            onCancel={() => dispatch({ type: 'movement/cancelled' })}
          />
        )}
        {activeTool === 'smart-move' && (
          <SmartMovePanel
            selectedCount={smartMoveSession?.modelIds.length ?? 0}
            unitSize={smartMoveUnit?.modelIds.length ?? 0}
            unitName={smartMoveDefinition?.name}
            coherencyPolicy={smartMovePolicy}
            targetMode={smartMoveTargeting.mode}
            result={smartMoveResult}
            asyncStatus={smartMoveAsync.status}
            thinkingVisible={smartMoveAsync.thinkingVisible}
            canApply={smartMoveAsync.canApply}
            errorMessage={smartMoveAsync.errorMessage ?? undefined}
            message={smartMoveMessage ?? undefined}
            onApply={applySmartMove}
            onCancel={() => {
              cancelSmartMove()
              setActiveTool('select')
            }}
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
      {import.meta.env.DEV && (
        <output
          hidden
          data-smart-move-diagnostics={JSON.stringify(smartMoveDiagnostics)}
        />
      )}
    </main>
  )
}

function createSmartMoveRequestFactory(
  gameState: GameState,
  modelIds: string[],
  coherencyPolicy: CoherencyPolicy,
  movementPolicy: MovementPolicyConfig,
): (target: SmartMoveRequest['target']) => SmartMoveRequest {
  const movementRemaining = Object.fromEntries(modelIds.map((modelId) => {
    const model = gameState.models.find((candidate) => candidate.id === modelId)
    return [modelId, model ? getMovementAllowance(gameState, model) : 0]
  }))
  return (target) => ({
    allModels: gameState.models,
    units: gameState.units,
    battlefield: gameState.battlefield,
    selectedModelIds: modelIds,
    target: { ...target },
    movementRemaining,
    coherencyPolicy,
    movementPolicy,
  })
}

function versionedGameReducer(
  current: { gameState: GameState; revision: number },
  action: GameStateAction,
) {
  const nextGameState = gameReducer(current.gameState, action)
  return nextGameState === current.gameState
    ? current
    : { gameState: nextGameState, revision: current.revision + 1 }
}
