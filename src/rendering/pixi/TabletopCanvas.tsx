import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from 'pixi.js'
import type { BattlefieldFeature, Footprint, GameState, MovementPolicyConfig, Pose, TabletopModel } from '../../domain/types'
import { isPointInsideBattlefield } from '../../engine/geometry/battlefield'
import type { Point } from '../../engine/geometry/point'
import {
  footprintBounds,
  footprintContainsPoint,
  footprintIntersectsRectangle,
  poseForModel,
} from '../../engine/geometry/footprints'
import {
  exclusionOutlineForTargetFootprint,
  rangeOutlineForModel,
} from '../../engine/spatial'
import { millimetersToInches } from '../../engine/units'
import type { GameStateAction } from '../../state/actions'
import type { MeasurementResult, MeasurementTarget } from '../../tools/measurement'
import { hasDragIntent, individualSameUnitHandoffTarget, selectionForModelPointerDown } from '../../tools/selection'
import type { SpatialOverlayConfig } from '../../tools/spatialOverlay'
import { exclusionTargetForModel } from '../../tools/spatialOverlay'
import type { ActiveTool } from '../../ui/Toolbar'
import type { SmartMoveResult } from '../../engine/smartMove'
import type { CoherencyResult } from '../../engine/coherency'
import type { ModelPickerTarget } from '../../tools/modelPicker'
import { shortestSignedAngularDelta } from '../../engine/rotation'
import { resolveModelPointerDown, resolveTabletopPointerDown } from '../../tools/pointerInput'
import { deriveSmartMoveGhosts } from '../../tools/smartMoveGhosts'
import { featureObjectiveArea } from '../../engine/battlefieldFeatures'

interface TabletopCanvasProps {
  gameState: GameState
  spatialModels: GameState['models']
  activeTool: ActiveTool
  selectedIds: ReadonlySet<string>
  selectedFeatureId: string | null
  selectedObjectiveId: string | null
  measurement: MeasurementResult | null
  measurementTargetA: MeasurementTarget | null
  measurementTargetB: MeasurementTarget | null
  spatialOverlay: SpatialOverlayConfig | null
  smartMoveResult: SmartMoveResult | null
  smartMoveRawTarget: Point | null
  smartMoveTargetLocked: boolean
  visibilityPickTarget: ModelPickerTarget | null
  lifecyclePlacementActive: boolean
  lifecyclePlacementPreviews: Array<{ model: TabletopModel; pose: Pose; valid: boolean }>
  lifecyclePlacementCoherency: Array<{ models: TabletopModel[]; result: CoherencyResult }>
  resetCameraSignal: number
  movementPolicy: MovementPolicyConfig
  onSelectionChange: (ids: Set<string>) => void
  onFeatureSelectionChange: (featureId: string) => void
  onMeasureTarget: (target: MeasurementTarget) => void
  onSmartMoveTargetPreview: (target: Point) => void
  onSmartMoveTargetLock: (target: Point) => void
  onVisibilityPickModel: (modelId: string) => void
  onVisibilityPickHover: (modelId: string | null) => void
  onLifecyclePlacementPreview: (point: Point) => void
  onLifecyclePlacementCommit: (point: Point) => void
  dispatch: (action: GameStateAction) => void
}

interface CameraState { x: number; y: number; zoom: number }
interface DragState {
  startWorld: Point
  startScreen: Point
  models: GameState['models']
  sessionStarted: boolean
  dragStarted: boolean
  clickedModelId: string
  collapseSelectionOnClick: boolean
  handoffTargetId?: string
}
interface RotationDragState {
  modelId: string
  center: Point
  startScreen: Point
  startPointerAngle: number
  startRotation: number
  sessionStarted: boolean
  dragStarted: boolean
}
interface SelectionBoxState { start: Point; current: Point; additive: boolean; active: boolean }

const OWNER_COLORS: Record<string, { fill: number; rim: number }> = {
  'player-1': { fill: 0xd96c4d, rim: 0xffa37f },
  'player-2': { fill: 0x4c8ca8, rim: 0x8bd4ee },
}

