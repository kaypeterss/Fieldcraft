import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { footprintDemoGameState, initialGameState, orientationGapGameState } from './game/initialState'
import { battlefieldFeatureDemoGameState } from './game/battlefieldFeatureDemo'
import type { DicePoolResult, GameState, MovementPolicyConfig } from './domain/types'
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
import { effectiveTerrainPermissions, movementTerrainInteractions, terrainRelationships } from './engine/terrainPolicy'
import { featureBaseArea, modelAreaRelationship, objectiveArea, playerAreaSummaries, unitAreaSummary } from './engine/areaRelationships'
import { displayedSmartMovePreview, projectModelsForSmartMove } from './tools/projectedSpatialState'
import { applyModelPick, type ModelPickerTarget } from './tools/modelPicker'
import {
  interpretVisibility,
  visibilityBetweenModels,
  type VisibilityMode,
  type VisibilityPolicy,
} from './engine/visibility'
import { developmentGameSystem } from './gameSystem/developmentGameSystem'
import { movementPermissionForUnit } from './gameSystem/policies'
import { evaluateObjectiveControl } from './engine/objectiveControl'
import { DicePanel } from './ui/DicePanel'

interface SmartMoveSessionState {
  modelIds: string[]
  unitId: string
}

export default function App() {
  const footprintDemoEnabled = new URLSearchParams(window.location.search).has('footprints')
  const orientationGapEnabled = new URLSearchParams(window.location.search).has('orientationGap')
  const battlefieldFeatureDemoEnabled = new URLSearchParams(window.location.search).has('battlefieldFeatures')
  const startupGameState = battlefieldFeatureDemoEnabled ? battlefieldFeatureDemoGameState
    : orientationGapEnabled ? orientationGapGameState
    : footprintDemoEnabled ? footprintDemoGameState : initialGameState
  const [{ gameState, revision: gameStateRevision }, dispatch] = useReducer(
    versionedGameReducer,
    { gameState: startupGameState, revision: 0 },
  )
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [spatialEnabled, setSpatialEnabled] = useState(false)
  const [diceOpen, setDiceOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(
    battlefieldFeatureDemoEnabled ? 'demo-combined' : null,
  )
  const [measurementStartTarget, setMeasurementStartTarget] = useState<MeasurementTarget | null>(null)
  const [measurementPair, setMeasurementPair] = useState<MeasurementPair | null>(null)
  const [resetCameraSignal, setResetCameraSignal] = useState(0)
  const [spatialMode, setSpatialMode] = useState<SpatialMode>('range')
  const [rangeInches, setRangeInches] = useState(3)
  const [requiredSeparation, setRequiredSeparation] = useState(3)
  const [visibilityViewerId, setVisibilityViewerId] = useState<string | null>(null)
  const [visibilityTargetId, setVisibilityTargetId] = useState<string | null>(null)
  const [visibilityPickTarget, setVisibilityPickTarget] = useState<ModelPickerTarget | null>(null)
  const [visibilityPickHoverModelId, setVisibilityPickHoverModelId] = useState<string | null>(null)
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>(developmentGameSystem.visibility.mode)
  const [visibilityPolicy, setVisibilityPolicy] = useState<VisibilityPolicy>(developmentGameSystem.visibility.terrainPolicy)
  const [coherencyAnalysisMode, setCoherencyAnalysisMode] = useState<CoherencyAnalysisMode>('unit-policy')
  const [analysisCoherencyPolicy, setAnalysisCoherencyPolicy] = useState<CoherencyPolicy>({ distance: 1, requiredNeighbors: 1, requireConnected: false })
  const [blockedMovementSessionId, setBlockedMovementSessionId] = useState<string | null>(null)
  const [movementPolicy, setMovementPolicy] = useState<MovementPolicyConfig>(developmentGameSystem.movement.cost)
  const [smartMoveSession, setSmartMoveSession] = useState<SmartMoveSessionState | null>(null)
  const [smartMoveTargeting, setSmartMoveTargeting] = useState(initialSmartMoveTargetState)
  const [smartMoveAsync, setSmartMoveAsync] = useState(initialSmartMoveAsyncState)
  const [smartMoveDiagnostics, setSmartMoveDiagnostics] = useState<SmartMoveSchedulingDiagnostics | null>(null)
  const [smartMoveMessage, setSmartMoveMessage] = useState<string | null>(null)
  const restartSmartMoveAfterApplyRef = useRef(false)
  const smartMoveControllerRef = useRef<SmartMoveWorkerController | null>(null)
  const smartMoveResult = smartMoveAsync.result
  const spatialPreviewResult = displayedSmartMovePreview(smartMoveResult)
  const spatialModels = useMemo(
    () => projectModelsForSmartMove(gameState.models, spatialPreviewResult),
    [gameState.models, spatialPreviewResult],
  )
  const visibilityModelOptions = useMemo(() => spatialModels.map((model) => ({
    id: model.id,
    label: `${model.label ?? model.id} · ${describeFootprint(model.base, model.rotation)}`,
  })), [spatialModels])
  const visibilityGeometry = useMemo(() => {
    const viewer = spatialModels.find((model) => model.id === visibilityViewerId)
    const target = spatialModels.find((model) => model.id === visibilityTargetId)
    if (!viewer || !target || viewer.id === target.id) return null
    return visibilityBetweenModels(viewer, target, gameState.battlefieldFeatures)
  }, [gameState.battlefieldFeatures, spatialModels, visibilityTargetId, visibilityViewerId])
  const visibilityAnalysis = useMemo(() => visibilityGeometry
    ? interpretVisibility(visibilityGeometry, visibilityPolicy, visibilityMode)
    : null, [visibilityGeometry, visibilityMode, visibilityPolicy])

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

  const selectedFeature = gameState.battlefieldFeatures?.find((feature) => feature.id === selectedFeatureId)
  const selectedTerrainRelationships = selectedModel
    ? terrainRelationships(selectedModel, gameState.battlefieldFeatures, gameState.terrainPolicy)
    : []
  const selectedTerrainMovement = selectedModel && gameState.movementSession?.models[selectedModel.id]
    ? movementTerrainInteractions(
      selectedModel,
      gameState.movementSession.models[selectedModel.id].trajectory,
      gameState.battlefieldFeatures,
      gameState.terrainPolicy,
    ) : undefined
  const selectedEffectiveTerrainPermissions = selectedModel
    ? effectiveTerrainPermissions(
      selectedModel.id,
      gameState.battlefieldFeatures,
      gameState.terrainPolicy,
      new Set([
        ...(selectedFeatureId ? [selectedFeatureId] : []),
        ...selectedTerrainRelationships.map((entry) => entry.featureId),
        ...(selectedTerrainMovement ?? []).map((entry) => entry.featureId),
      ]),
    ) : []

  const selectedWholeUnit = useMemo(() => gameState.units.find((unit) =>
    unit.modelIds.length === selectedIds.size && unit.modelIds.every((id) => selectedIds.has(id))), [gameState.units, selectedIds])
  const selectedWholeUnitName = selectedWholeUnit
    ? getUnitDefinition(gameState, selectedWholeUnit)?.name
    : undefined
  const selectedUnit = selectedModel ? getUnitForModel(gameState, selectedModel.id) : undefined
  const selectedUnitDefinition = selectedUnit ? getUnitDefinition(gameState, selectedUnit) : undefined
  const selectedObjective = gameState.battlefieldFeatures?.find((feature) => feature.id === selectedObjectiveId && feature.capabilities.objective)
  const selectedObjectiveArea = selectedObjective ? objectiveArea(selectedObjective) : null
  const spatialSelectedModel = selectedModel ? spatialModels.find((model) => model.id === selectedModel.id) : undefined
  const selectedObjectiveAnalysis = selectedObjective && selectedObjectiveArea ? {
    featureName: selectedObjective.name,
    areaType: selectedObjective.capabilities.objective?.area.type ?? 'feature-base',
    unitName: selectedUnitDefinition?.name,
    modelRelationship: spatialSelectedModel ? modelAreaRelationship(spatialSelectedModel, selectedObjectiveArea) : null,
    unitSummary: selectedUnit ? unitAreaSummary(selectedUnit, spatialModels, selectedObjectiveArea) : null,
    playerSummaries: playerAreaSummaries(
      gameState.players,
      gameState.units,
      spatialModels,
      selectedObjectiveArea,
      new Map(gameState.unitDefinitions.map((definition) => [definition.id, definition.name])),
    ),
    control: evaluateObjectiveControl({
      area: selectedObjectiveArea,
      players: gameState.players,
      models: spatialModels,
      units: gameState.units,
      unitDefinitions: gameState.unitDefinitions,
      gameContext: gameState.gameContext,
      objective: developmentGameSystem.objectives,
    }),
    controlPreview: Boolean(spatialPreviewResult),
  } : null
  const selectedTerrainAreaAnalysis = selectedModel ? (gameState.battlefieldFeatures ?? [])
    .filter((feature) => feature.capabilities.terrain && (feature.id === selectedFeatureId
      || selectedTerrainRelationships.some((relation) => relation.featureId === feature.id)))
    .map((feature) => ({
      featureId: feature.id, featureName: feature.name,
      modelRelationship: modelAreaRelationship(selectedModel, featureBaseArea(feature)),
      unitSummary: selectedUnit ? unitAreaSummary(selectedUnit, gameState.models, featureBaseArea(feature)) : null,
    })) : []
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
      ? evaluateUnitCoherency(coherencyUnit, spatialModels, spatialCoherencyPolicy)
      : null,
    [coherencyUnit, spatialModels, spatialCoherencyPolicy],
  )

  const spatialDisplaySourceIds = spatialMode === 'coherency'
    ? coherencyUnit?.modelIds ?? []
    : spatialMode === 'objectives' || spatialMode === 'visibility' ? []
    : spatialSourceIds
  const spatialDisplaySources = spatialModels.filter((model) => spatialDisplaySourceIds.includes(model.id))

  const spatialOverlay = useMemo<SpatialOverlayConfig | null>(() => spatialEnabled ? {
    mode: spatialMode,
    sourceModelIds: spatialMode === 'coherency' ? coherencyUnit?.modelIds ?? []
      : spatialMode === 'objectives' || spatialMode === 'visibility' ? [] : spatialSourceIds,
    range: rangeInches,
    requiredSeparation,
    coherencyPolicy: spatialCoherencyPolicy,
    coherency,
    visibility: visibilityAnalysis,
    visibilityViewerId,
    visibilityTargetId,
    visibilityPickTarget,
    visibilityPickHoverModelId,
    previewActive: Boolean(spatialPreviewResult),
  } : null, [coherency, coherencyUnit, rangeInches, requiredSeparation, spatialCoherencyPolicy, spatialEnabled, spatialMode, spatialPreviewResult, spatialSourceIds, visibilityAnalysis, visibilityPickHoverModelId, visibilityPickTarget, visibilityTargetId, visibilityViewerId])

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
    restartSmartMoveAfterApplyRef.current = false
  }, [])

  const beginSmartMoveForSelection = useCallback((models: GameState['models'], state: GameState, revision: number) => {
    const sortedModels = models.slice().sort((a, b) => a.id.localeCompare(b.id))
    const unitIds = [...new Set(sortedModels.map((model) => model.unitId))]
    if (sortedModels.length === 0) {
      setSmartMoveSession(null)
      setSmartMoveMessage('Select one or more models first.')
      return
    }
    if (unitIds.length !== 1) {
      setSmartMoveSession(null)
      setSmartMoveMessage('Smart Move requires models from a single unit.')
      return
    }
    const unit = state.units.find((candidate) => candidate.id === unitIds[0])
    const policy = unit ? getUnitCoherencyPolicy(state, unit) : undefined
    const allowance = sortedModels[0] ? getMovementAllowance(state, sortedModels[0]) : 0
    const permission = unit ? movementPermissionForUnit({
      policy: developmentGameSystem.movement.permissions,
      actions: state.actionHistory,
      gameContext: state.gameContext,
      unitId: unit.id,
      modelIds: unit.modelIds,
      baseAllowance: allowance,
    }) : null
    if (!unit || !policy) {
      setSmartMoveSession(null)
      setSmartMoveMessage('This unit has no configured coherency policy.')
      return
    }
    if (!permission?.canStartAction) {
      setSmartMoveSession(null)
      setSmartMoveMessage('This unit has no movement actions remaining under the active GameSystem.')
      return
    }
    const session = { modelIds: sortedModels.map((model) => model.id), unitId: unit.id }
    setSmartMoveSession(session)
    setSmartMoveMessage(null)
    smartMoveControllerRef.current?.beginSession(
      revision,
      createSmartMoveRequestFactory(state, session.modelIds, policy, movementPolicy),
    )
  }, [movementPolicy])

  useEffect(() => {
    if (!restartSmartMoveAfterApplyRef.current || activeTool !== 'smart-move' || gameState.movementSession) return
    restartSmartMoveAfterApplyRef.current = false
    beginSmartMoveForSelection(
      gameState.models.filter((model) => selectedIds.has(model.id)),
      gameState,
      gameStateRevision,
    )
  }, [activeTool, beginSmartMoveForSelection, gameState, gameStateRevision, selectedIds])

  const handleSelectionChange = useCallback((nextSelectedIds: Set<string>) => {
    setSelectedIds(nextSelectedIds)
    setSelectedFeatureId(null)
    if (spatialMode === 'visibility' && nextSelectedIds.size === 1) {
      const selectedId = [...nextSelectedIds][0]
      if (!visibilityViewerId) setVisibilityViewerId(selectedId)
      else if (selectedId !== visibilityViewerId) setVisibilityTargetId(selectedId)
    }
    if (!selectedObjectiveId && nextSelectedIds.size > 0) {
      const selectedModels = gameState.models.filter((model) => nextSelectedIds.has(model.id))
      const relevantObjective = (gameState.battlefieldFeatures ?? []).find((feature) => {
        const area = feature.capabilities.objective ? objectiveArea(feature) : null
        return area && selectedModels.some((model) => modelAreaRelationship(model, area).intersects)
      })
      if (relevantObjective) setSelectedObjectiveId(relevantObjective.id)
    }
    if (activeTool !== 'smart-move') return
    smartMoveControllerRef.current?.cancelSession()
    setSmartMoveSession(null)
    setSmartMoveTargeting(initialSmartMoveTargetState())
    const models = gameState.models.filter((model) => nextSelectedIds.has(model.id))
    beginSmartMoveForSelection(models, gameState, gameStateRevision)
  }, [activeTool, beginSmartMoveForSelection, gameState, gameStateRevision, selectedObjectiveId, spatialMode, visibilityViewerId])

  const handleFeatureSelectionChange = useCallback((featureId: string) => {
    setSelectedFeatureId(featureId)
    if (gameState.battlefieldFeatures?.some((feature) => feature.id === featureId && feature.capabilities.objective)) {
      setSelectedObjectiveId(featureId)
    }
  }, [gameState.battlefieldFeatures])

  const handleVisibilityPickModel = useCallback((modelId: string) => {
    if (!visibilityPickTarget) return
    const next = applyModelPick(visibilityPickTarget, modelId, { viewerId: visibilityViewerId, targetId: visibilityTargetId })
    setVisibilityViewerId(next.viewerId)
    setVisibilityTargetId(next.targetId)
    setVisibilityPickTarget(null)
    setVisibilityPickHoverModelId(null)
  }, [visibilityPickTarget, visibilityTargetId, visibilityViewerId])

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
      terrainFeatures: gameState.battlefieldFeatures,
      terrainPolicy: gameState.terrainPolicy,
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
    restartSmartMoveAfterApplyRef.current = true
  }, [cancelSmartMove, gameState, smartMovePolicy, smartMoveSession, smartMoveUnit])

  const changeTool = useCallback((tool: ActiveTool) => {
    setVisibilityPickTarget(null)
    setVisibilityPickHoverModelId(null)
    if (tool === 'smart-move') {
      if (gameState.movementSession) {
        setBlockedMovementSessionId(gameState.movementSession.id)
        return
      }
      const models = gameState.models
        .filter((model) => selectedIds.has(model.id))
      const sortedModels = models.sort((a, b) => a.id.localeCompare(b.id))
      setActiveTool('smart-move')
      smartMoveControllerRef.current?.cancelSession()
      setSmartMoveTargeting(initialSmartMoveTargetState())
      beginSmartMoveForSelection(sortedModels, gameState, gameStateRevision)
      return
    }
    cancelSmartMove()
    setActiveTool(tool)
    if (tool !== 'measure') setMeasurementStartTarget(null)
  }, [beginSmartMoveForSelection, cancelSmartMove, gameState, gameStateRevision, selectedIds])

  const toggleSpatialOverlay = useCallback(() => {
    setVisibilityPickTarget(null)
    setVisibilityPickHoverModelId(null)
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
        if (visibilityPickTarget) {
          setVisibilityPickTarget(null)
          setVisibilityPickHoverModelId(null)
          return
        }
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
  }, [activeTool, applySmartMove, cancelSmartMove, changeTool, gameState, measurementPair, measurementStartTarget, smartMoveAsync.canApply, smartMoveTargeting, toggleSpatialOverlay, visibilityPickTarget])

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
          onRecordScore={(playerId, pointsDelta, reason) => dispatch({
            type: 'score/eventRecorded', playerId, pointsDelta, reason,
            source: { type: 'manual' },
          })}
          onUndoLastScore={() => dispatch({ type: 'score/lastEventUndone' })}
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
        diceOpen={diceOpen}
        onToolChange={changeTool}
        onSpatialToggle={toggleSpatialOverlay}
        onDiceToggle={() => setDiceOpen((open) => !open)}
        onResetCamera={() => setResetCameraSignal((value) => value + 1)}
      />
      <section className="workspace">
        <TabletopCanvas
          gameState={gameState}
          spatialModels={spatialModels}
          activeTool={activeTool}
          selectedIds={selectedIds}
          selectedFeatureId={selectedFeatureId}
          selectedObjectiveId={selectedObjectiveId}
          measurement={measurement}
          measurementTargetA={measurementPair?.targetA ?? measurementStartTarget}
          measurementTargetB={measurementPair?.targetB ?? null}
          spatialOverlay={spatialOverlay}
          smartMoveResult={spatialPreviewResult}
          smartMoveRawTarget={smartMoveTargeting.target}
          smartMoveTargetLocked={smartMoveTargeting.mode === 'locked'}
          visibilityPickTarget={visibilityPickTarget}
          resetCameraSignal={resetCameraSignal}
          movementPolicy={movementPolicy}
          onSelectionChange={handleSelectionChange}
          onFeatureSelectionChange={handleFeatureSelectionChange}
          onMeasureTarget={handleMeasureTarget}
          onSmartMoveTargetPreview={previewSmartMoveTarget}
          onSmartMoveTargetLock={lockSmartMoveTarget}
          onVisibilityPickModel={handleVisibilityPickModel}
          onVisibilityPickHover={setVisibilityPickHoverModelId}
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
          feature={selectedFeature}
          terrainRelationships={gameState.terrainPolicy ? selectedTerrainRelationships : undefined}
          terrainMovement={selectedTerrainMovement}
          effectiveTerrainPermissions={selectedEffectiveTerrainPermissions}
          terrainAreaAnalysis={selectedTerrainAreaAnalysis}
          objectiveAnalysis={spatialMode === 'objectives' ? selectedObjectiveAnalysis : null}
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
            sourceGeometryLabel={describeSpatialSources(spatialDisplaySources)}
            coherencyAnalysisMode={coherencyAnalysisMode}
            coherencyPolicy={spatialCoherencyPolicy}
            customCoherencyPolicy={analysisCoherencyPolicy}
            coherency={coherency}
            sourceCount={spatialMode === 'coherency' ? coherencyUnit?.modelIds.length ?? 0
              : spatialMode === 'objectives' ? 0
                : spatialMode === 'visibility' ? Number(Boolean(visibilityViewerId)) + Number(Boolean(visibilityTargetId))
                  : spatialSourceIds.length}
            coherencyUnitAvailable={Boolean(coherencyUnit)}
            unitPolicyAvailable={Boolean(coherencyUnitPolicy)}
            objectiveOptions={(gameState.battlefieldFeatures ?? []).filter((feature) => feature.capabilities.objective)
              .map((feature) => ({ id: feature.id, name: feature.name }))}
            selectedObjectiveId={selectedObjectiveId}
            objectiveAnalysis={spatialMode === 'objectives' ? selectedObjectiveAnalysis : null}
            modelOptions={visibilityModelOptions}
            visibilityViewerId={visibilityViewerId}
            visibilityTargetId={visibilityTargetId}
            visibilityPickTarget={visibilityPickTarget}
            visibilityMode={visibilityMode}
            visibilityPolicy={visibilityPolicy}
            visibilityAnalysis={spatialMode === 'visibility' ? visibilityAnalysis : null}
            previewActive={Boolean(spatialPreviewResult)}
            onObjectiveChange={setSelectedObjectiveId}
            onVisibilityViewerChange={(id) => { setVisibilityPickTarget(null); setVisibilityViewerId(id) }}
            onVisibilityTargetChange={(id) => { setVisibilityPickTarget(null); setVisibilityTargetId(id) }}
            onVisibilityPick={setVisibilityPickTarget}
            onVisibilityModeChange={setVisibilityMode}
            onVisibilityPolicyChange={setVisibilityPolicy}
            onModeChange={setSpatialMode}
            onRangeChange={setRangeInches}
            onRequiredSeparationChange={setRequiredSeparation}
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
        {diceOpen && (
          <DicePanel
            players={gameState.players}
            activePlayerId={gameState.gameContext.activePlayerId}
            history={gameState.diceHistory ?? []}
            onClose={() => setDiceOpen(false)}
            onRecord={(playerId: string, result: DicePoolResult) => {
              const rollId = `dice-${gameState.nextActionSequence}`
              dispatch({ type: 'dice/rollRecorded', playerId, result })
              return rollId
            }}
            onUpdate={(rollId, result) => dispatch({ type: 'dice/rollUpdated', rollId, result })}
            onRecordSequence={(playerId, resolution) => dispatch({
              type: 'dice/sequenceRecorded', playerId, resolution,
            })}
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
    terrainFeatures: gameState.battlefieldFeatures,
    terrainPolicy: gameState.terrainPolicy,
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
