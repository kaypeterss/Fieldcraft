import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { footprintDemoGameState, initialGameState, orientationGapGameState } from './game/initialState'
import { battlefieldFeatureDemoGameState } from './game/battlefieldFeatureDemo'
import { lifecycleDemoGameState } from './game/lifecycleDemo'
import type { DicePoolResult, GameState, MovementPolicyConfig, Pose } from './domain/types'
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
import { evaluateObjectiveControl } from './engine/objectiveControl'
import { DicePanel } from './ui/DicePanel'
import { activeBattlefieldModels, modelPresence } from './game/modelPresence'
import { authorizeMovement, loadRegisteredMatchRuntime } from './gameSystem/runtime'
import { reduceGameCommand } from './state/commandBoundary'
import { validateModelPlacements } from './engine/placement'
import { LifecyclePanel, type LifecyclePanelEntry } from './ui/LifecyclePanel'
import { derivePlacementCoherency, formationPlacements, nextUnplacedModelId } from './tools/lifecyclePlacement'
import { gameSystemRegistry } from './gameSystem/registeredGameSystems'
import { listSavedMatches, loadMatchFromStorage, loadSavedMatch as loadSavedMatchRecord, saveMatchAsToStorage, saveMatchToStorage, deleteSavedMatch } from './game/matchPersistence'
import { NewMatchDialog } from './ui/NewMatchDialog'
import { GameSystemStatusPanel } from './ui/GameSystemStatusPanel'
import { MatchControls } from './ui/MatchControls'
import { LoadMatchDialog } from './ui/LoadMatchDialog'
import { UnsavedChangesDialog } from './ui/UnsavedChangesDialog'

interface SmartMoveSessionState {
  modelIds: string[]
  unitId: string
}

interface LifecyclePlacementSession {
  mode: 'individual' | 'formation'
  modelIds: string[]
  stagedPoses: Record<string, Pose>
}

export default function App() {
  const [session, setSession] = useState(() => ({ gameState: startupGameState(), key: 0 }))
  const [newMatchOpen, setNewMatchOpen] = useState(false)
  const [loadMatchOpen, setLoadMatchOpen] = useState(false)
  const [matchNotice, setMatchNotice] = useState<{ message: string; error: boolean } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<'new' | 'load' | null>(null)
  const currentStateRef = useRef(session.gameState)

  const performLeave = useCallback((action: 'new' | 'load') => {
    if (action === 'new') setNewMatchOpen(true)
    else setLoadMatchOpen(true)
    setPendingLeave(null)
  }, [])
  const requestLeave = useCallback((action: 'new' | 'load') => {
    if (dirty) setPendingLeave(action)
    else performLeave(action)
  }, [dirty, performLeave])

  const createMatch = useCallback((gameSystemId: string, adapterVersion: string, matchName: string) => {
    try {
      const registration = gameSystemRegistry.resolve(gameSystemId, adapterVersion)
      const gameState = registration.createMatch({ matchName })
      loadRegisteredMatchRuntime(gameState, gameSystemRegistry)
      setSession((current) => ({ gameState, key: current.key + 1 }))
      setDirty(false)
      setNewMatchOpen(false)
      setMatchNotice({ message: `${registration.gameSystem.name} match created.`, error: false })
    } catch (error) {
      setMatchNotice({ message: errorMessage(error), error: true })
    }
  }, [])

  const loadSavedMatch = useCallback(() => {
    try {
      const loaded = loadMatchFromStorage(window.localStorage, gameSystemRegistry)
      setSession((current) => ({ gameState: loaded.state, key: current.key + 1 }))
      setDirty(false)
      setMatchNotice({ message: `${loaded.runtime.gameSystem.name} save loaded exactly.`, error: false })
    } catch (error) {
      setMatchNotice({ message: errorMessage(error), error: true })
    }
  }, [])

  const loadSavedMatchById = useCallback((matchId: string) => {
    try {
      const loaded = loadSavedMatchRecord(window.localStorage, matchId, gameSystemRegistry)
      setSession((current) => ({ gameState: loaded.state, key: current.key + 1 }))
      setDirty(false)
      setLoadMatchOpen(false)
      setMatchNotice({ message: `${loaded.runtime.gameSystem.name} save loaded exactly.`, error: false })
    } catch (error) { setMatchNotice({ message: errorMessage(error), error: true }) }
  }, [])

  return <>
    <MatchRuntimeBoundary
      key={session.key}
      fallback={(error) => <MatchRecoveryShell error={error} onNewMatch={() => setNewMatchOpen(true)} onLoad={loadSavedMatch} />}
    >
      <MatchWorkspace
        initialState={session.gameState}
        matchNotice={matchNotice}
        onNewMatch={() => requestLeave('new')}
        onSave={(state) => {
          try {
            saveMatchToStorage(window.localStorage, state)
            setDirty(false)
            setMatchNotice({ message: 'Match saved locally with its exact rules identity.', error: false })
          } catch (error) {
            setMatchNotice({ message: errorMessage(error), error: true })
          }
        }}
        onLoad={() => requestLeave('load')}
        onSaveAs={(state) => {
          const name = window.prompt('Save match as', state.matchIdentity?.matchName ?? 'Copy')
          if (name?.trim()) {
            const copy = saveMatchAsToStorage(window.localStorage, state, name)
            setSession((current) => ({ gameState: copy, key: current.key + 1 }))
            currentStateRef.current = copy
            setDirty(false)
            setMatchNotice({ message: `Saved a new match as “${name.trim()}”.`, error: false })
          }
        }}
        onStateChange={(state, revision) => { currentStateRef.current = state; if (revision > 0) setDirty(true) }}
      />
    </MatchRuntimeBoundary>
    {newMatchOpen && <NewMatchDialog registrations={gameSystemRegistry.list()}
      onCreate={createMatch} onCancel={() => setNewMatchOpen(false)} />}
    {loadMatchOpen && <LoadMatchDialog
      matches={listSavedMatches(window.localStorage, gameSystemRegistry)}
      onLoad={loadSavedMatchById}
      onDelete={(matchId) => { if (window.confirm('Delete this saved match?')) { deleteSavedMatch(window.localStorage, matchId); setLoadMatchOpen(false); setLoadMatchOpen(true) } }}
      onCancel={() => setLoadMatchOpen(false)} />}
    {pendingLeave && <UnsavedChangesDialog
      onCancel={() => setPendingLeave(null)}
      onDiscard={() => { setDirty(false); performLeave(pendingLeave) }}
      onSave={() => { saveMatchToStorage(window.localStorage, currentStateRef.current); setDirty(false); performLeave(pendingLeave) }} />}
  </>
}