export function TabletopCanvas(props: TabletopCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldRef = useRef<Container | null>(null)
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, zoom: 10 })
  const dragRef = useRef<DragState | null>(null)
  const rotationDragRef = useRef<RotationDragState | null>(null)
  const panRef = useRef<{ start: Point; camera: Point } | null>(null)
  const selectionBoxRef = useRef<SelectionBoxState | null>(null)
  const movementSequenceRef = useRef(0)
  const smartTargetFrameRef = useRef<number | null>(null)
  const latestSmartTargetRef = useRef<Point | null>(null)
  const smartTargetMarkerRef = useRef<Graphics | null>(null)
  const propsRef = useRef(props)

  useLayoutEffect(() => {
    propsRef.current = props
  }, [props])

  const fitCamera = () => {
    const host = hostRef.current
    const world = worldRef.current
    if (!host || !world) return
    const { width, height } = propsRef.current.gameState.battlefield
    const zoom = Math.min((host.clientWidth - 96) / width, (host.clientHeight - 96) / height)
    cameraRef.current = {
      zoom,
      x: (host.clientWidth - width * zoom) / 2,
      y: (host.clientHeight - height * zoom) / 2,
    }
    applyCamera(world, cameraRef.current)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let initialized = false
    const app = new Application()

    void app.init({
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio, 2),
    }).then(() => {
      initialized = true
      if (disposed) { app.destroy(true); return }
      host.appendChild(app.canvas)
      app.canvas.className = 'tabletop-canvas'
      appRef.current = app

      const world = new Container()
      world.sortableChildren = true
      worldRef.current = world
      app.stage.addChild(world)
      app.stage.eventMode = 'static'

      const updateHitArea = () => {
        app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height)
      }
      updateHitArea()
      app.renderer.on('resize', updateHitArea)

      const beginCameraPan = (event: FederatedPointerEvent) => {
        panRef.current = {
          start: { x: event.global.x, y: event.global.y },
          camera: { x: cameraRef.current.x, y: cameraRef.current.y },
        }
        app.canvas.classList.add('is-panning')
      }

      app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        const route = resolveTabletopPointerDown(propsRef.current.activeTool, event.button)
        if (route.kind === 'camera-pan') {
          beginCameraPan(event)
          return
        }
        if (propsRef.current.lifecyclePlacementActive && event.button === 0) {
          propsRef.current.onLifecyclePlacementCommit(screenToWorld(event.global, cameraRef.current))
          return
        }
        if (propsRef.current.visibilityPickTarget) return
        if (propsRef.current.activeTool === 'measure') {
          const point = screenToWorld(event.global, cameraRef.current)
          if (isPointInsideBattlefield(point, propsRef.current.gameState.battlefield)) {
            propsRef.current.onMeasureTarget({ type: 'point', point })
          }
        } else if (propsRef.current.activeTool === 'smart-move') {
          const point = screenToWorld(event.global, cameraRef.current)
          if (smartTargetFrameRef.current !== null) cancelAnimationFrame(smartTargetFrameRef.current)
          smartTargetFrameRef.current = null
          latestSmartTargetRef.current = point
          updateSmartTargetMarker(world, smartTargetMarkerRef, point)
          propsRef.current.onSmartMoveTargetLock(point)
        } else {
          if (!propsRef.current.gameState.movementSession) {
            const start = screenToWorld(event.global, cameraRef.current)
            if (isPointInsideBattlefield(start, propsRef.current.gameState.battlefield)) {
              selectionBoxRef.current = { start, current: start, additive: event.shiftKey, active: false }
            }
          }
        }
      })

      app.stage.on('globalpointermove', (event: FederatedPointerEvent) => {
        const pan = panRef.current
        if (pan) {
          cameraRef.current.x = pan.camera.x + event.global.x - pan.start.x
          cameraRef.current.y = pan.camera.y + event.global.y - pan.start.y
          applyCamera(world, cameraRef.current)
        }

        if (propsRef.current.lifecyclePlacementActive && !pan) {
          propsRef.current.onLifecyclePlacementPreview(screenToWorld(event.global, cameraRef.current))
        }

        if (propsRef.current.activeTool === 'smart-move'
          && !propsRef.current.smartMoveTargetLocked
          && !pan) {
          const target = screenToWorld(event.global, cameraRef.current)
          latestSmartTargetRef.current = target
          if (smartTargetFrameRef.current === null) {
            smartTargetFrameRef.current = requestAnimationFrame(() => {
              smartTargetFrameRef.current = null
              const latest = latestSmartTargetRef.current
              if (latest
                && propsRef.current.activeTool === 'smart-move'
                && !propsRef.current.smartMoveTargetLocked) {
                updateSmartTargetMarker(world, smartTargetMarkerRef, latest)
                propsRef.current.onSmartMoveTargetPreview(latest)
              }
            })
          }
        }

        const rotationDrag = rotationDragRef.current
        if (rotationDrag && !pan) {
          if (!rotationDrag.dragStarted && hasDragIntent(rotationDrag.startScreen, event.global)) {
            if (!rotationDrag.sessionStarted) {
              propsRef.current.dispatch({
                type: 'movement/sessionStarted',
                sessionId: `move-${++movementSequenceRef.current}`,
                modelIds: [rotationDrag.modelId],
                movementPolicy: propsRef.current.movementPolicy,
              })
              rotationDrag.sessionStarted = true
            }
            rotationDrag.dragStarted = true
          }
          if (rotationDrag.dragStarted) {
            const current = screenToWorld(event.global, cameraRef.current)
            const pointerAngle = Math.atan2(
              current.y - rotationDrag.center.y,
              current.x - rotationDrag.center.x,
            )
            propsRef.current.dispatch({
              type: 'movement/rotationRequested',
              modelId: rotationDrag.modelId,
              rotation: rotationDrag.startRotation + shortestSignedAngularDelta(
                rotationDrag.startPointerAngle,
                pointerAngle,
              ),
            })
          }
        }

        const drag = dragRef.current
        if (drag) {
          if (drag.handoffTargetId) {
            drag.dragStarted = drag.dragStarted || hasDragIntent(drag.startScreen, event.global)
          } else {
          const current = screenToWorld(event.global, cameraRef.current)
          const requested = { x: current.x - drag.startWorld.x, y: current.y - drag.startWorld.y }
          if (!drag.dragStarted && hasDragIntent(drag.startScreen, event.global)) {
            if (!drag.sessionStarted) {
              propsRef.current.dispatch({
                type: 'movement/sessionStarted',
                sessionId: `move-${++movementSequenceRef.current}`,
                modelIds: drag.models.map((model) => model.id),
                movementPolicy: propsRef.current.movementPolicy,
              })
              drag.sessionStarted = true
            }
            drag.dragStarted = true
          }
          if (!drag.dragStarted) return
          propsRef.current.dispatch({
            type: 'movement/requested',
            positions: Object.fromEntries(drag.models.map((model) => [
              model.id,
              { x: model.position.x + requested.x, y: model.position.y + requested.y },
            ])),
          })
          }
        }

        const selectionBox = selectionBoxRef.current
        if (selectionBox) {
          selectionBox.current = screenToWorld(event.global, cameraRef.current)
          selectionBox.active = selectionBox.active
            || Math.hypot(selectionBox.current.x - selectionBox.start.x, selectionBox.current.y - selectionBox.start.y) > 0.15
          if (selectionBox.active) drawScene(world, propsRef, dragRef, rotationDragRef, panRef, cameraRef, selectionBoxRef, smartTargetMarkerRef)
        }
      })

      const endPointerGesture = () => {
        const drag = dragRef.current
        if (drag?.handoffTargetId && !drag.dragStarted) {
          propsRef.current.dispatch({ type: 'movement/confirmed' })
          propsRef.current.onSelectionChange(new Set([drag.handoffTargetId]))
        } else if (drag && !drag.dragStarted && drag.collapseSelectionOnClick) {
          propsRef.current.onSelectionChange(new Set([drag.clickedModelId]))
        }
        const selectionBox = selectionBoxRef.current
        if (selectionBox) {
          if (selectionBox.active) {
            const rectangle = normalizeRectangle(selectionBox.start, selectionBox.current)
            const hits = propsRef.current.gameState.models
              .filter((model) => footprintIntersectsRectangle(model.base, poseForModel(model), rectangle))
              .map((model) => model.id)
            const next = selectionBox.additive ? new Set(propsRef.current.selectedIds) : new Set<string>()
            hits.forEach((id) => next.add(id))
            propsRef.current.onSelectionChange(next)
          } else if (!selectionBox.additive) {
            propsRef.current.onSelectionChange(new Set())
          }
          selectionBoxRef.current = null
          drawScene(world, propsRef, dragRef, rotationDragRef, panRef, cameraRef, selectionBoxRef, smartTargetMarkerRef)
        }
        dragRef.current = null
        rotationDragRef.current = null
        panRef.current = null
        app.canvas.classList.remove('is-panning')
      }
      app.stage.on('pointerup', endPointerGesture)
      app.stage.on('pointerupoutside', endPointerGesture)

      app.canvas.addEventListener('wheel', (event) => {
        event.preventDefault()
        const rect = app.canvas.getBoundingClientRect()
        const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const before = screenToWorld(pointer, cameraRef.current)
        const fit = Math.min(
          (host.clientWidth - 48) / propsRef.current.gameState.battlefield.width,
          (host.clientHeight - 48) / propsRef.current.gameState.battlefield.height,
        )
        cameraRef.current.zoom = Math.min(160, Math.max(fit * 0.55, cameraRef.current.zoom * Math.exp(-event.deltaY * 0.001)))
        cameraRef.current.x = pointer.x - before.x * cameraRef.current.zoom
        cameraRef.current.y = pointer.y - before.y * cameraRef.current.zoom
        applyCamera(world, cameraRef.current)
      }, { passive: false })
      app.canvas.addEventListener('contextmenu', (event) => event.preventDefault())

      fitCamera()
      drawScene(world, propsRef, dragRef, rotationDragRef, panRef, cameraRef, selectionBoxRef, smartTargetMarkerRef)
    })

    return () => {
      disposed = true
      appRef.current = null
      worldRef.current = null
      if (initialized) app.destroy(true, { children: true })
      if (smartTargetFrameRef.current !== null) cancelAnimationFrame(smartTargetFrameRef.current)
    }
  }, [])

  useEffect(() => {
    const world = worldRef.current
    if (world) drawScene(world, propsRef, dragRef, rotationDragRef, panRef, cameraRef, selectionBoxRef, smartTargetMarkerRef)
  }, [props.gameState, props.spatialModels, props.selectedIds, props.selectedFeatureId, props.selectedObjectiveId, props.activeTool, props.measurement, props.measurementTargetA, props.measurementTargetB, props.spatialOverlay, props.smartMoveResult, props.lifecyclePlacementActive, props.lifecyclePlacementPreviews, props.lifecyclePlacementCoherency])

  useEffect(() => {
    if (props.resetCameraSignal > 0) fitCamera()
  }, [props.resetCameraSignal])

  return (
    <div className="canvas-host" ref={hostRef}>
      <div className="board-size-badge"><strong>{props.gameState.battlefield.width}</strong> × <strong>{props.gameState.battlefield.height}</strong> IN</div>
      <div className="interaction-hint">
        {props.lifecyclePlacementActive
          ? 'Placement mode · click a legal position · middle-drag pans · Esc cancels'
          : props.activeTool === 'measure'
          ? props.measurementTargetB
            ? 'Measurement complete · choose any target to start another'
            : props.measurementTargetA
              ? 'Choose a second model, unit, or battlefield point'
              : 'Click model or point · Ctrl/Cmd-click model for unit'
          : props.activeTool === 'smart-move'
              ? props.smartMoveTargetLocked
                ? 'Target locked · click battlefield to reposition · Enter or Apply Move'
                : 'Move pointer to preview · click battlefield or press Enter to lock'
          : props.spatialOverlay
            ? 'Spatial overlay · drag models or gold handle normally · Ctrl/Cmd selects unit'
          : 'Drag model to move · drag gold handle to rotate · Shift multi-select · Ctrl/Cmd unit · Ctrl/Cmd+Z undo'}
      </div>
    </div>
  )
}

