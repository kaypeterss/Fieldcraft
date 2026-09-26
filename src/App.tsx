import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { footprintDemoGameState, initialGameState, orientationGapGameState } from './game/initialState'
import { battlefieldFeatureDemoGameState } from './game/battlefieldFeatureDemo'
import { lifecycleDemoGameState } from './game/lifecycleDemo'
import type { DicePoolResult, GameState, JsonValue, MovementPolicyConfig, Pose } from './domain/types'
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
import { formationShortcutForEvent, isEditableKeyboardTarget, isUndoMovementShortcut } from './tools/keyboard'
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
import type { CandidateFormationViolation } from './engine/candidateFormation'
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
import { derivePlacementCoherency, nextUnplacedModelId, projectModelsForPlacement } from './tools/lifecyclePlacement'
import { formationPresetCandidates, rotateFormationPlacements, type FormationPresetId } from './tools/formationPresets'
import { gameSystemRegistry } from './gameSystem/registeredGameSystems'
import { listSavedMatches, loadMatchFromStorage, loadSavedMatch as loadSavedMatchRecord, saveMatchAsToStorage, saveMatchToStorage, deleteSavedMatch } from './game/matchPersistence'
import { NewMatchDialog } from './ui/NewMatchDialog'
import { GameSystemStatusPanel } from './ui/GameSystemStatusPanel'
import { MatchControls } from './ui/MatchControls'
import { LoadMatchDialog } from './ui/LoadMatchDialog'
import { UnsavedChangesDialog } from './ui/UnsavedChangesDialog'
import { MatchIdentityHeader } from './ui/MatchIdentityHeader'
import { SaveAsDialog } from './ui/SaveAsDialog'
import { MatchInfoPanel } from './ui/MatchInfoPanel'
import { DeploymentPanel, type DeploymentPlacementView } from './ui/DeploymentPanel'
import { aosDeploymentPlacementRules, aosDeploymentState, aosMatchStateData, validateAosDeploymentPlacements } from './gameSystem/ageOfSigmar/deployment'
import { rollDice, systemRandomSource } from './engine/dice'
import { resolveDiceSequence } from './engine/diceSequence'
import { aosBattleState, aosRoundResources, currentAosPhase, hasUnresolvedRequiredAosFights } from './gameSystem/ageOfSigmar/battleRound'
import { AosBattleRoundPanel } from './ui/AosBattleRoundPanel'
import { postMovementCommitView } from './ui/movementInteractionState'
import { aosPhaseProgressionBlockReason } from './ui/aosPhaseProgression'
import { AosMovementPanel, type AosMovementMethod } from './ui/AosMovementPanel'
import { AosCombatPanel } from './ui/AosCombatPanel'
import {
  aosCasualtyCandidateModelIds,
  aosUnitDamagePresentation,
  deriveAosFightPresentationFocus,
  deriveAosCombatModelMarkers,
} from './gameSystem/ageOfSigmar/combatPresentation'
import {
  aosCombatDiceStages,
  type AosCombatDiceMode,
  type AosCombatDiceReview,
} from './gameSystem/ageOfSigmar/combatDicePresentation'
import { createAosChargePileInDemo } from './gameSystem/ageOfSigmar/chargePileInDemo'
import {
  aosMovementRuleAssistance,
  aosDestinationRuleAssistance,
  aosMovementAvailability,
  aosMovementRevealedRoll,
  aosUnitMovementStatus,
  rollAosMovementActionDie,
  rollAosCharge,
  type AosMovementActionId,
} from './gameSystem/ageOfSigmar/movement'
import {
  aosAttackCountForTarget,
  aosAttackProfileOptions,
  aosAttackSequenceDefinition,
  aosAttackSequenceModifiers,
  aosDamageAllocationOptions,
  aosCoherencyCorrectionOptions,
  aosFightAvailability,
  aosUnitAllocatedDamage,
  aosUnitProfile,
  ensureAosCombatState,
  type AosDeclaredAttack,
} from './gameSystem/ageOfSigmar/combat'
import {
  defaultBoardOverlayPreferences,
  deploymentZonesVisible,
  deriveActionFocusPresentation,
  deriveUnitBattlefieldPresentations,
  type BoardOverlayPreferences,
} from './tools/battlefieldPresentation'

interface SmartMoveSessionState {
  modelIds: string[]
  unitId: string
}

interface LifecyclePlacementSession {
  mode: 'individual' | 'formation'
  modelIds: string[]
  stagedPoses: Record<string, Pose>
  formationPreset: FormationPresetId | 'custom'
  formationAnchor: { x: number; y: number } | null
  formationRotation: number
}

interface DeploymentPlacementSession {
  unitId: string
  placements: Record<string, Pose>
  locked: boolean
  adjustingModelId: string | null
  hoveredModelId: string | null
  formationPreset: FormationPresetId | 'custom'
  formationAnchor: { x: number; y: number } | null
  formationRotation: number
}

type ContextPanelId = 'inspector' | 'spatial' | 'lifecycle' | 'dice' | 'smart-move' | 'movement' | 'combat' | 'match-info' | 'deployment' | 'battle-round'

const FORMATION_ROTATION_STEP = Math.PI / 12