interface MatchRuntimeBoundaryProps {
  children: ReactNode
  fallback: (error: Error) => ReactNode
}

interface MatchRuntimeBoundaryState {
  error: Error | null
}

class MatchRuntimeBoundary extends Component<MatchRuntimeBoundaryProps, MatchRuntimeBoundaryState> {
  state: MatchRuntimeBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): MatchRuntimeBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Runtime/load errors are surfaced by the recovery shell; React's normal error reporting remains intact.
    void info
    console.error('Match runtime failed to load', error)
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}

function MatchRecoveryShell({ error, onNewMatch, onLoad }: { error: Error; onNewMatch: () => void; onLoad: () => void }) {
  return <main className="app-shell recovery-shell">
    <section className="panel recovery-panel" role="alert">
      <p className="eyebrow">FIELDCRAFT</p>
      <h1>Match could not be loaded</h1>
      <p>{errorMessage(error)}</p>
      <p className="muted">The application is still running. Create a new match or load a different saved match.</p>
      <div className="button-row">
        <button type="button" onClick={onNewMatch}>New Match</button>
        <button type="button" onClick={onLoad}>Load Match</button>
      </div>
    </section>
  </main>
}

interface MatchWorkspaceProps {
  initialState: GameState
  matchNotice: { message: string; error: boolean } | null
  onNewMatch: () => void
  onSave: (state: GameState) => void
  onLoad: () => void
  onSaveAs: (state: GameState) => void
  onStateChange: (state: GameState, revision: number) => void
}