function applyCamera(world: Container, camera: CameraState) {
  world.position.set(camera.x, camera.y)
  world.scale.set(camera.zoom)
}

function screenToWorld(point: Point, camera: CameraState): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }
}

function drawScene(
  world: Container,
  propsRef: React.MutableRefObject<TabletopCanvasProps>,
  dragRef: React.MutableRefObject<DragState | null>,
  rotationDragRef: React.MutableRefObject<RotationDragState | null>,
  panRef: React.MutableRefObject<{ start: Point; camera: Point } | null>,
  cameraRef: React.MutableRefObject<CameraState>,
  selectionBoxRef: React.MutableRefObject<SelectionBoxState | null>,
  smartTargetMarkerRef: React.MutableRefObject<Graphics | null>,
) {
  smartTargetMarkerRef.current = null
  world.removeChildren().forEach((child) => child.destroy({ children: true }))
  const props = propsRef.current
  const { battlefield, models } = props.gameState

  const shadow = new Graphics().roundRect(0.32, 0.4, battlefield.width, battlefield.height, 0.45).fill({ color: 0x000000, alpha: 0.38 })
  world.addChild(shadow)
  const board = new Graphics().roundRect(0, 0, battlefield.width, battlefield.height, 0.35).fill(0x263a34).stroke({ color: 0x86a192, width: 0.12 })
  board.eventMode = 'none'
  world.addChild(board)

  const grid = new Graphics()
  for (let x = 5; x < battlefield.width; x += 5) grid.moveTo(x, 0).lineTo(x, battlefield.height)
  for (let y = 5; y < battlefield.height; y += 5) grid.moveTo(0, y).lineTo(battlefield.width, y)
  grid.stroke({ color: 0xb1c5b8, alpha: 0.09, width: 0.045 })
  grid.eventMode = 'none'
  world.addChild(grid)

  for (const feature of props.gameState.battlefieldFeatures ?? []) {
    drawBattlefieldFeature(world, feature, props, propsRef, panRef, cameraRef)
  }

  const spatialSources = props.spatialOverlay
    ? props.spatialModels.filter((model) => props.spatialOverlay?.sourceModelIds.includes(model.id))
    : []
  if (props.spatialOverlay?.mode === 'range' && spatialSources.length > 0) {
    drawRangeArea(world, spatialSources, props.spatialOverlay.range)
  }
  if (props.spatialOverlay?.mode === 'exclusion' && spatialSources.length > 0) {
    drawExclusionArea(
      world,
      spatialSources,
      props.spatialOverlay.requiredSeparation,
    )
  }
  if (props.spatialOverlay?.mode === 'coherency' && props.spatialOverlay.coherency) {
    drawCoherencyLinks(world, props.spatialModels, props.spatialOverlay.coherency.links)
  }
  if (props.spatialOverlay?.mode === 'visibility' && props.spatialOverlay.visibility) {
    drawVisibility(world, props.spatialOverlay.visibility)
  }

  for (const model of models) {
    const colors = OWNER_COLORS[model.ownerId] ?? { fill: 0x8f9290, rim: 0xcfd3d0 }
    const selected = props.selectedIds.has(model.id)
    const measurementHighlightActive = props.activeTool === 'measure'
    const measuringA = measurementHighlightActive
      && measurementTargetIncludesModel(props.measurementTargetA, model.id, props.gameState)
    const measuringB = measurementHighlightActive
      && measurementTargetIncludesModel(props.measurementTargetB, model.id, props.gameState)
    const token = new Container()
    token.position.set(model.position.x, model.position.y)
    token.eventMode = 'static'
    token.cursor = props.activeTool === 'measure' || props.visibilityPickTarget ? 'crosshair'
      : props.activeTool === 'smart-move' ? 'pointer' : 'grab'
    const localPose = { position: { x: 0, y: 0 }, rotation: model.rotation }
    const localBounds = footprintBounds(model.base, localPose)
    token.hitArea = {
      contains: (x: number, y: number) => footprintContainsPoint(model.base, localPose, { x, y }),
    }

    const shapeLayer = new Container()
    shapeLayer.rotation = model.rotation

    if (measuringA || measuringB) {
      shapeLayer.addChild(drawLocalFootprint(new Graphics(), model.base).stroke({
        color: measuringB ? 0x8bd4ee : measuringA ? 0xf1c969 : 0xf3e4b7,
        width: measuringA || measuringB ? 0.16 : 0.14,
        alpha: 0.95,
      }))
    }
    const footprintShadow = drawLocalFootprint(new Graphics(), model.base)
      .fill({ color: 0x07100d, alpha: 0.3 })
    footprintShadow.position.set(0.05, 0.08)
    shapeLayer.addChild(
      footprintShadow,
      drawLocalFootprint(new Graphics(), model.base)
        .fill(colors.fill)
        .stroke({ color: colors.rim, width: 0.08 }),
    )
    if (selected) {
      const selectionKeyline = drawLocalFootprint(new Graphics(), model.base)
        .stroke({ color: 0x101916, width: 0.34, alpha: 1 })
      const selectionOutline = drawLocalFootprint(new Graphics(), model.base)
        .stroke({ color: 0xf1c969, width: 0.18, alpha: 1 })
      selectionKeyline.eventMode = 'none'
      selectionOutline.eventMode = 'none'
      shapeLayer.addChild(selectionKeyline, selectionOutline)
    }
    const visibilityRole = props.spatialOverlay?.mode === 'visibility'
      ? props.spatialOverlay.visibilityViewerId === model.id ? 'viewer'
        : props.spatialOverlay.visibilityTargetId === model.id ? 'target' : null
      : null
    const pickHover = props.visibilityPickTarget && props.spatialOverlay?.visibilityPickHoverModelId === model.id
    if (visibilityRole || pickHover) {
      const roleColor = pickHover ? 0xffffff : visibilityRole === 'viewer' ? 0x65d7ff : 0xd89bff
      shapeLayer.addChild(drawLocalFootprint(new Graphics(), model.base)
        .stroke({ color: roleColor, width: pickHover ? 0.2 : 0.14, alpha: 0.98 }))
    }
    token.addChild(shapeLayer)

    const label = new Text({
      text: model.label ?? '',
      style: new TextStyle({ fontFamily: 'Arial', fontSize: 16, fontWeight: '700', fill: 0xffffff }),
      resolution: 3,
    })
    label.anchor.set(0.5)
    const labelRadius = Math.max(
      localBounds.right - localBounds.left,
      localBounds.bottom - localBounds.top,
    ) / 2
    label.scale.set(Math.max(0.27, labelRadius * 0.48) / 16)
    label.eventMode = 'none'
    token.addChild(label)

    token.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      const currentProps = propsRef.current
      const modelRoute = resolveModelPointerDown(currentProps.activeTool, event.button)
      if (modelRoute === 'camera-pan') {
        panRef.current = {
          start: { x: event.global.x, y: event.global.y },
          camera: { x: cameraRef.current.x, y: cameraRef.current.y },
        }
        return
      }
      if (currentProps.lifecyclePlacementActive) {
        currentProps.onLifecyclePlacementCommit(screenToWorld(event.global, cameraRef.current))
        return
      }
      if (currentProps.visibilityPickTarget) {
        currentProps.onVisibilityPickModel(model.id)
        return
      }
      const unit = currentProps.gameState.units.find((candidate) => candidate.id === model.unitId)
      if (modelRoute === 'measure') {
        currentProps.onMeasureTarget(event.ctrlKey || event.metaKey
          ? { type: 'unit', unitId: unit?.id ?? model.unitId }
          : { type: 'model', modelId: model.id })
        return
      }
      if (currentProps.activeTool === 'smart-move') {
        const nextSelection = selectionForModelPointerDown(
          currentProps.selectedIds,
          model.id,
          unit?.modelIds ?? [model.id],
          { shiftKey: event.shiftKey, unitKey: event.ctrlKey || event.metaKey },
        )
        if (!setsEqual(nextSelection, currentProps.selectedIds)) currentProps.onSelectionChange(nextSelection)
        return
      }
      const activeSessionIds = currentProps.gameState.movementSession?.modelIds
      const unitKey = event.ctrlKey || event.metaKey
      if (activeSessionIds && !activeSessionIds.includes(model.id)) {
        const handoffTarget = individualSameUnitHandoffTarget(
          currentProps.gameState.movementSession,
          currentProps.gameState.models,
          model.id,
        )
        if (
          event.button === 0
          && !event.shiftKey
          && !unitKey
          && handoffTarget
        ) {
          dragRef.current = {
            startWorld: screenToWorld(event.global, cameraRef.current),
            startScreen: { x: event.global.x, y: event.global.y },
            models: [],
            sessionStarted: true,
            dragStarted: false,
            clickedModelId: model.id,
            collapseSelectionOnClick: false,
            handoffTargetId: handoffTarget,
          }
        }
        return
      }
      if (unitKey && !activeSessionIds) {
        currentProps.onSelectionChange(selectionForModelPointerDown(
          currentProps.selectedIds,
          model.id,
          unit?.modelIds ?? [model.id],
          { shiftKey: event.shiftKey, unitKey: true },
        ))
        return
      }

      const preserveMultiSelectionForPotentialDrag = !activeSessionIds
        && !event.shiftKey
        && currentProps.selectedIds.has(model.id)
        && currentProps.selectedIds.size > 1
      const nextSelection = preserveMultiSelectionForPotentialDrag
        ? new Set(currentProps.selectedIds)
        : selectionForModelPointerDown(
          currentProps.selectedIds,
          model.id,
          unit?.modelIds ?? [model.id],
          { shiftKey: event.shiftKey, unitKey: false },
        )
      if (!setsEqual(nextSelection, currentProps.selectedIds)) currentProps.onSelectionChange(new Set(nextSelection))
      if (!nextSelection.has(model.id)) return
      const participantIds = activeSessionIds ? new Set(activeSessionIds) : nextSelection
      const draggedModels = currentProps.gameState.models
        .filter((candidate) => participantIds.has(candidate.id))
        .map((candidate) => ({ ...candidate, position: { ...candidate.position } }))
      dragRef.current = {
        startWorld: screenToWorld(event.global, cameraRef.current),
        startScreen: { x: event.global.x, y: event.global.y },
        models: draggedModels,
        sessionStarted: Boolean(currentProps.gameState.movementSession),
        dragStarted: false,
        clickedModelId: model.id,
        collapseSelectionOnClick: preserveMultiSelectionForPotentialDrag,
      }
      token.cursor = 'grabbing'
    })
    token.on('pointerover', () => {
      if (propsRef.current.visibilityPickTarget) propsRef.current.onVisibilityPickHover(model.id)
    })
    token.on('pointerout', () => {
      if (propsRef.current.visibilityPickTarget) propsRef.current.onVisibilityPickHover(null)
    })
    world.addChild(token)

    const activeSessionIds = props.gameState.movementSession?.modelIds
    const canRotate = props.activeTool === 'select'
      && selected
      && props.selectedIds.size === 1
      && (!activeSessionIds || (activeSessionIds.length === 1 && activeSessionIds[0] === model.id))
    if (canRotate) {
      const handleDistance = Math.max(
        Math.abs(localBounds.left),
        Math.abs(localBounds.right),
        Math.abs(localBounds.top),
        Math.abs(localBounds.bottom),
      ) + 1.1
      const handleAngle = model.rotation - Math.PI / 2
      const handlePosition = {
        x: model.position.x + Math.cos(handleAngle) * handleDistance,
        y: model.position.y + Math.sin(handleAngle) * handleDistance,
      }
      const connector = new Graphics()
        .moveTo(model.position.x, model.position.y)
        .lineTo(handlePosition.x, handlePosition.y)
        .stroke({ color: 0xf1c969, width: 0.07, alpha: 0.75 })
      connector.eventMode = 'none'
      connector.zIndex = 100

      const rotationHandle = new Graphics()
        .circle(handlePosition.x, handlePosition.y, 0.38)
        .fill({ color: 0x2b2414, alpha: 0.98 })
        .stroke({ color: 0xf1c969, width: 0.1, alpha: 1 })
      rotationHandle.eventMode = 'static'
      rotationHandle.cursor = 'crosshair'
      rotationHandle.zIndex = 101
      rotationHandle.on('pointerdown', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        if (resolveTabletopPointerDown(propsRef.current.activeTool, event.button).kind === 'camera-pan') {
          panRef.current = {
            start: { x: event.global.x, y: event.global.y },
            camera: { x: cameraRef.current.x, y: cameraRef.current.y },
          }
          return
        }
        if (event.button !== 0) return
        const currentModel = propsRef.current.gameState.models.find((candidate) => candidate.id === model.id)
        const currentSession = propsRef.current.gameState.movementSession
        if (!currentModel
          || (currentSession && (currentSession.modelIds.length !== 1 || currentSession.modelIds[0] !== model.id))) return
        const pointer = screenToWorld(event.global, cameraRef.current)
        rotationDragRef.current = {
          modelId: model.id,
          center: { ...currentModel.position },
          startScreen: { x: event.global.x, y: event.global.y },
          startPointerAngle: Math.atan2(
            pointer.y - currentModel.position.y,
            pointer.x - currentModel.position.x,
          ),
          startRotation: currentModel.rotation,
          sessionStarted: Boolean(currentSession),
          dragStarted: false,
        }
      })

      const angleLabel = new Text({
        text: `${(model.rotation * 180 / Math.PI).toFixed(1)}°`,
        style: new TextStyle({ fontFamily: 'Arial', fontSize: 14, fontWeight: '700', fill: 0xf1c969 }),
        resolution: 3,
      })
      angleLabel.anchor.set(0.5, 1)
      angleLabel.scale.set(0.38 / 14)
      angleLabel.position.set(handlePosition.x, handlePosition.y - 0.55)
      angleLabel.eventMode = 'none'
      angleLabel.zIndex = 102
      world.addChild(connector, rotationHandle, angleLabel)
    }
  }

  if (props.spatialOverlay?.mode === 'coherency' && props.spatialOverlay.coherency) {
    drawCoherencyStatus(world, props.spatialModels, props.spatialOverlay.coherency.models)
  }

  const session = props.gameState.movementSession
  if (session?.referencePath && session.referencePath.length > 1) drawMovementPath(world, session.referencePath)

  // Analysis overlays are deliberately added after model tokens. They remain
  // visually legible while staying non-interactive so model pointer events win.
  if (props.activeTool === 'measure') {
    drawMeasurementPointTarget(world, props.measurementTargetA, 0xf1c969, 'A')
    drawMeasurementPointTarget(world, props.measurementTargetB, 0x8bd4ee, 'B')
  }
  if (props.measurement) drawMeasurement(
    world,
    props.measurement.startAnchor,
    props.measurement.endAnchor,
    props.measurement.distanceInches,
  )
  if (props.activeTool === 'smart-move' && props.smartMoveResult) {
    drawSmartMovePreview(world, props.smartMoveResult, models)
  }
  if (props.activeTool === 'smart-move' && props.smartMoveRawTarget) {
    updateSmartTargetMarker(world, smartTargetMarkerRef, props.smartMoveRawTarget)
  }
  for (const placement of props.lifecyclePlacementPreviews) {
    const preview = new Container()
    preview.position.set(placement.pose.position.x, placement.pose.position.y)
    preview.rotation = placement.pose.rotation
    const color = placement.valid ? 0x72d6a1 : 0xff7d6d
    preview.addChild(drawLocalFootprint(new Graphics(), placement.model.base)
      .fill({ color, alpha: 0.18 })
      .stroke({ color, width: 0.18, alpha: 1 }))
    preview.eventMode = 'none'
    world.addChild(preview)
  }
  for (const preview of props.lifecyclePlacementCoherency) {
    drawCoherencyLinks(world, preview.models, preview.result.links)
    drawCoherencyStatus(world, preview.models, preview.result.models)
  }

  const selectionBox = selectionBoxRef.current
  if (selectionBox?.active) drawSelectionBox(world, selectionBox.start, selectionBox.current)
}