export default function App() {
  const [session, setSession] = useState(() => ({ gameState: startupGameState(), key: 0 }))
  const [newMatchOpen, setNewMatchOpen] = useState(false)
  const [loadMatchOpen, setLoadMatchOpen] = useState(false)
  const [matchNotice, setMatchNotice] = useState<{ message: string; error: boolean } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<'new' | 'load' | null>(null)
  const [saveAsState, setSaveAsState] = useState<GameState | null>(null)
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
        onSaveAs={setSaveAsState}
        onReplaceState={(state) => {
          setSession((current) => ({ gameState: state, key: current.key + 1 }))
          currentStateRef.current = state
          setDirty(true)
          setMatchNotice({ message: 'Match prepared. Both armies remain off board for deployment.', error: false })
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
    {saveAsState && <SaveAsDialog initialName={`${saveAsState.matchIdentity?.matchName ?? 'Match'} Copy`}
      onCancel={() => setSaveAsState(null)}
      onConfirm={(name) => {
        try {
          const copy = saveMatchAsToStorage(window.localStorage, saveAsState, name)
          setSession((current) => ({ gameState: copy, key: current.key + 1 }))
          currentStateRef.current = copy
          setDirty(false)
          setSaveAsState(null)
          setMatchNotice({ message: `Saved a new match as “${name}”.`, error: false })
        } catch (error) {
          setMatchNotice({ message: errorMessage(error), error: true })
        }
      }} />}
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
  onReplaceState: (state: GameState) => void
}

function MatchWorkspace({ initialState, matchNotice, onNewMatch, onSave, onLoad, onSaveAs, onStateChange, onReplaceState }: MatchWorkspaceProps) {
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
  const [boardOverlays, setBoardOverlays] = useState<BoardOverlayPreferences>(() =>
    defaultBoardOverlayPreferences(initialRegistration.ui.developmentControls))
  const [diceOpen, setDiceOpen] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)
  const [contextPanel, setContextPanel] = useState<ContextPanelId>(() => (
    initialState.matchIdentity?.gameSystem.id === 'age-of-sigmar'
      ? initialState.matchLifecycle === 'DEPLOYMENT' ? 'deployment'
        : initialState.matchLifecycle === 'IN_PROGRESS' ? 'battle-round' : 'inspector'
      : 'inspector'
  ))
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
  const dispatch = useCallback((action: GameStateAction) => {
    if (action.type === 'movement/sessionStarted') setContextPanel('movement')
    if (action.type === 'movement/confirmed' || action.type === 'movement/cancelled') {
      setContextPanel((current) => current === 'movement' ? 'inspector' : current)
    }
    rawDispatch({ action, movementPolicy })
  }, [movementPolicy])
  const loadedRuntime = useMemo(
    () => loadRegisteredMatchRuntime(gameState, gameSystemRegistry, { movementPolicy }),
    [gameState, movementPolicy],
  )
  const gameSystemRegistration = loadedRuntime.registration!
  const developmentControlsEnabled = gameSystemRegistration.ui.developmentControls
  const gameplayImplemented = gameSystemRegistration.ui.gameplayImplemented
  const capabilities = gameSystemRegistration.ui.capabilities
  const lifecycleAvailable = (capabilities?.lifecycle ?? gameplayImplemented) || (gameState.matchLifecycle === 'DEPLOYMENT' && gameState.units.length > 0)
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
  const [lifecycleRequireCoherency, setLifecycleRequireCoherency] = useState(false)
  const [lifecyclePlacement, setLifecyclePlacement] = useState<LifecyclePlacementSession | null>(null)
  const [lifecyclePlacementPreviews, setLifecyclePlacementPreviews] = useState<Array<{
    model: GameState['models'][number]
    pose: Pose
    valid: boolean
  }>>([])
  const [deploymentPlacement, setDeploymentPlacement] = useState<DeploymentPlacementSession | null>(null)
  const [aosMovementMessage, setAosMovementMessage] = useState<string | null>(null)
  const [combatProfileFocus, setCombatProfileFocus] = useState<{ profileId: string; targetUnitId: string | null } | null>(null)
  const [battlefieldHoveredModelId, setBattlefieldHoveredModelId] = useState<string | null>(null)
  const [combatDiceMode, setCombatDiceMode] = useState<AosCombatDiceMode>('quick')
  const [combatDiceReview, setCombatDiceReview] = useState<AosCombatDiceReview | null>(null)
  const [revealedCombatDiceStage, setRevealedCombatDiceStage] = useState(0)
  const [selectedCasualtyModelId, setSelectedCasualtyModelId] = useState<string | null>(null)
  const [deploymentTerritoryHoverId, setDeploymentTerritoryHoverId] = useState<string | null>(null)
  const aosDeployment = useMemo(() => aosDeploymentState(gameState), [gameState])
  const aosBattle = useMemo(() => aosBattleState(gameState), [gameState])
  const isAosMatch = gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar'
  const showGenericGameStatus = !isAosMatch && (capabilities?.gameStatus ?? gameplayImplemented)
  const aosResources = useMemo(() => aosRoundResources(gameState), [gameState])
  const lifecyclePlacementCoherency = useMemo(() => {
    if (!lifecyclePlacement || !lifecycleRequireCoherency || lifecyclePlacementPreviews.length === 0) return []
    const placements = Object.fromEntries(lifecyclePlacementPreviews.map((preview) => [preview.model.id, preview.pose]))
    return derivePlacementCoherency(gameState, lifecyclePlacement.modelIds, placements, true)
  }, [gameState, lifecyclePlacement, lifecyclePlacementPreviews, lifecycleRequireCoherency])
  const lifecycleFormationOptions = useMemo(() => {
    if (!lifecyclePlacement || lifecyclePlacement.mode !== 'formation') return []
    const movingModels = lifecyclePlacement.modelIds.flatMap((id) => {
      const model = gameState.models.find((candidate) => candidate.id === id)
      return model ? [model] : []
    })
    const unit = gameState.units.find((candidate) => candidate.id === movingModels[0]?.unitId)
    const policy = unit ? getUnitCoherencyPolicy(gameState, unit)
      ?? { distance: 0.25, requiredNeighbors: 0, requireConnected: false } : undefined
    if (!unit || !policy) return []
    const movingIds = new Set(lifecyclePlacement.modelIds)
    const fixedModels = gameState.models.filter((model) => model.unitId === unit.id
      && !movingIds.has(model.id) && modelPresence(model) === 'ON_BATTLEFIELD')
    return formationPresetCandidates({
      unit, movingModels, fixedModels, policy,
      anchor: lifecyclePlacement.formationAnchor ?? { x: 0, y: 0 },
      rotation: lifecyclePlacement.formationRotation,
    })
  }, [gameState, lifecyclePlacement])
  const restartSmartMoveAfterApplyRef = useRef(false)
  const smartMoveControllerRef = useRef<SmartMoveWorkerController | null>(null)
  const smartMoveResult = smartMoveAsync.result
  const spatialPreviewResult = displayedSmartMovePreview(smartMoveResult)
  const stagedPlacementPoses = deploymentPlacement?.placements
    ?? lifecyclePlacement?.stagedPoses
    ?? null
  const placementProjectedModels = useMemo(
    () => stagedPlacementPoses && Object.keys(stagedPlacementPoses).length > 0
      ? projectModelsForPlacement(gameState, stagedPlacementPoses)
      : activeModels,
    [activeModels, gameState, stagedPlacementPoses],
  )
  const spatialModels = useMemo(
    () => projectModelsForSmartMove(placementProjectedModels, spatialPreviewResult),
    [placementProjectedModels, spatialPreviewResult],
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
    const selectedActiveUnit = activeIds.length > 0 && activeIds.length === selectedIds.size && activeIds.every((id) => selectedIds.has(id))
    const placementUnit = deploymentPlacement?.unitId === unit.id
      || lifecyclePlacement?.modelIds.includes(unit.modelIds[0] ?? '')
    const selectedPlacementUnit = Boolean(placementUnit)
      && unit.modelIds.length === selectedIds.size
      && unit.modelIds.every((id) => selectedIds.has(id))
    return selectedActiveUnit || selectedPlacementUnit
  }), [activeModels, deploymentPlacement, gameState.units, lifecyclePlacement, selectedIds])
  const selectedWholeUnitName = selectedWholeUnit
    ? getUnitDefinition(gameState, selectedWholeUnit)?.name
    : undefined
  const selectedUnit = selectedModel ? getUnitForModel(gameState, selectedModel.id) : undefined
  const selectedUnitDefinition = selectedUnit ? getUnitDefinition(gameState, selectedUnit) : undefined
  const aosMovementPhaseId = aosBattle ? currentAosPhase(aosBattle)?.id : undefined
  const aosMovementPhaseActive = aosMovementPhaseId === 'MOVEMENT_PHASE' || aosMovementPhaseId === 'CHARGE_PHASE' || aosMovementPhaseId === 'COMBAT_PHASE'
  const aosCombatPhaseActive = aosMovementPhaseId === 'COMBAT_PHASE'
  const aosData = useMemo(() => aosMatchStateData(gameState), [gameState])
  const aosCombat = useMemo(() => aosData ? ensureAosCombatState(aosData, gameState) : null, [aosData, gameState])
  const selectedAosMovement = selectedUnit && gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar'
    ? aosMovementAvailability(gameState, selectedUnit.id) : null
  const activeFightUnit = aosCombat?.activeFight
    ? gameState.units.find((unit) => unit.id === aosCombat.activeFight?.unitId) : undefined
  const combatDisplayUnit = activeFightUnit ?? selectedUnit
  const combatDisplayDefinition = combatDisplayUnit ? getUnitDefinition(gameState, combatDisplayUnit) : undefined
  const selectedFightAvailability = combatDisplayUnit ? aosFightAvailability(gameState, combatDisplayUnit.id) : null
  const combatProfileOptions = combatDisplayUnit ? aosAttackProfileOptions(gameState, combatDisplayUnit.id) : []
  const combatPendingDamage = aosCombat?.activeFight?.pendingDamage
  const combatAllocationOptions = useMemo(() => {
    if (!combatPendingDamage) return []
    if (combatPendingDamage.coherencyCorrection) return aosCoherencyCorrectionOptions(gameState, combatPendingDamage.targetUnitId)
    const target = gameState.units.find((unit) => unit.id === combatPendingDamage.targetUnitId)
    const health = target ? aosUnitProfile(gameState, target)?.health : undefined
    if (health && aosUnitAllocatedDamage(gameState, combatPendingDamage.targetUnitId) + combatPendingDamage.remaining < health) return []
    return aosDamageAllocationOptions(gameState, combatPendingDamage.targetUnitId)
  }, [combatPendingDamage, gameState])
  const combatCasualtyCandidates = useMemo(
    () => aosCasualtyCandidateModelIds(combatAllocationOptions),
    [combatAllocationOptions],
  )
  const currentCombatDiceReview = combatDiceReview
    && gameState.diceHistory?.some((record) => record.id === combatDiceReview.sequenceRecordId)
    ? combatDiceReview : null
  const combatDiceStepping = Boolean(combatDiceMode === 'step' && currentCombatDiceReview
    && revealedCombatDiceStage < aosCombatDiceStages(currentCombatDiceReview).length)
  const visibleSelectedCasualtyModelId = selectedCasualtyModelId
    && combatCasualtyCandidates.includes(selectedCasualtyModelId) ? selectedCasualtyModelId : null
  const movementToolsEnabled = (capabilities?.movement ?? gameplayImplemented) && (gameState.matchIdentity?.gameSystem.id !== 'age-of-sigmar' || aosMovementPhaseActive)
  const selectedMovementActionReady = Boolean(selectedAosMovement?.selected
    && selectedAosMovement.available.includes(selectedAosMovement.selected.actionId))
  const movementMethodEnabled = gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar' ? selectedMovementActionReady : (capabilities?.movement ?? gameplayImplemented)
  const movementMethodDisabledReason = selectedAosMovement?.reason
    ?? (!selectedUnit ? 'Select a unit, then choose a movement action.' : 'Choose an available movement action first.')
  const aosMovementStatuses = useMemo(() => gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar'
    ? gameState.units.flatMap((unit) => {
      const status = aosUnitMovementStatus(gameState, unit.id)
      return status ? [status] : []
    }) : [], [gameState])
  const unitBattlefieldPresentations = useMemo(
    () => deriveUnitBattlefieldPresentations(
      { ...battlefieldGameState, models: spatialModels }, aosMovementStatuses,
    ).map((presentation) => {
      const damage = isAosMatch ? aosUnitDamagePresentation(gameState, presentation.unitId) : null
      return {
        ...presentation,
        ...(damage?.badgeText ? {
          damageLabel: damage.badgeText,
          damageDetail: `Current unit damage ${damage.currentDamage}/${damage.healthThreshold} · ${damage.untilNextSlain} more slays a model`,
        } : {}),
      }
    }),
    [aosMovementStatuses, battlefieldGameState, gameState, isAosMatch, spatialModels],
  )
  const deploymentActive = Boolean(aosDeployment && aosDeployment.phase !== 'READY_FOR_BATTLE')
  const showDeploymentZones = deploymentZonesVisible(deploymentActive, boardOverlays.deploymentZones)
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
    return measureBetweenTargets({ ...battlefieldGameState, models: spatialModels }, measurementPair.targetA, measurementPair.targetB)
  }, [battlefieldGameState, measurementPair, spatialModels])

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
  const combatPresentationFocus = useMemo(() => {
    return deriveAosFightPresentationFocus(
      { ...gameState, models: spatialModels },
      aosCombat?.activeFight,
      combatProfileFocus,
    )
  }, [aosCombat?.activeFight, combatProfileFocus, gameState, spatialModels])
  const actionFocus = useMemo(() => {
    const movementContext = gameState.movementSession?.actionContext ?? smartMoveAuthorization?.actionContext
    const fight = aosCombat?.activeFight
    const actingUnitId = movementContext?.unitId ?? fight?.unitId
    if (!actingUnitId) return null
    const movementTargetModelIds = movementContext?.destinationConstraints.flatMap((constraint) => {
      if (constraint.type === 'ANY_SOURCE_WITHIN_TARGETS' || constraint.type === 'EACH_SOURCE_NO_FARTHER_FROM_TARGETS') return constraint.targetModelIds
      return constraint.targetGroups.flatMap((group) => group.modelIds)
    }) ?? []
    const movementTargetUnitIds = [...new Set(movementTargetModelIds.flatMap((id) => {
      const model = gameState.models.find((candidate) => candidate.id === id)
      return model ? [model.unitId] : []
    }))]
    const combatTargetUnitIds = fight?.pendingDamage ? [fight.pendingDamage.targetUnitId]
      : combatPresentationFocus?.targetUnitId ? [combatPresentationFocus.targetUnitId] : []
    return deriveActionFocusPresentation({ ...battlefieldGameState, models: spatialModels }, {
      actingUnitId,
      targetUnitIds: fight && combatTargetUnitIds.length ? combatTargetUnitIds : movementTargetUnitIds,
      targetEnvelopeUnitIds: fight ? combatTargetUnitIds : [],
      eligibleModelIds: combatPresentationFocus?.eligibleModelIds,
      profileModelIds: combatPresentationFocus?.profileModelIds,
      casualtyCandidateModelIds: combatDiceStepping ? [] : combatCasualtyCandidates,
      casualtySelectedModelIds: visibleSelectedCasualtyModelId ? [visibleSelectedCasualtyModelId] : [],
    })
  }, [aosCombat?.activeFight, battlefieldGameState, combatCasualtyCandidates, combatDiceStepping, combatPresentationFocus,
    gameState, smartMoveAuthorization?.actionContext, spatialModels, visibleSelectedCasualtyModelId])
  const combatModelMarkers = useMemo(() => isAosMatch ? deriveAosCombatModelMarkers(gameState) : [], [gameState, isAosMatch])
  const movementRuleAssistance = useMemo(() => aosMovementRuleAssistance(
    gameState.movementSession?.actionContext ?? smartMoveAuthorization?.actionContext,
  ), [gameState.movementSession?.actionContext, smartMoveAuthorization?.actionContext])
  const movementDestinationAssistance = useMemo(() => aosDestinationRuleAssistance(
    gameState.movementSession?.actionContext ?? smartMoveAuthorization?.actionContext,
  ), [gameState.movementSession?.actionContext, smartMoveAuthorization?.actionContext])
  const smartMoveRequestFactory = useMemo(() => (
    smartMoveSession && smartMovePolicy && smartMoveAuthorization?.allowed
      ? createSmartMoveRequestFactory(
          battlefieldGameState,
          smartMoveSession.modelIds,
          smartMovePolicy,
          smartMoveAuthorization.movementPolicy,
          smartMoveAuthorization.remainingByModel,
          smartMoveAuthorization.actionContext,
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
        permission.actionContext,
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
    if (activeTool === 'move' && aosMovementPhaseActive) {
      const nextModel = activeModels.find((model) => nextSelectedIds.has(model.id))
      const nextUnit = nextModel ? getUnitForModel(gameState, nextModel.id) : undefined
      const nextAvailability = nextUnit ? aosMovementAvailability(gameState, nextUnit.id) : null
      if (!nextAvailability?.selected
        || !nextAvailability.available.includes(nextAvailability.selected.actionId)) setActiveTool('select')
    }
    setSelectedIds(nextSelectedIds)
    setSelectedFeatureId(null)
    if (aosMovementPhaseActive && nextSelectedIds.size > 0 && activeTool !== 'smart-move') {
      setContextPanel(aosMovementPhaseId === 'COMBAT_PHASE' ? 'combat' : 'movement')
      setAosMovementMessage(null)
    }
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
  }, [activeModels, activeTool, aosMovementPhaseActive, aosMovementPhaseId, beginSmartMoveForSelection, gameState, gameStateRevision, selectedObjectiveId, spatialMode, visibilityViewerId])

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
      separationConstraints: smartMoveAuthorization?.actionContext?.separationConstraints,
      destinationConstraints: smartMoveAuthorization?.actionContext?.destinationConstraints,
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
    const postCommit = postMovementCommitView(gameState.matchIdentity?.gameSystem.id, aosMovementPhaseActive)
    setActiveTool(postCommit.activeTool)
    setContextPanel(aosCombat?.activeFight ? 'combat' : postCommit.contextPanel)
    if (gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar') {
      setAosMovementMessage('Movement confirmed.')
    } else {
      restartSmartMoveAfterApplyRef.current = true
    }
  }, [activeModels, aosCombat?.activeFight, aosMovementPhaseActive, cancelSmartMove, dispatch, gameState, smartMoveAuthorization, smartMovePolicy, smartMoveSession, smartMoveUnit])

  const changeTool = useCallback((tool: ActiveTool) => {
    if (tool === activeTool) {
      setContextPanel(tool === 'smart-move' ? 'smart-move' : 'inspector')
      return
    }
    if (lifecyclePlacement) {
      setLifecyclePlacement(null)
      setLifecyclePlacementPreviews([])
      setLifecycleMessage('Placement cancelled because the active tool changed.')
    }
    setVisibilityPickTarget(null)
    setVisibilityPickHoverModelId(null)
    if (tool === 'move' || tool === 'smart-move') {
      if (!movementToolsEnabled || !movementMethodEnabled) {
        setAosMovementMessage(movementMethodDisabledReason)
        if (aosMovementPhaseActive) setContextPanel('movement')
        return
      }
    }
    if (tool === 'smart-move') {
      if (gameState.movementSession) {
        setBlockedMovementSessionId(gameState.movementSession.id)
        return
      }
      const models = activeModels
        .filter((model) => selectedIds.has(model.id))
      const sortedModels = models.sort((a, b) => a.id.localeCompare(b.id))
      setActiveTool('smart-move')
      setContextPanel('smart-move')
      smartMoveControllerRef.current?.cancelSession()
      setSmartMoveTargeting(initialSmartMoveTargetState())
      beginSmartMoveForSelection(sortedModels, gameState, gameStateRevision)
      return
    }
    cancelSmartMove()
    setActiveTool(tool)
    setContextPanel('inspector')
    if (tool !== 'measure') setMeasurementStartTarget(null)
  }, [activeModels, activeTool, aosMovementPhaseActive, beginSmartMoveForSelection, cancelSmartMove, gameState, gameStateRevision, lifecyclePlacement, movementMethodDisabledReason, movementMethodEnabled, movementToolsEnabled, selectedIds])

  const toggleSpatialOverlay = useCallback(() => {
    if (!spatialEnabled) setSpatialEnabled(true)
    setContextPanel('spatial')
  }, [spatialEnabled])

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
        const latestOperation = gameState.committedOperations?.at(-1)
        if (canUndoLastMovement(gameState) || latestOperation?.type === 'GAME_SYSTEM') {
          dispatch({ type: 'history/undoLastCommitted' })
          setDeploymentPlacement(null)
          setLifecyclePlacement(null)
          setLifecyclePlacementPreviews([])
          setLifecycleMessage('Last committed operation undone.')
        }
        return
      }
      if (event.key === 'Enter' && gameState.movementSession && !event.isComposing) {
        event.preventDefault()
        const preview = reduceGameCommand(loadedRuntime, gameState, { type: 'movement/confirmed' })
        if (preview === gameState) {
          if (aosMovementPhaseActive) {
            setAosMovementMessage('Confirm rejected: check coherency, movement allowance, collisions, and enemy combat range.')
            setContextPanel('movement')
          }
          return
        }
        dispatch({ type: 'movement/confirmed' })
        if (aosMovementPhaseActive) {
          const postCommit = postMovementCommitView(gameState.matchIdentity?.gameSystem.id, aosMovementPhaseActive)
          setActiveTool(postCommit.activeTool)
          setAosMovementMessage('Movement confirmed.')
          setContextPanel(aosCombat?.activeFight ? 'combat' : postCommit.contextPanel)
        }
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
      if (event.key.toLowerCase() === 'd' && movementToolsEnabled) changeTool('move')
      if (event.key.toLowerCase() === 'm') changeTool('measure')
      if (event.key.toLowerCase() === 's') toggleSpatialOverlay()
      if (event.key.toLowerCase() === 'g' && movementToolsEnabled) changeTool('smart-move')
      if (event.key.toLowerCase() === 'f') setResetCameraSignal((value) => value + 1)
      if (event.key === 'Escape') {
        if (deploymentPlacement) {
          setDeploymentPlacement(null)
          return
        }
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
          if (aosMovementPhaseActive) {
            setAosMovementMessage('Movement cancelled. Any revealed roll remains available for this action.')
            setContextPanel('movement')
          }
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
  }, [activeTool, aosCombat?.activeFight, aosMovementPhaseActive, applySmartMove, cancelSmartMove, changeTool, deploymentPlacement, dispatch, gameState, lifecyclePlacement, loadedRuntime, measurementPair, measurementStartTarget, movementToolsEnabled, smartMoveAsync.canApply, smartMoveTargeting, toggleSpatialOverlay, visibilityPickTarget])

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
    .filter((model) => selectedIds.has(model.id)), [gameState.models, selectedIds])

  const setDevelopmentPresence = useCallback((presence: 'OFF_BOARD' | 'DESTROYED') => {
    const models = gameState.models.filter((model) => selectedIds.has(model.id))
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
  }, [cancelSmartMove, dispatchLifecycleAction, gameState.models, selectedIds, smartMoveSession, visibilityTargetId, visibilityViewerId])

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
    const unitIds = new Set(selectedLifecycleModels.map((model) => model.unitId))
    if (mode === 'formation' && unitIds.size !== 1) {
      setLifecycleMessage('Formation placement requires models from one unit; use individual placement for a mixed selection.')
      return
    }
    let initialPreset: FormationPresetId = 'compact'
    if (mode === 'formation') {
      const unit = gameState.units.find((candidate) => candidate.id === selectedLifecycleModels[0]?.unitId)
      const policy = unit ? getUnitCoherencyPolicy(gameState, unit)
        ?? { distance: 0.25, requiredNeighbors: 0, requireConnected: false } : undefined
      if (unit && policy) {
        const movingIds = new Set(selectedLifecycleModels.map((model) => model.id))
        const fixedModels = gameState.models.filter((model) => model.unitId === unit.id
          && !movingIds.has(model.id) && modelPresence(model) === 'ON_BATTLEFIELD')
        initialPreset = formationPresetCandidates({
          unit, movingModels: selectedLifecycleModels, fixedModels, policy, anchor: { x: 0, y: 0 },
        }).find((candidate) => candidate.available)?.id ?? 'compact'
      }
    }
    cancelSmartMove()
    setActiveTool('select')
    setSelectedIds(new Set())
    setSelectedFeatureId(null)
    setLifecyclePlacement({
      mode,
      modelIds: selectedLifecycleModels.map((model) => model.id).sort(),
      stagedPoses: {},
      formationPreset: initialPreset,
      formationAnchor: null,
      formationRotation: 0,
    })
    setLifecyclePlacementPreviews([])
    setLifecycleMessage(mode === 'formation'
      ? `Move the ${selectedLifecycleModels.length}-model formation, then click a legal position.`
      : `Place ${selectedLifecycleModels.length} model${selectedLifecycleModels.length === 1 ? '' : 's'} one at a time; nothing commits until the last model.`)
  }, [cancelSmartMove, gameState, selectedLifecycleModels])

  const placementsAtPoint = useCallback((position: { x: number; y: number }) => {
    if (!lifecyclePlacement) return null
    const models = lifecyclePlacement.modelIds.flatMap((modelId) => {
      const model = gameState.models.find((candidate) => candidate.id === modelId)
      return model ? [model] : []
    })
    if (models.length !== lifecyclePlacement.modelIds.length) return null
    if (lifecyclePlacement.mode === 'formation') {
      const unit = gameState.units.find((candidate) => candidate.id === models[0]?.unitId)
      const policy = unit ? getUnitCoherencyPolicy(gameState, unit)
        ?? { distance: 0.25, requiredNeighbors: 0, requireConnected: false } : undefined
      if (!unit || !policy) return null
      if (lifecyclePlacement.formationPreset === 'custom' && Object.keys(lifecyclePlacement.stagedPoses).length > 0) {
        const previousAnchor = lifecyclePlacement.formationAnchor ?? position
        const offset = { x: position.x - previousAnchor.x, y: position.y - previousAnchor.y }
        return Object.fromEntries(Object.entries(lifecyclePlacement.stagedPoses).map(([id, pose]) => [id, {
          ...pose, position: { x: pose.position.x + offset.x, y: pose.position.y + offset.y },
        }]))
      }
      const movingIds = new Set(lifecyclePlacement.modelIds)
      const fixedModels = gameState.models.filter((model) => model.unitId === unit.id
        && !movingIds.has(model.id) && modelPresence(model) === 'ON_BATTLEFIELD')
      return formationPresetCandidates({
        unit, movingModels: models, fixedModels, policy, anchor: position,
        rotation: lifecyclePlacement.formationRotation,
      }).find((candidate) => candidate.id === lifecyclePlacement.formationPreset)?.placements ?? null
    }
    const currentId = nextUnplacedModelId(lifecyclePlacement.modelIds, lifecyclePlacement.stagedPoses)
    const current = models.find((model) => model.id === currentId)
    if (!current) return null
    return { ...lifecyclePlacement.stagedPoses, [current.id]: { position, rotation: current.rotation } }
  }, [gameState, lifecyclePlacement])

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
    if (lifecyclePlacement.mode === 'formation') {
      setLifecyclePlacement((current) => current ? { ...current, stagedPoses: placements, formationAnchor: position } : current)
    }
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

  const deploymentValidation = useMemo(() => {
    if (!deploymentPlacement || Object.keys(deploymentPlacement.placements).length === 0) return null
    return validateAosDeploymentPlacements(gameState, deploymentPlacement.unitId, deploymentPlacement.placements)
  }, [deploymentPlacement, gameState])
  const deploymentFormationOptions = useMemo(() => {
    if (!deploymentPlacement) return []
    const unit = gameState.units.find((candidate) => candidate.id === deploymentPlacement.unitId)
    const policy = unit ? getUnitCoherencyPolicy(gameState, unit) : undefined
    if (!unit || !policy) return []
    const movingModels = unit.modelIds.flatMap((id) => {
      const model = gameState.models.find((candidate) => candidate.id === id)
      return model ? [model] : []
    })
    return formationPresetCandidates({
      unit, movingModels, policy,
      anchor: deploymentPlacement.formationAnchor ?? { x: 0, y: 0 },
      rotation: deploymentPlacement.formationRotation,
    })
  }, [deploymentPlacement, gameState])
  const deploymentPlacementView = useMemo<DeploymentPlacementView | null>(() => {
    if (!deploymentPlacement) return null
    return {
      ...deploymentPlacement,
      valid: deploymentValidation?.valid ?? false,
      reasons: [...new Set(deploymentValidation?.violations.map(describePlacementViolation) ?? [])],
      formationOptions: deploymentFormationOptions.map(({ id, label, available, reason }) => ({ id, label, available, reason })),
      formationValid: deploymentPlacement.formationPreset === 'custom'
        ? !deploymentValidation?.violations.some((violation) => violation.type === 'COHERENCY_FAILED')
        : Boolean(deploymentFormationOptions.find((option) => option.id === deploymentPlacement.formationPreset)?.available),
    }
  }, [deploymentFormationOptions, deploymentPlacement, deploymentValidation])
  const deploymentPlacementPreviews = useMemo(() => {
    if (!deploymentPlacement) return []
    return Object.entries(deploymentPlacement.placements).flatMap(([modelId, pose]) => {
      const model = gameState.models.find((candidate) => candidate.id === modelId)
      return model ? [{ model, pose, valid: deploymentValidation?.valid ?? false }] : []
    })
  }, [deploymentPlacement, deploymentValidation, gameState.models])
  const deploymentPlacementCoherency = useMemo(() => {
    if (!deploymentPlacement || Object.keys(deploymentPlacement.placements).length === 0) return []
    const unit = gameState.units.find((candidate) => candidate.id === deploymentPlacement.unitId)
    return unit ? derivePlacementCoherency(gameState, unit.modelIds, deploymentPlacement.placements, true) : []
  }, [deploymentPlacement, gameState])

  const beginDeploymentUnit = useCallback((unitId: string) => {
    const deployment = aosDeploymentState(gameState)
    const unit = gameState.units.find((candidate) => candidate.id === unitId)
    if (!deployment || deployment.phase !== 'DEPLOYING' || !unit
      || unit.ownerId !== deployment.currentPlayerId) return
    setActiveTool('select')
    setSelectedIds(new Set(unit.modelIds))
    const models = unit.modelIds.flatMap((id) => {
      const model = gameState.models.find((candidate) => candidate.id === id)
      return model ? [model] : []
    })
    const policy = getUnitCoherencyPolicy(gameState, unit)
    const initialPreset = policy ? formationPresetCandidates({
      unit, movingModels: models, policy, anchor: { x: 0, y: 0 },
    }).find((candidate) => candidate.available)?.id ?? 'compact' : 'compact'
    setDeploymentPlacement({
      unitId, placements: {}, locked: false, adjustingModelId: null, hoveredModelId: null,
      formationPreset: initialPreset, formationAnchor: null, formationRotation: 0,
    })
    setContextPanel('deployment')
  }, [gameState])

  const deploymentPlacementsAtPoint = useCallback((point: { x: number; y: number }) => {
    if (!deploymentPlacement) return null
    if (deploymentPlacement.adjustingModelId) {
      const model = gameState.models.find((candidate) => candidate.id === deploymentPlacement.adjustingModelId)
      if (!model) return null
      return {
        ...deploymentPlacement.placements,
        [model.id]: { position: point, rotation: deploymentPlacement.placements[model.id]?.rotation ?? model.rotation },
      }
    }
    if (deploymentPlacement.locked) return deploymentPlacement.placements
    const unit = gameState.units.find((candidate) => candidate.id === deploymentPlacement.unitId)
    const models = unit?.modelIds.flatMap((id) => {
      const model = gameState.models.find((candidate) => candidate.id === id)
      return model ? [model] : []
    }) ?? []
    const policy = unit ? getUnitCoherencyPolicy(gameState, unit) : undefined
    if (!unit || !policy || deploymentPlacement.formationPreset === 'custom') return deploymentPlacement.placements
    return formationPresetCandidates({
      unit, movingModels: models, policy, anchor: point, rotation: deploymentPlacement.formationRotation,
    }).find((candidate) => candidate.id === deploymentPlacement.formationPreset)?.placements ?? null
  }, [deploymentPlacement, gameState])

  const previewPlacement = useCallback((point: { x: number; y: number }) => {
    if (deploymentPlacement) {
      const placements = deploymentPlacementsAtPoint(point)
      if (!placements || (deploymentPlacement.locked && !deploymentPlacement.adjustingModelId)) return
      setDeploymentPlacement((current) => current ? {
        ...current, placements,
        formationAnchor: current.adjustingModelId ? current.formationAnchor : point,
      } : current)
      return
    }
    previewLifecyclePlacement(point)
  }, [deploymentPlacement, deploymentPlacementsAtPoint, previewLifecyclePlacement])

  const commitPlacementPointer = useCallback((point: { x: number; y: number }) => {
    if (deploymentPlacement) {
      const placements = deploymentPlacementsAtPoint(point)
      if (!placements) return
      setDeploymentPlacement({
        ...deploymentPlacement,
        placements,
        locked: true,
        adjustingModelId: null,
        formationAnchor: deploymentPlacement.adjustingModelId ? deploymentPlacement.formationAnchor : point,
        formationPreset: deploymentPlacement.adjustingModelId ? 'custom' : deploymentPlacement.formationPreset,
      })
      return
    }
    commitLifecyclePlacement(point)
  }, [commitLifecyclePlacement, deploymentPlacement, deploymentPlacementsAtPoint])

  const confirmDeploymentPlacement = useCallback(() => {
    const deployment = aosDeploymentState(gameState)
    if (!deploymentPlacement || !deploymentValidation?.valid || !deployment?.currentPlayerId) return
    dispatch({
      type: 'gameSystem/command',
      command: {
        type: 'aos/deployment/deploy-unit',
        actorPlayerId: deployment.currentPlayerId,
        payload: { unitId: deploymentPlacement.unitId, placements: deploymentPlacement.placements } as unknown as import('./domain/types').JsonValue,
      },
    })
    setSelectedIds(new Set(Object.keys(deploymentPlacement.placements)))
    setDeploymentPlacement(null)
  }, [deploymentPlacement, deploymentValidation, dispatch, gameState])

  const selectDeploymentFormationPreset = useCallback((preset: FormationPresetId) => {
    setDeploymentPlacement((current) => {
      if (!current) return current
      const option = deploymentFormationOptions.find((candidate) => candidate.id === preset)
      if (!option?.available) return current
      return { ...current, formationPreset: preset, placements: option.placements, adjustingModelId: null }
    })
  }, [deploymentFormationOptions])

  const rotateDeploymentFormation = useCallback((delta: number) => {
    setDeploymentPlacement((current) => {
      if (!current || !current.formationAnchor || Object.keys(current.placements).length === 0) return current
      const nextRotation = current.formationRotation + delta
      if (current.formationPreset === 'custom') return {
        ...current,
        formationRotation: nextRotation,
        placements: rotateFormationPlacements(current.placements, current.formationAnchor, delta),
      }
      const unit = gameState.units.find((candidate) => candidate.id === current.unitId)
      const policy = unit ? getUnitCoherencyPolicy(gameState, unit) : undefined
      if (!unit || !policy) return current
      const models = unit.modelIds.flatMap((id) => {
        const model = gameState.models.find((candidate) => candidate.id === id)
        return model ? [model] : []
      })
      const option = formationPresetCandidates({
        unit, movingModels: models, policy, anchor: current.formationAnchor, rotation: nextRotation,
      }).find((candidate) => candidate.id === current.formationPreset)
      return option?.available ? { ...current, formationRotation: nextRotation, placements: option.placements } : current
    })
  }, [gameState])

  const cycleDeploymentFormation = useCallback((direction: -1 | 1) => {
    if (!deploymentPlacement) return
    const available = deploymentFormationOptions.filter((option) => option.available)
    if (available.length === 0) return
    const currentIndex = available.findIndex((option) => option.id === deploymentPlacement.formationPreset)
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + available.length) % available.length
    selectDeploymentFormationPreset(available[nextIndex].id)
  }, [deploymentFormationOptions, deploymentPlacement, selectDeploymentFormationPreset])

  const updateDeploymentStagedModel = useCallback((modelId: string, point: { x: number; y: number }, commit: boolean) => {
    setDeploymentPlacement((current) => {
      const pose = current?.placements[modelId]
      if (!current || !pose) return current
      return {
        ...current,
        placements: { ...current.placements, [modelId]: { ...pose, position: point } },
        formationPreset: 'custom',
        adjustingModelId: commit ? null : modelId,
      }
    })
  }, [])

  const selectLifecycleFormationPreset = useCallback((preset: FormationPresetId) => {
    const option = lifecycleFormationOptions.find((candidate) => candidate.id === preset)
    if (!option?.available) return
    setLifecyclePlacement((current) => current ? {
      ...current, formationPreset: preset, stagedPoses: option.placements,
    } : current)
    setLifecyclePlacementPreviews(Object.entries(option.placements).flatMap(([modelId, pose]) => {
      const model = gameState.models.find((candidate) => candidate.id === modelId)
      return model ? [{ model, pose, valid: true }] : []
    }))
  }, [gameState.models, lifecycleFormationOptions])

  const rotateLifecycleFormation = useCallback((delta: number) => {
    setLifecyclePlacement((current) => {
      if (!current || current.mode !== 'formation' || !current.formationAnchor) return current
      const option = lifecycleFormationOptions.find((candidate) => candidate.id === current.formationPreset)
      if (!option?.available) return current
      const placements = rotateFormationPlacements(option.placements, current.formationAnchor, delta)
      setLifecyclePlacementPreviews(Object.entries(placements).flatMap(([modelId, pose]) => {
        const model = gameState.models.find((candidate) => candidate.id === modelId)
        return model ? [{ model, pose, valid: true }] : []
      }))
      return { ...current, formationRotation: current.formationRotation + delta, stagedPoses: placements }
    })
  }, [gameState.models, lifecycleFormationOptions])

  const cycleLifecycleFormation = useCallback((direction: -1 | 1) => {
    if (!lifecyclePlacement || lifecyclePlacement.mode !== 'formation') return
    const available = lifecycleFormationOptions.filter((option) => option.available)
    if (available.length === 0) return
    const currentIndex = available.findIndex((option) => option.id === lifecyclePlacement.formationPreset)
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + available.length) % available.length
    selectLifecycleFormationPreset(available[nextIndex].id)
  }, [lifecycleFormationOptions, lifecyclePlacement, selectLifecycleFormationPreset])

  useEffect(() => {
    if (!deploymentPlacement && lifecyclePlacement?.mode !== 'formation') return
    const onFormationShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) return
      const shortcut = formationShortcutForEvent(event)
      if (!shortcut) return
      event.preventDefault()
      if (shortcut === 'previous') {
        if (deploymentPlacement) cycleDeploymentFormation(-1)
        else cycleLifecycleFormation(-1)
      } else if (shortcut === 'next') {
        if (deploymentPlacement) cycleDeploymentFormation(1)
        else cycleLifecycleFormation(1)
      } else if (shortcut === 'rotate-left') {
        if (deploymentPlacement) rotateDeploymentFormation(-FORMATION_ROTATION_STEP)
        else rotateLifecycleFormation(-FORMATION_ROTATION_STEP)
      } else if (shortcut === 'rotate-right') {
        if (deploymentPlacement) rotateDeploymentFormation(FORMATION_ROTATION_STEP)
        else rotateLifecycleFormation(FORMATION_ROTATION_STEP)
      }
    }
    window.addEventListener('keydown', onFormationShortcut)
    return () => window.removeEventListener('keydown', onFormationShortcut)
  }, [cycleDeploymentFormation, cycleLifecycleFormation, deploymentPlacement, lifecyclePlacement, rotateDeploymentFormation, rotateLifecycleFormation])

  const placementActive = Boolean(lifecyclePlacement || deploymentPlacement)
  const placementPreviews = deploymentPlacement ? deploymentPlacementPreviews : lifecyclePlacementPreviews
  const placementCoherency = deploymentPlacement ? deploymentPlacementCoherency : lifecyclePlacementCoherency
  const deploymentPlacementRules = deploymentPlacement
    ? aosDeploymentPlacementRules(gameState, deploymentPlacement.unitId) : null

  const toggleLifecyclePanel = useCallback(() => {
    if (!lifecycleOpen) {
      setLifecycleOpen(true)
      setLifecycleMessage(null)
    }
    setContextPanel('lifecycle')
  }, [lifecycleOpen])

  const dispatchAosBattleCommand = useCallback((type: string, actorPlayerId: string, payload?: JsonValue) => {
    dispatch({ type: 'gameSystem/command', command: { type, actorPlayerId, payload } })
  }, [dispatch])

  const chooseAosMovementAction = useCallback((actionId: AosMovementActionId) => {
    if (!selectedUnit || !selectedAosMovement?.available.includes(actionId)) return
    let rollRecordId: string | undefined
    if (actionId === 'RUN' || actionId === 'RETREAT' || actionId === 'CHARGE') {
      const existing = aosMovementRevealedRoll(gameState, selectedUnit.id, actionId)
      if (existing) rollRecordId = existing.rollRecordId
      else {
        const roll = actionId === 'CHARGE' ? rollAosCharge() : rollAosMovementActionDie(actionId)
        rollRecordId = `dice-${gameState.nextActionSequence}`
        dispatch({
          type: 'dice/rollRecorded',
          playerId: selectedUnit.ownerId,
          result: roll,
          label: `${actionId === 'RUN' ? 'Run' : actionId === 'CHARGE' ? 'Charge' : 'Retreat Damage'} — ${selectedUnitDefinition?.name ?? selectedUnit.id}`,
        })
      }
    }
    dispatchAosBattleCommand('aos/movement/declare', selectedUnit.ownerId, {
      unitId: selectedUnit.id,
      actionId,
      ...(rollRecordId ? { rollRecordId } : {}),
      ...(actionId === 'PILE_IN' && selectedAosMovement.inCombat && selectedAosMovement.eligibleTargetUnitIds?.[0]
        ? { targetUnitId: selectedAosMovement.eligibleTargetUnitIds[0] } : {}),
    })
    setAosMovementMessage(actionId === 'NORMAL_MOVE'
      ? 'Normal Move ready. Drag models or use Smart Move.'
      : actionId === 'RUN' ? 'Run roll recorded. Drag models or use Smart Move.'
        : actionId === 'RETREAT' ? 'Retreat damage recorded. Damage allocation is deferred; movement is ready.'
          : actionId === 'CHARGE' ? 'Charge roll recorded. Finish within ½″ of a visible enemy.'
            : selectedAosMovement.inCombat ? 'Choose an enemy pile-in target, then move up to 3″.' : 'Pile-in ready: move up to 3″ in any direction.')
    setContextPanel('movement')
  }, [dispatch, dispatchAosBattleCommand, gameState, selectedAosMovement, selectedUnit, selectedUnitDefinition])

  const startAosFight = useCallback(() => {
    if (!combatDisplayUnit) return
    setCombatProfileFocus(null)
    setCombatDiceReview(null)
    setRevealedCombatDiceStage(0)
    setSelectedCasualtyModelId(null)
    dispatchAosBattleCommand('aos/combat/start-fight', combatDisplayUnit.ownerId, { unitId: combatDisplayUnit.id })
    setActiveTool('select')
    setContextPanel('combat')
  }, [combatDisplayUnit, dispatchAosBattleCommand])

  const beginAosPileIn = useCallback(() => {
    if (!combatDisplayUnit) return
    const availability = aosMovementAvailability(gameState, combatDisplayUnit.id)
    if (!availability.available.includes('PILE_IN')) return
    dispatchAosBattleCommand('aos/movement/declare', combatDisplayUnit.ownerId, {
      unitId: combatDisplayUnit.id,
      actionId: 'PILE_IN',
      ...(availability.inCombat && availability.eligibleTargetUnitIds?.[0]
        ? { targetUnitId: availability.eligibleTargetUnitIds[0] } : {}),
    })
    setContextPanel('movement')
  }, [combatDisplayUnit, dispatchAosBattleCommand, gameState])

  const completeAosPileIn = useCallback(() => {
    if (!aosCombat?.activeFight) return
    dispatchAosBattleCommand('aos/combat/pile-in-complete', aosCombat.activeFight.playerId)
    setActiveTool('select')
    setContextPanel('combat')
  }, [aosCombat, dispatchAosBattleCommand])

  const declareAosAttacks = useCallback((allocations: AosDeclaredAttack[]) => {
    const fight = aosCombat?.activeFight
    if (!fight) return
    dispatchAosBattleCommand('aos/combat/declare-attacks', fight.playerId, { allocations } as unknown as JsonValue)
    setContextPanel('combat')
  }, [aosCombat?.activeFight, dispatchAosBattleCommand])

  const resolveAosAttacks = useCallback((profileId: string, targetUnitId: string) => {
    const fight = aosCombat?.activeFight
    const attacker = fight ? gameState.units.find((unit) => unit.id === fight.unitId) : undefined
    const target = gameState.units.find((unit) => unit.id === targetUnitId)
    const attackerProfile = attacker ? aosUnitProfile(gameState, attacker) : undefined
    const targetProfile = target ? aosUnitProfile(gameState, target) : undefined
    const weapon = attackerProfile?.weapons.find((candidate) => candidate.id === profileId)
    const attacks = fight && weapon ? aosAttackCountForTarget(gameState, fight.unitId, profileId, targetUnitId) : 0
    if (!fight || !attacker || !target || !weapon || !targetProfile || attacks < 1) return
    let nextSequence = gameState.nextActionSequence
    const definition = aosAttackSequenceDefinition({
      id: `aos:${gameState.gameContext.turnId}:${attacker.id}:${profileId}:${target.id}`,
      attacks, weapon, target: targetProfile,
    })
    const resolution = resolveDiceSequence(definition, systemRandomSource, aosAttackSequenceModifiers(weapon))
    const sequenceRecordId = `dice-sequence-${nextSequence++}`
    dispatch({ type: 'dice/sequenceRecorded', playerId: attacker.ownerId, resolution })
    const save = resolution.stageResults.find((stage) => stage.stage.id === 'save')
    const wound = resolution.stageResults.find((stage) => stage.stage.id === 'wound')
    const unsaved = save?.continuationCount ?? wound?.continuationCount ?? 0
    const criticalMortalHits = weapon.abilities?.includes('Crit (Mortal)')
      ? resolution.stageResults[0]?.roll.finalResults.filter((value) => value === 6).length ?? 0 : 0
    let randomDamageRecordId: string | undefined
    let randomDamageResult: DicePoolResult | undefined
    let normalDamage = unsaved * (Number(weapon.damage) || 0)
    if (weapon.damage === 'D3') {
      const damageRoll = rollDice({ count: unsaved, sides: 3 }, systemRandomSource)
      randomDamageResult = damageRoll
      randomDamageRecordId = `dice-${nextSequence++}`
      normalDamage = damageRoll.total
      dispatch({ type: 'dice/rollRecorded', playerId: attacker.ownerId, result: damageRoll,
        label: `${weapon.name} damage` })
    }
    const grossDamage = normalDamage + criticalMortalHits * (Number(weapon.damage) || 0)
    let wardRecordId: string | undefined
    let wardResult: DicePoolResult | undefined
    if (targetProfile.ward && grossDamage > 0) {
      const ward = rollDice({ count: grossDamage, sides: 6, successThreshold: targetProfile.ward }, systemRandomSource)
      wardResult = ward
      wardRecordId = `dice-${nextSequence}`
      dispatch({ type: 'dice/rollRecorded', playerId: target.ownerId, result: ward,
        label: `Ward — ${getUnitDefinition(gameState, target)?.name ?? target.id}` })
    }
    dispatchAosBattleCommand('aos/combat/resolve-attacks', attacker.ownerId, {
      profileId, targetUnitId, sequenceRecordId,
      ...(randomDamageRecordId ? { randomDamageRecordId } : {}),
      ...(wardRecordId ? { wardRecordId } : {}),
    })
    setCombatDiceReview({
      attackerUnitId: attacker.id,
      profileId,
      targetUnitId,
      sequenceRecordId,
      resolution,
      ...(save ? { thresholdContext: { save: {
        baseThreshold: targetProfile.save,
        effectiveThreshold: save.effectiveThreshold,
        modifierLabel: `Rend ${weapon.rend}`,
      } } } : {}),
      ...(wardResult ? { ward: wardResult } : {}),
      ...(randomDamageResult ? { damage: randomDamageResult } : {}),
    })
    setRevealedCombatDiceStage(0)
    setSelectedCasualtyModelId(null)
    setContextPanel('combat')
  }, [aosCombat?.activeFight, dispatch, dispatchAosBattleCommand, gameState])

  const allocateAosDamage = useCallback((modelId: string | null) => {
    const pending = aosCombat?.activeFight?.pendingDamage
    const target = pending ? gameState.units.find((unit) => unit.id === pending.targetUnitId) : undefined
    if (!target) return
    dispatchAosBattleCommand('aos/combat/allocate-damage', target.ownerId, modelId ? { modelId } : {})
    setSelectedCasualtyModelId(null)
    setActiveTool('select')
    setContextPanel('combat')
  }, [aosCombat?.activeFight?.pendingDamage, dispatchAosBattleCommand, gameState.units])

  const chooseAosCasualtyModel = useCallback((modelId: string) => {
    const pending = aosCombat?.activeFight?.pendingDamage
    const target = pending ? gameState.units.find((unit) => unit.id === pending.targetUnitId) : undefined
    const health = target ? aosUnitProfile(gameState, target)?.health : undefined
    if (!pending || !target || !health || !combatCasualtyCandidates.includes(modelId)) return
    setSelectedCasualtyModelId(modelId)
    allocateAosDamage(modelId)
  }, [allocateAosDamage, aosCombat?.activeFight?.pendingDamage, combatCasualtyCandidates, gameState])

  const spendAosCommandPoint = useCallback((playerId: string) => {
    dispatchAosBattleCommand('aos/resources/spend-command-points', playerId, { amount: 1 })
  }, [dispatchAosBattleCommand])

  const spendAosRageDie = useCallback((playerId: string) => {
    dispatchAosBattleCommand('aos/resources/spend-rage-dice', playerId, { amount: 1 })
  }, [dispatchAosBattleCommand])

  const startAosBattle = useCallback(() => {
    dispatchAosBattleCommand('aos/battle/start', gameState.players[0]?.id ?? '')
    setContextPanel('battle-round')
  }, [dispatchAosBattleCommand, gameState.players])

  const rollAosPriority = useCallback(() => {
    if (!aosBattle || aosBattle.stage !== 'PRIORITY_ROLL' || gameState.players.length !== 2) return
    const results: Record<string, number> = {}
    for (const player of gameState.players) {
      const roll = rollDice({ count: 1, sides: 6 }, systemRandomSource)
      results[player.id] = roll.finalResults[0]
      dispatch({ type: 'dice/rollRecorded', playerId: player.id, result: roll })
    }
    dispatchAosBattleCommand('aos/battle/priority-rolled', gameState.players[0].id, results as unknown as JsonValue)
    setContextPanel('battle-round')
  }, [aosBattle, dispatch, dispatchAosBattleCommand, gameState.players])

  const chooseAosFirstPlayer = useCallback((firstPlayerId: string) => {
    if (!aosBattle?.chooserPlayerId) return
    dispatchAosBattleCommand('aos/battle/choose-first-player', aosBattle.chooserPlayerId, { firstPlayerId })
    setContextPanel('battle-round')
  }, [aosBattle, dispatchAosBattleCommand])

  const continueAosBattle = useCallback(() => {
    dispatchAosBattleCommand('aos/battle/continue', gameState.gameContext.activePlayerId)
    setContextPanel('battle-round')
  }, [dispatchAosBattleCommand, gameState.gameContext.activePlayerId])

  const endAosPhase = useCallback(() => {
    if (gameState.movementSession) {
      setBlockedMovementSessionId(gameState.movementSession.id)
      setAosMovementMessage('Confirm or cancel the staged movement before ending the phase.')
      setContextPanel('movement')
      return
    }
    if (spatialPreviewResult) {
      setSmartMoveMessage('Apply or cancel the Smart Move preview before ending the phase.')
      setContextPanel('smart-move')
      return
    }
    if (aosCombatPhaseActive && aosData && hasUnresolvedRequiredAosFights(gameState, aosData)) {
      setContextPanel(combatDisplayUnit ? 'combat' : 'battle-round')
      return
    }
    dispatchAosBattleCommand('aos/battle/end-phase', gameState.gameContext.activePlayerId)
    setContextPanel('battle-round')
  }, [aosCombatPhaseActive, aosData, combatDisplayUnit, dispatchAosBattleCommand, gameState, spatialPreviewResult])

  const phaseProgressionBlockReason = aosPhaseProgressionBlockReason(
    Boolean(gameState.movementSession),
    Boolean(spatialPreviewResult),
    Boolean(aosCombat?.activeFight) || Boolean(aosCombatPhaseActive && aosData && hasUnresolvedRequiredAosFights(gameState, aosData)),
  )

  const aosProgression = useMemo(() => {
    if (!aosDeployment || aosDeployment.phase !== 'READY_FOR_BATTLE') return undefined
    if (!aosBattle) return {
      lifecycle: 'READY FOR BATTLE', title: 'Deployment complete',
      detail: 'Round 1 uses deployment completion order — no priority roll.',
      actionLabel: 'Start Battle Round 1', onAction: startAosBattle,
    }
    const phase = currentAosPhase(aosBattle)
    const active = gameState.players.find((player) => player.id === gameState.gameContext.activePlayerId)?.displayName
      ?? gameState.gameContext.activePlayerId
    if (aosBattle.stage === 'FIRST_PLAYER_CHOICE') return {
      lifecycle: 'ROUND 1', title: 'Choose first player', actionLabel: 'Choose First Player',
      detail: `${active} finished deployment first.`, onAction: () => setContextPanel('battle-round'),
    }
    if (aosBattle.stage === 'PRIORITY_ROLL') return {
      lifecycle: `ROUND ${aosBattle.round}`, title: 'Priority', actionLabel: 'Roll Priority',
      detail: 'Roll one D6 for each player.', onAction: rollAosPriority,
    }
    if (aosBattle.stage === 'PRIORITY_CHOICE') return {
      lifecycle: `ROUND ${aosBattle.round}`, title: 'Choose first player', actionLabel: 'Choose First Player',
      detail: `${active} has the choice.`, onAction: () => setContextPanel('battle-round'),
    }
    if (aosBattle.stage === 'START_OF_ROUND') return {
      lifecycle: `ROUND ${aosBattle.round}`, title: 'Start of Battle Round', actionLabel: 'Continue',
      detail: `${active} takes the first turn.`, onAction: continueAosBattle,
    }
    if (aosBattle.stage === 'TURN_PHASE' && phase) return {
      lifecycle: `ROUND ${aosBattle.round} · TURN ${(aosBattle.turnIndex ?? 0) + 1}`,
      title: `${active} · ${phase.name}`,
      actionLabel: phase.id === 'END_OF_TURN' ? 'End Turn' : `End ${phase.name}`,
      onAction: endAosPhase,
      ...(phaseProgressionBlockReason
        ? { detail: phaseProgressionBlockReason, disabled: true }
        : {}),
    }
    if (aosBattle.stage === 'END_OF_ROUND') return {
      lifecycle: `ROUND ${aosBattle.round}`, title: 'End of Battle Round', actionLabel: 'Continue',
      detail: 'Future end-of-round abilities will resolve here.', onAction: continueAosBattle,
    }
    return {
      lifecycle: 'BATTLE COMPLETE', title: 'Final resolution pending', actionLabel: 'Battle Complete',
      detail: 'Final scoring and winner resolution are not implemented yet.', disabled: true,
    }
  }, [aosBattle, aosDeployment, continueAosBattle, endAosPhase, gameState.gameContext.activePlayerId, gameState.players, phaseProgressionBlockReason, rollAosPriority, startAosBattle])

  const aosRuntimeFacts = useMemo(() => {
    if (!aosDeployment) return []
    const playerName = (id?: string) => gameState.players.find((player) => player.id === id)?.displayName ?? id ?? '—'
    return [
      { label: 'Attacker', value: playerName(aosDeployment.attackerPlayerId) },
      { label: 'Defender', value: playerName(aosDeployment.defenderPlayerId) },
      ...(aosBattle ? [
        { label: 'Battle Round', value: String(aosBattle.round) },
        { label: 'Active Player', value: playerName(gameState.gameContext.activePlayerId) },
        { label: 'Current Timing', value: currentAosPhase(aosBattle)?.name ?? gameState.gameContext.phase ?? aosBattle.stage },
        { label: 'First Player', value: playerName(aosBattle.firstPlayerId) },
        { label: 'Underdog', value: playerName(aosBattle.underdogPlayerId) },
      ] : []),
    ]
  }, [aosBattle, aosDeployment, gameState.gameContext.activePlayerId, gameState.gameContext.phase, gameState.players])

  const aosHeaderMetrics = useMemo(() => aosResources ? Object.fromEntries(gameState.players.map((player) => {
    const resources = aosResources.byPlayerId[player.id]
    return [player.id, resources ? [
      { label: 'CP', value: resources.commandPoints },
      { label: 'Fury', value: resources.fury },
    ] : []]
  })) : undefined, [aosResources, gameState.players])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">FIELDCRAFT</div>
          <div className="brand-subtitle">COMPETITIVE TABLETOP LAB</div>
        </div>
        <MatchIdentityHeader gameSystemName={loadedRuntime.gameSystem.name}
          matchName={gameState.matchIdentity?.matchName} ui={gameSystemRegistration.ui} />
        {showGenericGameStatus ? <GameStatusPanel
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
        /> : <GameSystemStatusPanel ui={gameSystemRegistration.ui} gameState={gameState}
          playerMetrics={aosHeaderMetrics}
          progression={aosProgression}
          onPrepare={gameSystemRegistration.prepareMatch
            ? () => onReplaceState(gameSystemRegistration.prepareMatch!(gameState))
            : undefined}
          onOpenDeployment={aosDeployment && !aosBattle ? () => setContextPanel('deployment') : undefined} />}
        <MatchControls
          notice={matchNotice?.message}
          error={matchNotice?.error}
          onNewMatch={onNewMatch}
          onSave={() => onSave(gameState)}
          onLoad={onLoad}
          onSaveAs={() => onSaveAs(gameState)}
          matchName={gameState.matchIdentity?.matchName}
          gameSystemName={loadedRuntime.gameSystem.name}
          missionName={gameSystemRegistration.ui.shell?.missionName}
          onMatchInfo={() => setContextPanel('match-info')}
        />
      </header>
      <Toolbar
        activeTool={activeTool}
        spatialEnabled={spatialEnabled}
        diceOpen={diceOpen}
        lifecycleOpen={lifecycleOpen}
        gameplayToolsEnabled={movementToolsEnabled}
        moveEnabled={movementMethodEnabled}
        moveDisabledReason={movementMethodDisabledReason}
        smartMoveEnabled={movementMethodEnabled}
        smartMoveDisabledReason={movementMethodDisabledReason}
        diceEnabled={(capabilities?.dice ?? gameplayImplemented)
          && gameState.matchLifecycle !== 'SETUP'}
        lifecycleEnabled={lifecycleAvailable}
        spatialPanelOpen={contextPanel === 'spatial'}
        dicePanelOpen={contextPanel === 'dice'}
        lifecyclePanelOpen={contextPanel === 'lifecycle'}
        onToolChange={changeTool}
        onSpatialToggle={toggleSpatialOverlay}
        onDiceToggle={() => { setDiceOpen(true); setContextPanel('dice') }}
        onLifecycleToggle={toggleLifecyclePanel}
        onResetCamera={() => setResetCameraSignal((value) => value + 1)}
      />
      <section className="workspace">
        <div className="battlefield-region">
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
          lifecyclePlacementActive={placementActive}
          lifecyclePlacementPreviews={placementPreviews}
          lifecyclePlacementCoherency={boardOverlays.automaticRuleAssistance ? placementCoherency : []}
          unitPresentations={unitBattlefieldPresentations}
          actionFocus={actionFocus}
          modelMarkers={combatModelMarkers}
          hoveredModelId={battlefieldHoveredModelId}
          boardOverlays={boardOverlays}
          developmentPresentation={developmentControlsEnabled}
          showDeploymentZones={showDeploymentZones}
          movementRuleAssistance={movementRuleAssistance}
          movementDestinationAssistance={movementDestinationAssistance}
          fightActive={Boolean(aosCombat?.activeFight)}
          fightRangeAssistance={combatPresentationFocus ? {
            targetModelIds: combatPresentationFocus.targetModelIds,
            distance: combatPresentationFocus.attackRange,
          } : null}
          deploymentZoneHighlightRole={aosDeployment?.phase === 'DEPLOYING'
            ? aosDeployment.currentPlayerId === aosDeployment.attackerPlayerId ? 'attacker' : 'defender'
            : undefined}
          deploymentZoneChoiceId={aosDeployment?.phase === 'CHOOSE_TERRITORY' ? deploymentTerritoryHoverId : null}
          deploymentForbiddenRegion={boardOverlays.automaticRuleAssistance && deploymentPlacementRules ? {
            areas: deploymentPlacementRules.enemyAreas,
            distance: deploymentPlacementRules.enemyTerritoryExclusionDistance,
          } : null}
          placementHoveredModelId={deploymentPlacement?.hoveredModelId}
          resetCameraSignal={resetCameraSignal}
          movementPolicy={movementPolicy}
          onSelectionChange={handleSelectionChange}
          onFeatureSelectionChange={handleFeatureSelectionChange}
          onMeasureTarget={handleMeasureTarget}
          onSmartMoveTargetPreview={previewSmartMoveTarget}
          onSmartMoveTargetLock={lockSmartMoveTarget}
          onVisibilityPickModel={handleVisibilityPickModel}
          onVisibilityPickHover={setVisibilityPickHoverModelId}
          onLifecyclePlacementPreview={previewPlacement}
          onLifecyclePlacementCommit={commitPlacementPointer}
          onPlacementModelHover={deploymentPlacement ? (modelId) => setDeploymentPlacement((current) => current
            ? { ...current, hoveredModelId: modelId } : current) : undefined}
          onPlacementModelDrag={deploymentPlacement?.locked ? updateDeploymentStagedModel : undefined}
          onModelHover={setBattlefieldHoveredModelId}
          onCasualtyModelClick={chooseAosCasualtyModel}
            dispatch={dispatch}
          />
          {developmentControlsEnabled && (footprintDemoEnabled || orientationGapEnabled) && (
            <MovementCostPolicyPanel
              policy={movementPolicy}
              disabled={Boolean(gameState.movementSession)}
              onChange={setMovementPolicy}
            />
          )}
        </div>
        <aside className="context-panel-region" aria-label="Context panel">
          {aosDeployment && !aosBattle && (
            <div className={`context-panel-view ${contextPanel === 'deployment' ? '' : 'hidden'}`}>
              <DeploymentPanel
                state={gameState}
                deployment={aosDeployment}
                playerLabels={gameSystemRegistration.ui.matchInfo?.playerLabels}
                placement={deploymentPlacementView}
                onRollOff={() => {
                  const player1Roll = rollDice({ count: 1, sides: 6 }, systemRandomSource)
                  const player2Roll = rollDice({ count: 1, sides: 6 }, systemRandomSource)
                  const player1 = player1Roll.finalResults[0]
                  const player2 = player2Roll.finalResults[0]
                  if (gameState.players[0]) dispatch({ type: 'dice/rollRecorded', playerId: gameState.players[0].id, result: player1Roll })
                  if (gameState.players[1]) dispatch({ type: 'dice/rollRecorded', playerId: gameState.players[1].id, result: player2Roll })
                  dispatch({ type: 'gameSystem/command', command: {
                    type: 'aos/deployment/roll-off', actorPlayerId: gameState.players[0]?.id ?? '',
                    payload: { player1, player2 },
                  } })
                }}
                onChooseAttacker={(attackerPlayerId) => dispatch({ type: 'gameSystem/command', command: {
                  type: 'aos/deployment/choose-attacker', actorPlayerId: aosDeployment.rollWinnerPlayerId ?? '',
                  payload: { attackerPlayerId },
                } })}
                onChooseTerritory={(zoneId) => dispatch({ type: 'gameSystem/command', command: {
                  type: 'aos/deployment/choose-territory', actorPlayerId: aosDeployment.attackerPlayerId ?? '',
                  payload: { zoneId },
                } })}
                onHoverTerritory={setDeploymentTerritoryHoverId}
                onBeginUnit={beginDeploymentUnit}
                onConfirmPlacement={confirmDeploymentPlacement}
                onCancelPlacement={() => setDeploymentPlacement(null)}
                onAdjustModel={(modelId) => setDeploymentPlacement((current) => current
                  ? { ...current, adjustingModelId: modelId, formationPreset: 'custom' } : current)}
                onHoverModel={(modelId) => setDeploymentPlacement((current) => current
                  ? { ...current, hoveredModelId: modelId } : current)}
                onSelectFormationPreset={selectDeploymentFormationPreset}
                onRotateFormation={rotateDeploymentFormation}
                onCycleFormation={cycleDeploymentFormation}
                onMoveFormation={() => setDeploymentPlacement((current) => current
                  ? { ...current, locked: false, adjustingModelId: null } : current)}
                onUndo={gameState.lastCommittedOperationUndo
                  && gameState.committedOperations?.at(-1)?.type === 'GAME_SYSTEM'
                  ? () => {
                      setDeploymentPlacement(null)
                      dispatch({ type: 'history/undoLastCommitted' })
                    }
                  : undefined}
              />
            </div>
          )}
          {aosDeployment && (aosBattle || aosDeployment.phase === 'READY_FOR_BATTLE') && (
            <div className={`context-panel-view ${contextPanel === 'battle-round' ? '' : 'hidden'}`}>
              <AosBattleRoundPanel
                state={gameState}
                deployment={aosDeployment}
                battle={aosBattle}
                onClose={() => setContextPanel('inspector')}
                onStart={startAosBattle}
                onRollPriority={rollAosPriority}
                onChooseFirstPlayer={chooseAosFirstPlayer}
                onContinue={continueAosBattle}
                onEndPhase={endAosPhase}
                onSpendCommandPoint={spendAosCommandPoint}
                onSpendRageDie={spendAosRageDie}
              />
            </div>
          )}
          <div className={`context-panel-view ${contextPanel === 'inspector' ? '' : 'hidden'}`}>
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
          health={selectedUnit ? aosUnitProfile(gameState, selectedUnit)?.health : undefined}
          allocatedDamage={selectedUnit ? aosUnitAllocatedDamage(gameState, selectedUnit.id) : undefined}
          fought={aosCombatPhaseActive && selectedUnit ? Boolean(aosCombat?.foughtUnitIds.includes(selectedUnit.id)) : undefined}
          coherencyPolicy={selectedUnitPolicy}
          coherency={selectedUnitCoherency}
              coherencyValid={selectedUnitPolicy && selectedUnitCoherency
                ? isCoherencyResultValid(selectedUnitCoherency, selectedUnitPolicy)
                : undefined}
            />
          </div>
          {lifecycleAvailable && lifecycleOpen && (
            <div className={`context-panel-view ${contextPanel === 'lifecycle' ? '' : 'hidden'}`}>
              <LifecyclePanel
            entries={lifecycleEntries}
            selectedIds={selectedIds}
            placement={lifecyclePlacement ? {
              mode: lifecyclePlacement.mode,
              placedCount: Object.keys(lifecyclePlacement.stagedPoses).length,
              totalCount: lifecyclePlacement.modelIds.length,
              coherency: lifecyclePlacementCoherency.map((preview) => ({
                coherent: preview.result.coherent,
                componentCount: preview.result.componentCount,
              })),
              formationPreset: lifecyclePlacement.formationPreset,
              formationRotation: lifecyclePlacement.formationRotation,
              formationOptions: lifecycleFormationOptions.map(({ id, label, available, reason }) => ({ id, label, available, reason })),
            } : null}
            requireCoherency={lifecycleRequireCoherency}
            readOnly={!(capabilities?.scoring ?? gameplayImplemented)}
            message={lifecycleMessage ?? undefined}
            onClose={() => setContextPanel('inspector')}
            onInspect={(modelId) => handleSelectionChange(new Set([modelId]))}
            onToggleModel={(modelId) => {
              const next = new Set(selectedIds)
              if (next.has(modelId)) next.delete(modelId)
              else next.add(modelId)
              handleSelectionChange(next)
            }}
            onSelectModels={(modelIds) => handleSelectionChange(new Set(modelIds))}
            onClearSelection={() => handleSelectionChange(new Set())}
            onMoveOffBoard={() => setDevelopmentPresence('OFF_BOARD')}
            onDestroy={() => setDevelopmentPresence('DESTROYED')}
            onPlaceIndividually={() => beginLifecyclePlacement('individual')}
            onPlaceFormation={() => beginLifecyclePlacement('formation')}
            onCancelPlacement={cancelLifecyclePlacement}
            onRequireCoherencyChange={setLifecycleRequireCoherency}
            onFormationPresetChange={selectLifecycleFormationPreset}
            onFormationRotate={rotateLifecycleFormation}
              />
            </div>
          )}
          {(spatialEnabled || contextPanel === 'spatial') && (
            <div className={`context-panel-view ${contextPanel === 'spatial' ? '' : 'hidden'}`}>
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
            boardOverlays={boardOverlays}
            deploymentActive={deploymentActive}
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
                onBoardOverlayChange={(key, enabled) => setBoardOverlays((current) => ({
                  ...current,
                  [key]: enabled,
                }))}
                onClosePanel={() => setContextPanel('inspector')}
                onDisableOverlay={() => {
                  setSpatialEnabled(false)
                  setVisibilityPickTarget(null)
                  setVisibilityPickHoverModelId(null)
                  setContextPanel('inspector')
                }}
              />
            </div>
          )}
          {movementToolsEnabled && movementSummary && gameState.matchIdentity?.gameSystem.id !== 'age-of-sigmar' && (
            <div className={`context-panel-view ${contextPanel === 'movement' ? '' : 'hidden'}`}>
              <MovementPanel
                summary={movementSummary}
                onConfirm={() => dispatch({ type: 'movement/confirmed' })}
                onCancel={() => dispatch({ type: 'movement/cancelled' })}
              />
            </div>
          )}
          {gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar' && selectedUnit
            && selectedUnitDefinition && selectedAosMovement && aosMovementPhaseActive && (
            <div className={`context-panel-view ${contextPanel === 'movement' ? '' : 'hidden'}`}>
              <AosMovementPanel
                unitName={selectedUnitDefinition.name}
                moveCharacteristic={selectedUnitDefinition.movementAllowance}
                availability={selectedAosMovement}
                summary={movementSummary}
                status={aosUnitMovementStatus(gameState, selectedUnit.id)}
                activeMethod={(activeTool === 'move' ? 'manual'
                  : activeTool === 'smart-move' ? 'smart' : null) satisfies AosMovementMethod | null}
                message={aosMovementMessage ?? undefined}
                targetUnits={(selectedAosMovement.eligibleTargetUnitIds ?? []).map((id) => {
                  const unit = gameState.units.find((candidate) => candidate.id === id)
                  return { id, name: unit ? getUnitDefinition(gameState, unit)?.name ?? id : id }
                })}
                onTargetUnitChange={(targetUnitId) => {
                  if (!selectedUnit || !targetUnitId) return
                  dispatchAosBattleCommand('aos/movement/declare', selectedUnit.ownerId, {
                    unitId: selectedUnit.id, actionId: 'PILE_IN', targetUnitId,
                  })
                }}
                onChoose={chooseAosMovementAction}
                onMethodChange={(method) => changeTool(method === 'manual' ? 'move' : 'smart-move')}
                onConfirm={() => {
                  const preview = reduceGameCommand(loadedRuntime, gameState, { type: 'movement/confirmed' })
                  if (preview === gameState) {
                    setAosMovementMessage('Confirm rejected: check coherency, movement allowance, collisions, and enemy combat range.')
                    return
                  }
                  dispatch({ type: 'movement/confirmed' })
                  const postCommit = postMovementCommitView(gameState.matchIdentity?.gameSystem.id, aosMovementPhaseActive)
                  setActiveTool(postCommit.activeTool)
                  setAosMovementMessage('Movement confirmed.')
                  setContextPanel(aosCombat?.activeFight ? 'combat' : postCommit.contextPanel)
                }}
                onCancel={() => {
                  dispatch({ type: 'movement/cancelled' })
                  setAosMovementMessage('Movement cancelled. The revealed roll remains available for this action.')
                  setContextPanel('movement')
                }}
                onClose={() => setContextPanel('inspector')}
              />
            </div>
          )}
          {gameState.matchIdentity?.gameSystem.id === 'age-of-sigmar' && aosCombatPhaseActive
            && combatDisplayUnit && combatDisplayDefinition && selectedFightAvailability && (
            <div className={`context-panel-view ${contextPanel === 'combat' ? '' : 'hidden'}`}>
              <AosCombatPanel
                unitName={combatDisplayDefinition.name}
                playerName={gameState.players.find((player) => player.id === combatDisplayUnit.ownerId)?.displayName ?? combatDisplayUnit.ownerId}
                availability={selectedFightAvailability}
                unitDamage={aosUnitDamagePresentation(gameState, combatDisplayUnit.id)}
                fight={aosCombat?.activeFight}
                profiles={combatProfileOptions}
                targetNames={Object.fromEntries(gameState.units.map((unit) => [unit.id, getUnitDefinition(gameState, unit)?.name ?? unit.id]))}
                allocatedDamage={aosCombat?.activeFight?.pendingDamage
                  ? aosUnitAllocatedDamage(gameState, aosCombat.activeFight.pendingDamage.targetUnitId) : 0}
                targetHealth={aosCombat?.activeFight?.pendingDamage
                  ? (() => {
                      const target = gameState.units.find((unit) => unit.id === aosCombat.activeFight?.pendingDamage?.targetUnitId)
                      return target ? aosUnitProfile(gameState, target)?.health : undefined
                    })() : undefined}
                allocationOptions={combatAllocationOptions}
                casualtyCandidateModelIds={combatDiceStepping ? [] : combatCasualtyCandidates}
                selectedCasualtyModelId={visibleSelectedCasualtyModelId}
                modelNames={Object.fromEntries(gameState.models.map((model) => [model.id, model.label ?? model.id]))}
                onStartFight={startAosFight}
                onBeginPileIn={beginAosPileIn}
                onCompletePileIn={completeAosPileIn}
                onDeclareAttacks={declareAosAttacks}
                onResolveAttacks={resolveAosAttacks}
                diceMode={combatDiceMode}
                diceReview={currentCombatDiceReview?.attackerUnitId === combatDisplayUnit.id ? currentCombatDiceReview : null}
                revealedDiceStage={revealedCombatDiceStage}
                onDiceModeChange={setCombatDiceMode}
                onNextDiceStage={() => setRevealedCombatDiceStage((current) => Math.min(
                  current + 1,
                  currentCombatDiceReview ? aosCombatDiceStages(currentCombatDiceReview).length : current + 1,
                ))}
                onCasualtyModelChoose={chooseAosCasualtyModel}
                onConfirmUnitDamage={() => allocateAosDamage(null)}
                onCasualtyModelHover={setBattlefieldHoveredModelId}
                hoveredModelId={battlefieldHoveredModelId}
                focusedProfileId={combatPresentationFocus?.profileId ?? null}
                onProfileFocus={(profileId, targetUnitId) => setCombatProfileFocus(profileId ? { profileId, targetUnitId } : null)}
                onClose={() => setContextPanel('inspector')}
              />
            </div>
          )}
          {movementToolsEnabled && activeTool === 'smart-move' && (
            <div className={`context-panel-view ${contextPanel === 'smart-move' ? '' : 'hidden'}`}>
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
                  setContextPanel('inspector')
                }}
                onClosePanel={() => setContextPanel('inspector')}
              />
            </div>
          )}
          {diceOpen && (
            <div className={`context-panel-view ${contextPanel === 'dice' ? '' : 'hidden'}`}>
              <DicePanel
            players={gameState.players}
            activePlayerId={gameState.gameContext.activePlayerId}
            history={gameState.diceHistory ?? []}
            onClose={() => setContextPanel('inspector')}
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
            </div>
          )}
          {contextPanel === 'match-info' && (
            <div className="context-panel-view">
              <MatchInfoPanel
                gameSystemName={loadedRuntime.gameSystem.name}
                gameState={gameState}
                ui={gameSystemRegistration.ui}
                runtimeFacts={aosRuntimeFacts}
                onClose={() => setContextPanel('inspector')}
              />
            </div>
          )}
        </aside>
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
  actionContext?: import('./domain/types').ResolvedMovementActionContext,
): (target: SmartMoveRequest['target']) => SmartMoveRequest {
  const passOver = new Set(actionContext?.passOverModelIds ?? [])
  return (target) => ({
    allModels: gameState.models.map((model) => passOver.has(model.id)
      ? { ...model, canPassOverModels: true }
      : model),
    units: gameState.units,
    battlefield: gameState.battlefield,
    terrainFeatures: gameState.battlefieldFeatures,
    terrainPolicy: gameState.terrainPolicy,
    selectedModelIds: modelIds,
    target: { ...target },
    movementRemaining,
    coherencyPolicy,
    movementPolicy,
    separationConstraints: actionContext?.separationConstraints,
    destinationConstraints: actionContext?.destinationConstraints,
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
  const source = query.has('aosCharge') || query.has('aosCombat') ? createAosChargePileInDemo(query.has('aosCombat'))
    : query.has('lifecycle') ? lifecycleDemoGameState
    : query.has('battlefieldFeatures') ? battlefieldFeatureDemoGameState
      : query.has('orientationGap') ? orientationGapGameState
        : query.has('footprints') ? footprintDemoGameState : initialGameState
  const routeId = query.has('aosCharge') || query.has('aosCombat') ? 'aos-charge-pile-in-preview'
    : query.has('lifecycle') ? 'development-lifecycle-preview'
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

function describePlacementViolation(violation: CandidateFormationViolation): string {
  switch (violation.type) {
    case 'OUTSIDE_REQUIRED_AREA': return 'Every model must be wholly within the assigned territory.'
    case 'TOO_CLOSE_TO_AREA': return `Every model must be more than ${violation.minimumDistance}″ from enemy territory.`
    case 'OUT_OF_BOUNDS': return 'A model is outside the battlefield.'
    case 'COLLIDES_WITH_STATIONARY_MODEL': return 'A model overlaps a model already on the battlefield.'
    case 'CANDIDATE_INTERNAL_OVERLAP': return 'Models in the formation overlap.'
    case 'TERRAIN_FINISH_FORBIDDEN': return 'A model cannot finish on this terrain part.'
    case 'COHERENCY_FAILED': return 'The complete unit is not coherent.'
    case 'MODEL_NOT_FOUND': return 'Model data is incomplete.'
    case 'MOVEMENT_ALLOWANCE_EXCEEDED': return 'Placement does not consume movement.'
    case 'MODEL_SEPARATION_FAILED': return `A model is within ${violation.minimumDistance}″ of an enemy model.`
    case 'DESTINATION_RELATIONSHIP_FAILED': return 'The final position does not satisfy this movement ability.'
  }
}