function MatchWorkspace({ initialState, matchNotice, onNewMatch, onSave, onLoad, onSaveAs, onStateChange }: MatchWorkspaceProps) {
  const footprintDemoEnabled = new URLSearchParams(window.location.search).has('footprints')
  const orientationGapEnabled = new URLSearchParams(window.location.search).has('orientationGap')
  const battlefieldFeatureDemoEnabled = new URLSearchParams(window.location.search).has('battlefieldFeatures')
  const [{ gameState, revision: gameStateRevision }, rawDispatch] = useReducer(
    versionedGameReducer,
    { gameState: initialState, revision: 0 },
  )
  useEffect(() => onStateChange(gameState, gameStateRevision), [gameState, gameStateRevision, onStateChange])
  const initialRegistration = useMemo(() => gameSystemRegistry.resolveIdentity(initialState.matchIdentity!).registration, [initialState])
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [spatialEnabled, setSpatialEnabled] = useState(false)
  const [diceOpen, setDiceOpen] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)
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
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>(initialRegistration.gameSystem.visibility.mode)
  const [visibilityPolicy, setVisibilityPolicy] = useState<VisibilityPolicy>(initialRegistration.gameSystem.visibility.terrainPolicy)
  const [coherencyAnalysisMode, setCoherencyAnalysisMode] = useState<CoherencyAnalysisMode>('unit-policy')
  const [analysisCoherencyPolicy, setAnalysisCoherencyPolicy] = useState<CoherencyPolicy>({ distance: 1, requiredNeighbors: 1, requireConnected: false })
  const [blockedMovementSessionId, setBlockedMovementSessionId] = useState<string | null>(null)
  const [movementPolicy, setMovementPolicy] = useState<MovementPolicyConfig>(initialRegistration.gameSystem.movement.cost)
  const dispatch = useCallback((action: GameStateAction) => rawDispatch({ action, movementPolicy }), [movementPolicy])
  const loadedRuntime = useMemo(
    () => loadRegisteredMatchRuntime(gameState, gameSystemRegistry, { movementPolicy }),
    [gameState, movementPolicy],
  )
  const gameSystemRegistration = loadedRuntime.registration!
  const developmentControlsEnabled = gameSystemRegistration.ui.developmentControls
  const gameplayImplemented = gameSystemRegistration.ui.gameplayImplemented
  const activeModels = useMemo(() => activeBattlefieldModels(gameState), [gameState])
  const battlefieldGameState = useMemo(() => ({ ...gameState, models: activeModels }), [activeModels, gameState])
  const lifecycleEntries = useMemo<LifecyclePanelEntry[]>(() => gameState.models.map((model) => {
    const unit = gameState.units.find((candidate) => candidate.id === model.unitId)
    const definition = unit ? getUnitDefinition(gameState, unit) : undefined
    const owner = getPlayerForModel(gameState, model)
    return {
      modelId: model.id,
      label: model.label ?? model.id,
      unitId: model.unitId,
      unitName: definition?.name ?? model.unitId,
      ownerId: model.ownerId,
      ownerName: owner?.displayName ?? model.ownerId,
      presence: modelPresence(model),
    }
  }), [gameState])
  const [smartMoveSession, setSmartMoveSession] = useState<SmartMoveSessionState | null>(null)
  const [smartMoveTargeting, setSmartMoveTargeting] = useState(initialSmartMoveTargetState)
  const [smartMoveAsync, setSmartMoveAsync] = useState(initialSmartMoveAsyncState)
  const [smartMoveDiagnostics, setSmartMoveDiagnostics] = useState<SmartMoveSchedulingDiagnostics | null>(null)
  const [smartMoveMessage, setSmartMoveMessage] = useState<string | null>(null)
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null)
  const [lifecycleSelectedIds, setLifecycleSelectedIds] = useState<Set<string>>(new Set())
  const [lifecycleRequireCoherency, setLifecycleRequireCoherency] = useState(false)
  const [lifecyclePlacement, setLifecyclePlacement] = useState<LifecyclePlacementSession | null>(null)
  const [lifecyclePlacementPreviews, setLifecyclePlacementPreviews] = useState<Array<{
    model: GameState['models'][number]
    pose: Pose
    valid: boolean
  }>>([])
  const lifecyclePlacementCoherency = useMemo(() => {
    if (!lifecyclePlacement || !lifecycleRequireCoherency || lifecyclePlacementPreviews.length === 0) return []
    const placements = Object.fromEntries(lifecyclePlacementPreviews.map((preview) => [preview.model.id, preview.pose]))
    return derivePlacementCoherency(gameState, lifecyclePlacement.modelIds, placements, true)
  }, [gameState, lifecyclePlacement, lifecyclePlacementPreviews, lifecycleRequireCoherency])
  const restartSmartMoveAfterApplyRef = useRef(false)
  const smartMoveControllerRef = useRef<SmartMoveWorkerController | null>(null)
  const smartMoveResult = smartMoveAsync.result
  const spatialPreviewResult = displayedSmartMovePreview(smartMoveResult)
  const spatialModels = useMemo(
    () => projectModelsForSmartMove(activeModels, spatialPreviewResult),
    [activeModels, spatialPreviewResult],
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
  const selectedActiveModel = selectedModel && modelPresence(selectedModel) === 'ON_BATTLEFIELD'
    ? selectedModel : undefined

  const selectedFeature = gameState.battlefieldFeatures?.find((feature) => feature.id === selectedFeatureId)
  const selectedTerrainRelationships = selectedActiveModel
    ? terrainRelationships(selectedActiveModel, gameState.battlefieldFeatures, gameState.terrainPolicy)
    : []
  const selectedTerrainMovement = selectedActiveModel && gameState.movementSession?.models[selectedActiveModel.id]
    ? movementTerrainInteractions(
      selectedActiveModel,
      gameState.movementSession.models[selectedActiveModel.id].trajectory,
      gameState.battlefieldFeatures,
      gameState.terrainPolicy,
    ) : undefined
  const selectedEffectiveTerrainPermissions = selectedActiveModel
    ? effectiveTerrainPermissions(
      selectedActiveModel.id,
      gameState.battlefieldFeatures,
      gameState.terrainPolicy,
      new Set([
        ...(selectedFeatureId ? [selectedFeatureId] : []),
        ...selectedTerrainRelationships.map((entry) => entry.featureId),
        ...(selectedTerrainMovement ?? []).map((entry) => entry.featureId),
      ]),
    ) : []

  const selectedWholeUnit = useMemo(() => gameState.units.find((unit) => {
    const activeIds = unit.modelIds.filter((id) => activeModels.some((model) => model.id === id))
    return activeIds.length > 0 && activeIds.length === selectedIds.size && activeIds.every((id) => selectedIds.has(id))
  }), [activeModels, gameState.units, selectedIds])
  const selectedWholeUnitName = selectedWholeUnit
    ? getUnitDefinition(gameState, selectedWholeUnit)?.name
    : undefined
  const selectedUnit = selectedModel ? getUnitForModel(gameState, selectedModel.id) : undefined
  const selectedUnitDefinition = selectedUnit ? getUnitDefinition(gameState, selectedUnit) : undefined
  const selectedObjective = gameState.battlefieldFeatures?.find((feature) => feature.id === selectedObjectiveId && feature.capabilities.objective)
  const selectedObjectiveArea = selectedObjective ? objectiveArea(selectedObjective) : null
  const spatialSelectedModel = selectedActiveModel ? spatialModels.find((model) => model.id === selectedActiveModel.id) : undefined
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
      objective: loadedRuntime.gameSystem.objectives,
    }),
    controlPreview: Boolean(spatialPreviewResult),
  } : null
  const selectedTerrainAreaAnalysis = selectedActiveModel ? (gameState.battlefieldFeatures ?? [])
    .filter((feature) => feature.capabilities.terrain && (feature.id === selectedFeatureId
      || selectedTerrainRelationships.some((relation) => relation.featureId === feature.id)))
    .map((feature) => ({
      featureId: feature.id, featureName: feature.name,
       modelRelationship: modelAreaRelationship(selectedActiveModel, featureBaseArea(feature)),
       unitSummary: selectedUnit ? unitAreaSummary(selectedUnit, activeModels, featureBaseArea(feature)) : null,
    })) : []
  const selectedUnitPolicy = selectedUnit ? getUnitCoherencyPolicy(gameState, selectedUnit) : undefined
  const selectedUnitCoherency = useMemo(
    () => selectedUnit && selectedUnitPolicy
      ? evaluateUnitCoherency(selectedUnit, activeModels, selectedUnitPolicy)
      : null,
    [activeModels, selectedUnit, selectedUnitPolicy],
  )

  const spatialSourceIds = useMemo(() => {
    if (selectedWholeUnit) return selectedWholeUnit.modelIds
    return selectedActiveModel ? [selectedActiveModel.id] : []
  }, [selectedActiveModel, selectedWholeUnit])

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
    const participants = activeModels.filter((model) => session.modelIds.includes(model.id))
    const allowances = participants.map((model) => session.movementAllowanceByModel?.[model.id]
      ?? getMovementAllowance(gameState, model))
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
  }, [activeModels, gameState])

  const selectedModelMovement = useMemo(() => {
    if (!selectedActiveModel) return null
    const allowance = gameState.movementSession?.movementAllowanceByModel?.[selectedActiveModel.id]
      ?? getMovementAllowance(gameState, selectedActiveModel)
    const liveUsed = gameState.movementSession?.models[selectedActiveModel.id]?.movementUsed ?? 0
    return { used: liveUsed, remaining: Math.max(0, allowance - liveUsed) }
  }, [gameState, selectedActiveModel])

  const measurement = useMemo(() => {
    if (!measurementPair) return null
    return measureBetweenTargets(battlefieldGameState, measurementPair.targetA, measurementPair.targetB)
  }, [battlefieldGameState, measurementPair])

  const smartMoveUnit = useMemo(
    () => smartMoveSession
      ? gameState.units.find((unit) => unit.id === smartMoveSession.unitId)
      : undefined,
    [gameState.units, smartMoveSession],
  )
  const smartMoveDefinition = smartMoveUnit ? getUnitDefinition(gameState, smartMoveUnit) : undefined
  const smartMovePolicy = smartMoveUnit ? getUnitCoherencyPolicy(gameState, smartMoveUnit) : undefined

  const smartMoveAuthorization = useMemo(() => smartMoveSession
    ? authorizeMovement(loadedRuntime, gameState, smartMoveSession.modelIds)
    : null, [gameState, loadedRuntime, smartMoveSession])
  const smartMoveRequestFactory = useMemo(() => (
    smartMoveSession && smartMovePolicy && smartMoveAuthorization?.allowed
      ? createSmartMoveRequestFactory(
          battlefieldGameState,
          smartMoveSession.modelIds,
          smartMovePolicy,
          smartMoveAuthorization.movementPolicy,
          smartMoveAuthorization.remainingByModel,
        )
      : null
  ), [battlefieldGameState, smartMoveAuthorization, smartMovePolicy, smartMoveSession])

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
    const runtime = loadRegisteredMatchRuntime(state, gameSystemRegistry, { movementPolicy })
    const permission = authorizeMovement(runtime, state, sortedModels.map((model) => model.id))
    if (!unit || !policy) {
      setSmartMoveSession(null)
      setSmartMoveMessage('This unit has no configured coherency policy.')
      return
    }
    if (!permission.allowed) {
      setSmartMoveSession(null)
      setSmartMoveMessage(permission.reason ?? 'Movement is not permitted by the active GameSystem.')
      return
    }
    const session = { modelIds: sortedModels.map((model) => model.id), unitId: unit.id }
    setSmartMoveSession(session)
    setSmartMoveMessage(null)
    smartMoveControllerRef.current?.beginSession(
      revision,
      createSmartMoveRequestFactory(
        { ...state, models: activeBattlefieldModels(state) },
        session.modelIds,
        policy,
        permission.movementPolicy,
        permission.remainingByModel,
      ),
    )
  }, [movementPolicy])

  useEffect(() => {
    if (!restartSmartMoveAfterApplyRef.current || activeTool !== 'smart-move' || gameState.movementSession) return
    restartSmartMoveAfterApplyRef.current = false
    beginSmartMoveForSelection(
      activeModels.filter((model) => selectedIds.has(model.id)),
      gameState,
      gameStateRevision,
    )
  }, [activeModels, activeTool, beginSmartMoveForSelection, gameState, gameStateRevision, selectedIds])

  const handleSelectionChange = useCallback((nextSelectedIds: Set<string>) => {
    setSelectedIds(nextSelectedIds)
    setSelectedFeatureId(null)
    if (spatialMode === 'visibility' && nextSelectedIds.size === 1) {
      const selectedId = [...nextSelectedIds][0]
      if (!visibilityViewerId) setVisibilityViewerId(selectedId)
      else if (selectedId !== visibilityViewerId) setVisibilityTargetId(selectedId)
    }
    if (!selectedObjectiveId && nextSelectedIds.size > 0) {
      const selectedModels = activeModels.filter((model) => nextSelectedIds.has(model.id))
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
    const models = activeModels.filter((model) => nextSelectedIds.has(model.id))
    beginSmartMoveForSelection(models, gameState, gameStateRevision)
  }, [activeModels, activeTool, beginSmartMoveForSelection, gameState, gameStateRevision, selectedObjectiveId, spatialMode, visibilityViewerId])

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
      const model = activeModels.find((candidate) => candidate.id === assignment.modelId)
      return model
        && Math.abs(model.position.x - assignment.start.x) <= GEOMETRY_EPSILON
        && Math.abs(model.position.y - assignment.start.y) <= GEOMETRY_EPSILON
        && (!assignment.trajectory
          || Math.abs(model.rotation - assignment.trajectory.startPose.rotation) <= GEOMETRY_EPSILON)
    })
    const authoritativeValidation = validateCandidateFormation({
      allModels: activeModels,
      battlefield: gameState.battlefield,
      terrainFeatures: gameState.battlefieldFeatures,
      terrainPolicy: gameState.terrainPolicy,
      positions: result.positions,
      rotations: Object.fromEntries(result.assignments.map((assignment) => {
        const model = activeModels.find((candidate) => candidate.id === assignment.modelId)
        return [assignment.modelId, assignment.finalRotation ?? model?.rotation ?? 0]
      })),
      reachability: {
        movementCosts: Object.fromEntries(result.assignments.map((assignment) => [
          assignment.modelId,
          assignment.movementCost,
        ])),
        movementAllowances: Object.fromEntries(smartMoveSession.modelIds.map((modelId) => {
          return [modelId, smartMoveAuthorization?.remainingByModel[modelId] ?? 0]
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
        const model = activeModels.find((candidate) => candidate.id === assignment.modelId)
        return [assignment.modelId, model?.rotation ?? 0]
      })),
      finalRotations: Object.fromEntries(result.assignments.map((assignment) => {
        const model = activeModels.find((candidate) => candidate.id === assignment.modelId)
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
  }, [activeModels, cancelSmartMove, dispatch, gameState, smartMoveAuthorization, smartMovePolicy, smartMoveSession, smartMoveUnit])

  const changeTool = useCallback((tool: ActiveTool) => {
    if (lifecyclePlacement) {
      setLifecyclePlacement(null)
      setLifecyclePlacementPreviews([])
      setLifecycleMessage('Placement cancelled because the active tool changed.')
    }
    setVisibilityPickTarget(null)
    setVisibilityPickHoverModelId(null)
    if (tool === 'smart-move') {
      if (!gameplayImplemented) return
      if (gameState.movementSession) {
        setBlockedMovementSessionId(gameState.movementSession.id)
        return
      }
      const models = activeModels
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
  }, [activeModels, beginSmartMoveForSelection, cancelSmartMove, gameState, gameStateRevision, gameplayImplemented, lifecyclePlacement, selectedIds])

  const toggleSpatialOverlay = useCallback(() => {
    if (lifecyclePlacement) {
      setLifecyclePlacement(null)
      setLifecyclePlacementPreviews([])
      setLifecycleMessage('Placement cancelled because the active tool changed.')
    }
    setVisibilityPickTarget(null)
    setVisibilityPickHoverModelId(null)
    if (!spatialEnabled) {
      // Opening analysis returns the pointer to ordinary tabletop manipulation.
      cancelSmartMove()
      setActiveTool('select')
      setMeasurementStartTarget(null)
    }
    setSpatialEnabled((enabled) => !enabled)
  }, [cancelSmartMove, lifecyclePlacement, spatialEnabled])

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
        if (canUndoLastMovement(gameState)) {
          dispatch({ type: 'movement/undoLastConfirmed' })
          setLifecyclePlacement(null)
          setLifecyclePlacementPreviews([])
          setLifecycleMessage('Last committed operation undone.')
        }
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
      if (event.key.toLowerCase() === 'g' && gameplayImplemented) changeTool('smart-move')
      if (event.key.toLowerCase() === 'f') setResetCameraSignal((value) => value + 1)
      if (event.key === 'Escape') {
        if (lifecyclePlacement) {
          setLifecyclePlacement(null)
          setLifecyclePlacementPreviews([])
          setLifecycleMessage('Placement cancelled.')
          return
        }
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
  }, [activeTool, applySmartMove, cancelSmartMove, changeTool, dispatch, gameState, gameplayImplemented, lifecyclePlacement, measurementPair, measurementStartTarget, smartMoveAsync.canApply, smartMoveTargeting, toggleSpatialOverlay, visibilityPickTarget])

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
  }, [activeTool, cancelSmartMove, dispatch, gameState.movementSession])

  const lifecycleRejectionReason = useCallback(() => gameState.movementSession
    ? 'Lifecycle command rejected: finish or cancel the active movement first.'
    : 'Lifecycle command rejected by the current match state or GameSystem.', [gameState.movementSession])

  const dispatchLifecycleAction = useCallback((action: GameStateAction, successMessage: string) => {
    const preview = reduceGameCommand(loadedRuntime, gameState, action)
    if (preview === gameState) {
      setLifecycleMessage(lifecycleRejectionReason())
      return false
    }
    dispatch(action)
    setLifecycleMessage(successMessage)
    return true
  }, [dispatch, gameState, lifecycleRejectionReason, loadedRuntime])

  const selectedLifecycleModels = useMemo(() => gameState.models
    .filter((model) => lifecycleSelectedIds.has(model.id)), [gameState.models, lifecycleSelectedIds])

  const setDevelopmentPresence = useCallback((presence: 'OFF_BOARD' | 'DESTROYED') => {
    const models = gameState.models.filter((model) => lifecycleSelectedIds.has(model.id))
    if (models.length === 0 || models.some((model) => modelPresence(model) !== 'ON_BATTLEFIELD')) {
      setLifecycleMessage('Lifecycle command rejected: select only models currently on the battlefield.')
      return
    }
    const modelIds = models.map((model) => model.id).sort()
    const accepted = dispatchLifecycleAction(
      { type: 'lifecycle/modelsPresenceSet', modelIds, presence },
      `${modelIds.length} model${modelIds.length === 1 ? '' : 's'} moved to ${presence === 'DESTROYED' ? 'Destroyed' : 'Off Board / Reserve'}.`,
    )
    if (!accepted) return
    setSelectedIds(new Set())
    setSelectedFeatureId(null)
    setLifecyclePlacement(null)
    setLifecyclePlacementPreviews([])
    if (visibilityViewerId && modelIds.includes(visibilityViewerId)) setVisibilityViewerId(null)
    if (visibilityTargetId && modelIds.includes(visibilityTargetId)) setVisibilityTargetId(null)
    if (smartMoveSession?.modelIds.some((modelId) => modelIds.includes(modelId))) cancelSmartMove()
  }, [cancelSmartMove, dispatchLifecycleAction, gameState.models, lifecycleSelectedIds, smartMoveSession, visibilityTargetId, visibilityViewerId])

  const cancelLifecyclePlacement = useCallback((message = 'Placement cancelled.') => {
    setLifecyclePlacement(null)
    setLifecyclePlacementPreviews([])
    setLifecycleMessage(message)
  }, [])

  const beginLifecyclePlacement = useCallback((mode: LifecyclePlacementSession['mode']) => {
    if (selectedLifecycleModels.length === 0
      || selectedLifecycleModels.some((model) => modelPresence(model) === 'ON_BATTLEFIELD')) {
      setLifecycleMessage('Placement cannot start: select only Off Board or Destroyed models.')
      return
    }
    if (gameState.movementSession) {
      setLifecycleMessage('Placement cannot start during an active movement.')
      return
    }
    cancelSmartMove()
    setActiveTool('select')
    setSelectedIds(new Set())
    setSelectedFeatureId(null)
    setLifecyclePlacement({ mode, modelIds: selectedLifecycleModels.map((model) => model.id).sort(), stagedPoses: {} })
    setLifecyclePlacementPreviews([])
    setLifecycleMessage(mode === 'formation'
      ? `Move the ${selectedLifecycleModels.length}-model formation, then click a legal position.`
      : `Place ${selectedLifecycleModels.length} model${selectedLifecycleModels.length === 1 ? '' : 's'} one at a time; nothing commits until the last model.`)
  }, [cancelSmartMove, gameState.movementSession, selectedLifecycleModels])

  const placementsAtPoint = useCallback((position: { x: number; y: number }) => {
    if (!lifecyclePlacement) return null
    const models = lifecyclePlacement.modelIds.flatMap((modelId) => {
      const model = gameState.models.find((candidate) => candidate.id === modelId)
      return model ? [model] : []
    })
    if (models.length !== lifecyclePlacement.modelIds.length) return null
    if (lifecyclePlacement.mode === 'formation') return formationPlacements(models, position)
    const currentId = nextUnplacedModelId(lifecyclePlacement.modelIds, lifecyclePlacement.stagedPoses)
    const current = models.find((model) => model.id === currentId)
    if (!current) return null
    return { ...lifecyclePlacement.stagedPoses, [current.id]: { position, rotation: current.rotation } }
  }, [gameState.models, lifecyclePlacement])

  const validateLifecyclePlacements = useCallback((placements: Record<string, Pose>, final: boolean) =>
    validateModelPlacements({
      state: gameState,
      placements,
      constraints: { requireCoherency: final && lifecycleRequireCoherency },
    }), [gameState, lifecycleRequireCoherency])

  const previewLifecyclePlacement = useCallback((position: { x: number; y: number }) => {
    if (!lifecyclePlacement) return
    const placements = placementsAtPoint(position)
    if (!placements) return
    const final = lifecyclePlacement.mode === 'formation'
      || Object.keys(placements).length === lifecyclePlacement.modelIds.length
    const validation = validateLifecyclePlacements(placements, final)
    setLifecyclePlacementPreviews(Object.entries(placements).flatMap(([modelId, pose]) => {
      const model = gameState.models.find((candidate) => candidate.id === modelId)
      return model ? [{ model, pose, valid: validation.valid }] : []
    }))
  }, [gameState.models, lifecyclePlacement, placementsAtPoint, validateLifecyclePlacements])

  const commitLifecyclePlacement = useCallback((position: { x: number; y: number }) => {
    if (!lifecyclePlacement) return
    const placements = placementsAtPoint(position)
    if (!placements) return
    const final = lifecyclePlacement.mode === 'formation'
      || Object.keys(placements).length === lifecyclePlacement.modelIds.length
    const validation = validateLifecyclePlacements(placements, final)
    if (!validation.valid) {
      setLifecycleMessage(`Placement rejected: ${validation.violations.map((entry) => entry.type).join(', ')}`)
      previewLifecyclePlacement(position)
      return
    }
    if (!final) {
      setLifecyclePlacement({ ...lifecyclePlacement, stagedPoses: placements })
      setLifecycleMessage(`${Object.keys(placements).length} of ${lifecyclePlacement.modelIds.length} staged. Place the next model.`)
      return
    }
    const accepted = dispatchLifecycleAction(
      { type: 'lifecycle/modelsPlaced', placements, requireCoherency: lifecycleRequireCoherency },
      `${lifecyclePlacement.modelIds.length} model${lifecyclePlacement.modelIds.length === 1 ? '' : 's'} restored to the battlefield.`,
    )
    if (!accepted) return
    setLifecyclePlacement(null)
    setLifecyclePlacementPreviews([])
    setSelectedIds(new Set(lifecyclePlacement.modelIds))
  }, [dispatchLifecycleAction, lifecyclePlacement, lifecycleRequireCoherency, placementsAtPoint, previewLifecyclePlacement, validateLifecyclePlacements])

  const toggleLifecyclePanel = useCallback(() => {
    if (lifecycleOpen) {
      cancelLifecyclePlacement('Lifecycle panel closed.')
      setLifecycleOpen(false)
      return
    }
    setLifecycleOpen(true)
    setLifecycleSelectedIds(new Set(selectedIds))
    setLifecycleMessage(null)
  }, [cancelLifecyclePlacement, lifecycleOpen, selectedIds])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">FIELDCRAFT</div>
          <div className="brand-subtitle">COMPETITIVE TABLETOP LAB</div>
        </div>
        {gameplayImplemented ? <GameStatusPanel
          gameState={battlefieldGameState}
          blockedMessage={gameState.movementSession?.id === blockedMovementSessionId
            ? 'Finish or cancel the current movement first.'
            : null}
          onEndTurn={handleEndTurn}
          onRecordScore={(playerId, pointsDelta, reason) => dispatch({
            type: 'score/eventRecorded', playerId, pointsDelta, reason,
            source: { type: 'manual' },
          })}
          onUndoLastScore={() => {
            dispatch({ type: 'history/undoLastCommitted' })
            setLifecyclePlacement(null)
            setLifecyclePlacementPreviews([])
            setLifecycleMessage('Last committed operation undone.')
          }}
        /> : <GameSystemStatusPanel ui={gameSystemRegistration.ui} gameState={gameState} />}
        <MatchControls
          notice={matchNotice?.message}
          error={matchNotice?.error}
          onNewMatch={onNewMatch}
          onSave={() => onSave(gameState)}
          onLoad={onLoad}
          onSaveAs={() => onSaveAs(gameState)}
        />
        <div className="session-info">
          <span className="status-dot" /> {loadedRuntime.gameSystem.name.toUpperCase()}
          <span className="divider" />
          <strong>{gameState.battlefield.width} × {gameState.battlefield.height}</strong>
        </div>
      </header>
      <Toolbar
        activeTool={activeTool}
        spatialEnabled={spatialEnabled}
        diceOpen={diceOpen}
        lifecycleOpen={lifecycleOpen}
        gameplayToolsEnabled={gameplayImplemented}
        onToolChange={changeTool}
        onSpatialToggle={toggleSpatialOverlay}
        onDiceToggle={() => setDiceOpen((open) => !open)}
        onLifecycleToggle={toggleLifecyclePanel}
        onResetCamera={() => setResetCameraSignal((value) => value + 1)}
      />
      <section className="workspace">
        <TabletopCanvas
          gameState={battlefieldGameState}
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
          lifecyclePlacementActive={Boolean(lifecyclePlacement)}
          lifecyclePlacementPreviews={lifecyclePlacementPreviews}
          lifecyclePlacementCoherency={lifecyclePlacementCoherency}
          resetCameraSignal={resetCameraSignal}
          movementPolicy={movementPolicy}
          onSelectionChange={handleSelectionChange}
          onFeatureSelectionChange={handleFeatureSelectionChange}
          onMeasureTarget={handleMeasureTarget}
          onSmartMoveTargetPreview={previewSmartMoveTarget}
          onSmartMoveTargetLock={lockSmartMoveTarget}
          onVisibilityPickModel={handleVisibilityPickModel}
          onVisibilityPickHover={setVisibilityPickHoverModelId}
          onLifecyclePlacementPreview={previewLifecyclePlacement}
          onLifecyclePlacementCommit={commitLifecyclePlacement}
          dispatch={dispatch}
        />
        {developmentControlsEnabled && (footprintDemoEnabled || orientationGapEnabled) && (
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
          unitModelCount={selectedUnit
            ? activeModels.filter((model) => selectedUnit.modelIds.includes(model.id)).length
            : undefined}
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
        {gameplayImplemented && lifecycleOpen && (
          <LifecyclePanel
            entries={lifecycleEntries}
            selectedIds={lifecycleSelectedIds}
            placement={lifecyclePlacement ? {
              mode: lifecyclePlacement.mode,
              placedCount: Object.keys(lifecyclePlacement.stagedPoses).length,
              totalCount: lifecyclePlacement.modelIds.length,
              coherency: lifecyclePlacementCoherency.map((preview) => ({
                coherent: preview.result.coherent,
                componentCount: preview.result.componentCount,
              })),
            } : null}
            requireCoherency={lifecycleRequireCoherency}
            message={lifecycleMessage ?? undefined}
            onClose={toggleLifecyclePanel}
            onInspect={(modelId) => {
              setSelectedIds(new Set([modelId]))
              setSelectedFeatureId(null)
            }}
            onToggleModel={(modelId) => setLifecycleSelectedIds((current) => {
              const next = new Set(current)
              if (next.has(modelId)) next.delete(modelId)
              else next.add(modelId)
              return next
            })}
            onSelectModels={(modelIds) => setLifecycleSelectedIds(new Set(modelIds))}
            onClearSelection={() => setLifecycleSelectedIds(new Set())}
            onMoveOffBoard={() => setDevelopmentPresence('OFF_BOARD')}
            onDestroy={() => setDevelopmentPresence('DESTROYED')}
            onPlaceIndividually={() => beginLifecyclePlacement('individual')}
            onPlaceFormation={() => beginLifecyclePlacement('formation')}
            onCancelPlacement={cancelLifecyclePlacement}
            onRequireCoherencyChange={setLifecycleRequireCoherency}
          />
        )}
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
            developmentControlsEnabled={developmentControlsEnabled}
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
        {gameplayImplemented && movementSummary && (
          <MovementPanel
            summary={movementSummary}
            onConfirm={() => dispatch({ type: 'movement/confirmed' })}
            onCancel={() => dispatch({ type: 'movement/cancelled' })}
          />
        )}
        {gameplayImplemented && activeTool === 'smart-move' && (
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
        {gameplayImplemented && diceOpen && (
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
  movementRemaining: Record<string, number>,
): (target: SmartMoveRequest['target']) => SmartMoveRequest {
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
  envelope: { action: GameStateAction; movementPolicy: MovementPolicyConfig },
) {
  const runtime = loadRegisteredMatchRuntime(current.gameState, gameSystemRegistry, {
    movementPolicy: envelope.movementPolicy,
  })
  const nextGameState = reduceGameCommand(runtime, current.gameState, envelope.action)
  return nextGameState === current.gameState
    ? current
    : { gameState: nextGameState, revision: current.revision + 1 }
}

function startupGameState(): GameState {
  const query = new URLSearchParams(window.location.search)
  const source = query.has('lifecycle') ? lifecycleDemoGameState
    : query.has('battlefieldFeatures') ? battlefieldFeatureDemoGameState
      : query.has('orientationGap') ? orientationGapGameState
        : query.has('footprints') ? footprintDemoGameState : initialGameState
  const routeId = query.has('lifecycle') ? 'development-lifecycle-preview'
    : query.has('battlefieldFeatures') ? 'development-battlefield-preview'
      : query.has('orientationGap') ? 'development-orientation-preview'
        : query.has('footprints') ? 'development-footprint-preview' : 'development-sandbox-preview'
  return {
    ...structuredClone(source),
    matchIdentity: { ...source.matchIdentity!, matchId: routeId, matchName: source.matchIdentity?.matchName ?? 'Development Preview' },
    matchLifecycle: source.matchLifecycle ?? 'SETUP',
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The match could not be loaded.'
}