function drawBattlefieldFeature(
  world: Container,
  feature: BattlefieldFeature,
  props: TabletopCanvasProps,
  propsRef: React.MutableRefObject<TabletopCanvasProps>,
  panRef: React.MutableRefObject<{ start: Point; camera: Point } | null>,
  cameraRef: React.MutableRefObject<CameraState>,
) {
  const root = new Container()
  root.position.set(feature.pose.position.x, feature.pose.position.y)
  root.rotation = feature.pose.rotation
  const canInspect = props.activeTool === 'select' && !props.gameState.movementSession
  root.eventMode = canInspect ? 'static' : 'none'
  root.cursor = 'pointer'
  const localPose = { position: { x: 0, y: 0 }, rotation: 0 }
  root.hitArea = { contains: (x: number, y: number) => footprintContainsPoint(feature.baseArea, localPose, { x, y }) }
  const isObjective = Boolean(feature.capabilities.objective)
  const isTerrain = Boolean(feature.capabilities.terrain)
  const baseColor = isObjective && isTerrain ? 0xd9a96d : isObjective ? 0xf1c969 : 0x79baa5
  const base = drawLocalFootprint(new Graphics(), feature.baseArea)
    .fill({ color: baseColor, alpha: 0.14 })
    .stroke({ color: baseColor, width: 0.15, alpha: 0.95 })
  base.eventMode = 'none'
  root.addChild(base)
  if (props.selectedFeatureId === feature.id) {
    const selection = drawLocalFootprint(new Graphics(), feature.baseArea)
      .stroke({ color: 0xffffff, width: 0.27, alpha: 1 })
    selection.eventMode = 'none'
    root.addChild(selection)
  }
  for (const object of feature.objects) {
    const child = drawLocalFootprint(new Graphics(), object.footprint)
      .fill({ color: 0x465b57, alpha: 0.95 })
      .stroke({ color: 0xc9ded2, width: 0.12 })
    child.position.set(object.localPose.position.x, object.localPose.position.y)
    child.rotation = object.localPose.rotation
    child.eventMode = 'none'
    root.addChild(child)
  }
  const label = new Text({
    text: feature.name,
    style: new TextStyle({ fontFamily: 'Arial', fontSize: 16, fontWeight: '700', fill: baseColor }),
    resolution: 3,
  })
  label.anchor.set(0.5)
  label.scale.set(0.55 / 16)
  label.position.set(0, footprintBounds(feature.baseArea, localPose).bottom + 0.55)
  label.eventMode = 'none'
  root.addChild(label)
  root.on('pointerdown', (event: FederatedPointerEvent) => {
    event.stopPropagation()
    if (event.button !== 0) {
      panRef.current = {
        start: { x: event.global.x, y: event.global.y },
        camera: { x: cameraRef.current.x, y: cameraRef.current.y },
      }
      return
    }
    if (propsRef.current.lifecyclePlacementActive) {
      propsRef.current.onLifecyclePlacementCommit(screenToWorld(event.global, cameraRef.current))
      return
    }
    propsRef.current.onFeatureSelectionChange(feature.id)
  })
  world.addChild(root)
  if (props.spatialOverlay?.mode === 'objectives' && feature.capabilities.objective) {
    const area = featureObjectiveArea(feature)
    if (area) {
      const chosen = props.selectedObjectiveId === feature.id
      const objectiveOutline = drawLocalFootprint(new Graphics(), area.footprint)
        .fill({ color: 0xf1c969, alpha: chosen ? 0.08 : 0.035 })
        .stroke({ color: 0xffd779, width: chosen ? 0.22 : 0.13, alpha: chosen ? 0.95 : 0.65 })
      objectiveOutline.position.set(area.pose.position.x, area.pose.position.y)
      objectiveOutline.rotation = area.pose.rotation
      objectiveOutline.eventMode = 'none'
      world.addChild(objectiveOutline)
    }
  }
}

function drawSmartMovePreview(
  world: Container,
  result: SmartMoveResult,
  models: GameState['models'],
) {
  const color = result.valid ? 0x72d6a1 : 0xff7d6d
  const pathGraphic = new Graphics()
  for (const assignment of result.assignments) {
    if (assignment.path.length > 1) {
      pathGraphic.moveTo(assignment.path[0].x, assignment.path[0].y)
      for (const point of assignment.path.slice(1)) pathGraphic.lineTo(point.x, point.y)
    }
  }
  pathGraphic.stroke({ color, width: 0.07, alpha: 0.3 })
  pathGraphic.eventMode = 'none'
  world.addChild(pathGraphic)

  for (const preview of deriveSmartMoveGhosts(result, models)) {
    const ghost = drawLocalFootprint(new Graphics(), preview.footprint)
      .fill({ color, alpha: 0.16 })
      .stroke({ color, width: 0.13, alpha: 0.95 })
    ghost.position.set(preview.pose.position.x, preview.pose.position.y)
    ghost.rotation = preview.pose.rotation
    ghost.eventMode = 'none'
    world.addChild(ghost)
  }

}

function updateSmartTargetMarker(
  world: Container,
  markerRef: React.MutableRefObject<Graphics | null>,
  target: Point,
) {
  if (markerRef.current) {
    markerRef.current.parent?.removeChild(markerRef.current)
    markerRef.current.destroy()
  }
  const marker = new Graphics()
    .moveTo(target.x - 0.3, target.y).lineTo(target.x + 0.3, target.y)
    .moveTo(target.x, target.y - 0.3).lineTo(target.x, target.y + 0.3)
    .circle(target.x, target.y, 0.16)
    .stroke({ color: 0xf1c969, width: 0.08, alpha: 0.95 })
  marker.eventMode = 'none'
  markerRef.current = marker
  world.addChild(marker)
}

function drawRangeArea(world: Container, models: GameState['models'], range: number) {
  const area = new Graphics()
  for (const model of models) {
    drawClosedOutline(area, rangeOutlineForModel(model, range))
  }
  area.fill({ color: 0x78b9d1, alpha: 0.13 })
  area.eventMode = 'none'
  world.addChild(area)
}

function drawExclusionArea(
  world: Container,
  models: GameState['models'],
  requiredSeparation: number,
) {
  const area = new Graphics()
  for (const model of models) {
    const target = exclusionTargetForModel(model)
    drawClosedOutline(area, exclusionOutlineForTargetFootprint(
      model,
      target.footprint,
      target.rotation,
      requiredSeparation,
    ))
  }
  area.fill({ color: 0xd96c4d, alpha: 0.14 })
  area.eventMode = 'none'
  world.addChild(area)
}

function drawCoherencyLinks(
  world: Container,
  models: GameState['models'],
  links: NonNullable<SpatialOverlayConfig['coherency']>['links'],
) {
  const byId = new Map(models.map((model) => [model.id, model]))
  const graphic = new Graphics()
  for (const link of links) {
    if (byId.has(link.sourceModelId) && byId.has(link.targetModelId)) {
      graphic.moveTo(link.startAnchor.x, link.startAnchor.y).lineTo(link.endAnchor.x, link.endAnchor.y)
    }
  }
  graphic.stroke({ color: 0x72d6a1, width: 0.08, alpha: 0.45 })
  graphic.eventMode = 'none'
  world.addChild(graphic)
}

function drawVisibility(
  world: Container,
  visibility: NonNullable<SpatialOverlayConfig['visibility']>,
) {
  visibility.segments.forEach((segment, index) => {
    const color = segment.blocked ? 0xff7f70 : 0x8fe0b4
    const line = new Graphics()
      .moveTo(segment.startAnchor.x, segment.startAnchor.y)
      .lineTo(segment.endAnchor.x, segment.endAnchor.y)
      .stroke({ color, width: index === 0 ? 0.1 : 0.065, alpha: index === 0 ? 0.95 : 0.62 })
      .circle(segment.startAnchor.x, segment.startAnchor.y, index === 0 ? 0.12 : 0.08)
      .circle(segment.endAnchor.x, segment.endAnchor.y, index === 0 ? 0.12 : 0.08)
      .fill({ color, alpha: index === 0 ? 0.95 : 0.68 })
    line.eventMode = 'none'
    world.addChild(line)
  })
}

function drawClosedOutline(graphic: Graphics, points: readonly Point[]): void {
  if (points.length === 0) return
  graphic.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) graphic.lineTo(point.x, point.y)
  graphic.closePath()
}

function drawCoherencyStatus(
  world: Container,
  models: GameState['models'],
  results: NonNullable<SpatialOverlayConfig['coherency']>['models'],
) {
  const byId = new Map(models.map((model) => [model.id, model]))
  for (const result of results) {
    const model = byId.get(result.modelId)
    if (!model) continue
    const bounds = footprintBounds(model.base, poseForModel(model))
    const markerRadius = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) / 2
    const ring = drawLocalFootprint(new Graphics(), model.base)
      .stroke({ color: result.valid ? 0x72d6a1 : 0xff5d5d, width: result.valid ? 0.11 : 0.18, alpha: 0.98 })
    ring.position.set(model.position.x, model.position.y)
    ring.rotation = model.rotation
    ring.eventMode = 'none'
    world.addChild(ring)
    if (!result.valid) {
      const marker = new Graphics()
        .circle(model.position.x + markerRadius * 0.78, model.position.y - markerRadius * 0.78, 0.24)
        .fill({ color: 0x321010, alpha: 0.98 })
        .stroke({ color: 0xff8b7d, width: 0.07 })
      marker.eventMode = 'none'
      const warning = new Text({
        text: '!',
        style: new TextStyle({ fontFamily: 'Arial', fontSize: 16, fontWeight: '700', fill: 0xffffff }),
        resolution: 4,
      })
      warning.anchor.set(0.5)
      warning.scale.set(0.31 / 16)
      warning.position.set(model.position.x + markerRadius * 0.78, model.position.y - markerRadius * 0.78 - 0.01)
      warning.eventMode = 'none'
      world.addChild(marker, warning)
    }
  }
}

function drawLocalFootprint(graphic: Graphics, footprint: Footprint): Graphics {
  switch (footprint.shape) {
    case 'circle':
      return graphic.circle(0, 0, millimetersToInches(footprint.diameterMm) / 2)
    case 'ellipse':
      return graphic.ellipse(
        0,
        0,
        millimetersToInches(footprint.widthMm) / 2,
        millimetersToInches(footprint.heightMm) / 2,
      )
    case 'rectangle': {
      const width = millimetersToInches(footprint.widthMm)
      const height = millimetersToInches(footprint.heightMm)
      return graphic.rect(-width / 2, -height / 2, width, height)
    }
    case 'polygon':
      return graphic.poly(footprint.verticesMm.flatMap((vertex) => [
        millimetersToInches(vertex.x),
        millimetersToInches(vertex.y),
      ]), true)
  }
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

function measurementTargetIncludesModel(
  target: MeasurementTarget | null,
  modelId: string,
  gameState: GameState,
): boolean {
  if (!target || target.type === 'point') return false
  if (target.type === 'model') return target.modelId === modelId
  return gameState.units.find((unit) => unit.id === target.unitId)?.modelIds.includes(modelId) ?? false
}

function drawMeasurementPointTarget(
  world: Container,
  target: MeasurementTarget | null,
  color: number,
  label: string,
) {
  if (target?.type !== 'point') return
  const { point } = target
  const marker = new Graphics()
    .moveTo(point.x - 0.22, point.y).lineTo(point.x + 0.22, point.y)
    .moveTo(point.x, point.y - 0.22).lineTo(point.x, point.y + 0.22)
    .circle(point.x, point.y, 0.11)
    .stroke({ color, width: 0.08, alpha: 0.98 })
  marker.eventMode = 'none'
  const text = new Text({
    text: label,
    style: new TextStyle({ fontFamily: 'Arial', fontSize: 16, fontWeight: '700', fill: color }),
    resolution: 4,
  })
  text.anchor.set(0.5)
  text.scale.set(0.3 / 16)
  text.position.set(point.x + 0.3, point.y - 0.3)
  text.eventMode = 'none'
  world.addChild(marker, text)
}

function normalizeRectangle(a: Point, b: Point) {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
}

function drawSelectionBox(world: Container, start: Point, end: Point) {
  const rectangle = normalizeRectangle(start, end)
  const graphic = new Graphics()
    .rect(rectangle.left, rectangle.top, rectangle.right - rectangle.left, rectangle.bottom - rectangle.top)
    .fill({ color: 0xf1c969, alpha: 0.08 })
    .stroke({ color: 0xf1c969, width: 0.08, alpha: 0.9 })
  graphic.eventMode = 'none'
  world.addChild(graphic)
}

function drawMovementPath(world: Container, path: Point[]) {
  const graphic = new Graphics().moveTo(path[0].x, path[0].y)
  for (const point of path.slice(1)) graphic.lineTo(point.x, point.y)
  graphic.stroke({ color: 0x8bd4ee, width: 0.11, alpha: 0.72 })
  for (const point of path) graphic.circle(point.x, point.y, 0.1).fill({ color: 0x8bd4ee, alpha: 0.8 })
  graphic.eventMode = 'none'
  world.addChild(graphic)
}

function drawMeasurement(world: Container, from: Point, to: Point, distance: number) {
  const overlay = new Graphics()
    .moveTo(from.x, from.y).lineTo(to.x, to.y)
    .stroke({ color: 0xf1c969, width: 0.1, alpha: 0.95 })
    .circle(from.x, from.y, 0.14).fill(0xf1c969)
    .circle(to.x, to.y, 0.14).fill(0xf1c969)
  overlay.eventMode = 'none'
  world.addChild(overlay)

  const text = new Text({
    text: `${distance.toFixed(2)}\u2033`,
    style: new TextStyle({ fontFamily: 'Arial', fontSize: 16, fontWeight: '700', fill: 0x15211d, align: 'center' }),
    resolution: 4,
  })
  text.anchor.set(0.5)
  text.scale.set(0.68 / 16)
  text.position.set((from.x + to.x) / 2, (from.y + to.y) / 2)
  const padding = 0.25
  const badge = new Graphics().roundRect(
    text.position.x - text.width / 2 - padding,
    text.position.y - text.height / 2 - padding / 2,
    text.width + padding * 2,
    text.height + padding,
    0.15,
  ).fill(0xf1c969)
  badge.eventMode = 'none'
  text.eventMode = 'none'
  world.addChild(badge, text)
}
