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
import type { GameState } from '../../domain/types'
import { circleIntersectsRectangle } from '../../engine/geometry/battlefield'
import type { Point } from '../../engine/geometry/point'
import { millimetersToInches } from '../../engine/units'
import { baseRadiusInches, exclusionRadiusForTargetBase, rangeRadiusForBase } from '../../engine/spatial'
import type { GameStateAction } from '../../state/actions'
import type { ModelMeasurement } from '../../tools/measurement'
import { hasDragIntent, individualSameUnitHandoffTarget, selectionForModelPointerDown } from '../../tools/selection'
import type { SpatialOverlayConfig } from '../../tools/spatialOverlay'
import type { ActiveTool } from '../../ui/Toolbar'

interface TabletopCanvasProps {
  gameState: GameState
  activeTool: ActiveTool
  selectedIds: ReadonlySet<string>
  measurement: ModelMeasurement | null
  measurementStartId: string | null
  spatialOverlay: SpatialOverlayConfig | null
  resetCameraSignal: number
  onSelectionChange: (ids: Set<string>) => void
  onMeasureModel: (id: string) => void
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
  const panRef = useRef<{ start: Point; camera: Point } | null>(null)
  const selectionBoxRef = useRef<SelectionBoxState | null>(null)
  const movementSequenceRef = useRef(0)
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
      worldRef.current = world
      app.stage.addChild(world)
      app.stage.eventMode = 'static'

      const updateHitArea = () => {
        app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height)
      }
      updateHitArea()
      app.renderer.on('resize', updateHitArea)

      app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        if (event.target !== app.stage) return
        if (propsRef.current.activeTool !== 'measure') {
          if (event.button === 0 && !propsRef.current.gameState.movementSession) {
            const start = screenToWorld(event.global, cameraRef.current)
            selectionBoxRef.current = { start, current: start, additive: event.shiftKey, active: false }
          } else if (event.button !== 0) {
            panRef.current = {
              start: { x: event.global.x, y: event.global.y },
              camera: { x: cameraRef.current.x, y: cameraRef.current.y },
            }
            app.canvas.classList.add('is-panning')
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
          if (selectionBox.active) drawScene(world, propsRef, dragRef, cameraRef, selectionBoxRef)
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
              .filter((model) => circleIntersectsRectangle(
                model.position,
                millimetersToInches(model.base.diameterMm) / 2,
                rectangle,
              ))
              .map((model) => model.id)
            const next = selectionBox.additive ? new Set(propsRef.current.selectedIds) : new Set<string>()
            hits.forEach((id) => next.add(id))
            propsRef.current.onSelectionChange(next)
          } else if (!selectionBox.additive) {
            propsRef.current.onSelectionChange(new Set())
          }
          selectionBoxRef.current = null
          drawScene(world, propsRef, dragRef, cameraRef, selectionBoxRef)
        }
        dragRef.current = null
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
      drawScene(world, propsRef, dragRef, cameraRef, selectionBoxRef)
    })

    return () => {
      disposed = true
      appRef.current = null
      worldRef.current = null
      if (initialized) app.destroy(true, { children: true })
    }
  }, [])

  useEffect(() => {
    const world = worldRef.current
    if (world) drawScene(world, propsRef, dragRef, cameraRef, selectionBoxRef)
  }, [props.gameState, props.selectedIds, props.activeTool, props.measurement, props.measurementStartId, props.spatialOverlay])

  useEffect(() => {
    if (props.resetCameraSignal > 0) fitCamera()
  }, [props.resetCameraSignal])

  return (
    <div className="canvas-host" ref={hostRef}>
      <div className="board-size-badge"><strong>60</strong> × <strong>44</strong> IN</div>
      <div className="interaction-hint">
        {props.activeTool === 'measure'
          ? props.measurementStartId ? 'Choose a second model' : 'Choose a starting model'
          : props.activeTool === 'spatial'
            ? 'Select a model or Ctrl/Cmd-click a whole unit · overlays do not restrict movement'
          : 'Click model · Shift multi-select · Ctrl/Cmd unit · Drag empty space to box select · Ctrl/Cmd+Z undo'}
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
  cameraRef: React.MutableRefObject<CameraState>,
  selectionBoxRef: React.MutableRefObject<SelectionBoxState | null>,
) {
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

  const spatialSources = props.spatialOverlay
    ? models.filter((model) => props.spatialOverlay?.sourceModelIds.includes(model.id))
    : []
  if (props.spatialOverlay?.mode === 'range' && spatialSources.length > 0) {
    drawRangeArea(world, spatialSources, props.spatialOverlay.range)
  }
  if (props.spatialOverlay?.mode === 'exclusion' && spatialSources.length > 0) {
    drawExclusionArea(
      world,
      spatialSources,
      props.spatialOverlay.requiredSeparation,
      props.spatialOverlay.targetBaseDiameterMm,
    )
  }
  if (props.spatialOverlay?.mode === 'coherency' && props.spatialOverlay.coherency) {
    drawCoherencyLinks(world, models, props.spatialOverlay.coherency.links)
  }

  for (const model of models) {
    const radius = millimetersToInches(model.base.diameterMm) / 2
    const colors = OWNER_COLORS[model.ownerId] ?? { fill: 0x8f9290, rim: 0xcfd3d0 }
    const selected = props.selectedIds.has(model.id)
    const measuring = props.measurementStartId === model.id
    const token = new Container()
    token.position.set(model.position.x, model.position.y)
    token.eventMode = 'static'
    token.cursor = props.activeTool === 'measure' ? 'crosshair' : 'grab'
    token.hitArea = new Rectangle(-radius, -radius, radius * 2, radius * 2)

    if (selected || measuring) {
      token.addChild(new Graphics().circle(0, 0, radius + 0.2).stroke({ color: measuring ? 0xf1c969 : 0xf3e4b7, width: 0.14, alpha: 0.95 }))
    }
    token.addChild(new Graphics()
      .circle(0.05, 0.08, radius).fill({ color: 0x07100d, alpha: 0.3 })
      .circle(0, 0, radius).fill(colors.fill).stroke({ color: colors.rim, width: 0.08 }))

    const label = new Text({
      text: model.label ?? '',
      style: new TextStyle({ fontFamily: 'Arial', fontSize: 16, fontWeight: '700', fill: 0xffffff }),
      resolution: 3,
    })
    label.anchor.set(0.5)
    label.scale.set(Math.max(0.33, radius * 0.62) / 16)
    label.eventMode = 'none'
    token.addChild(label)

    token.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      const currentProps = propsRef.current
      if (currentProps.activeTool === 'measure') {
        currentProps.onMeasureModel(model.id)
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
      const unit = currentProps.gameState.units.find((candidate) => candidate.id === model.unitId)
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
    world.addChild(token)
  }

  if (props.spatialOverlay?.mode === 'coherency' && props.spatialOverlay.coherency) {
    drawCoherencyStatus(world, models, props.spatialOverlay.coherency.models)
  }

  const session = props.gameState.movementSession
  if (session?.referencePath && session.referencePath.length > 1) drawMovementPath(world, session.referencePath)

  // Analysis overlays are deliberately added after model tokens. They remain
  // visually legible while staying non-interactive so model pointer events win.
  if (props.measurement) {
    const from = models.find((model) => model.id === props.measurement?.fromModelId)
    const to = models.find((model) => model.id === props.measurement?.toModelId)
    if (from && to) drawMeasurement(world, from.position, to.position, props.measurement.distanceInches)
  }

  const selectionBox = selectionBoxRef.current
  if (selectionBox?.active) drawSelectionBox(world, selectionBox.start, selectionBox.current)
}

function drawRangeArea(world: Container, models: GameState['models'], range: number) {
  const area = new Graphics()
  for (const model of models) {
    area.circle(model.position.x, model.position.y, rangeRadiusForBase(model.base, range))
  }
  area.fill({ color: 0x78b9d1, alpha: 0.13 })
  area.eventMode = 'none'
  world.addChild(area)
}

function drawExclusionArea(
  world: Container,
  models: GameState['models'],
  requiredSeparation: number,
  targetBaseDiameterMm: number,
) {
  const area = new Graphics()
  for (const model of models) {
    const radius = exclusionRadiusForTargetBase(
      model,
      { shape: 'circle', diameterMm: targetBaseDiameterMm },
      requiredSeparation,
    )
    area.circle(model.position.x, model.position.y, radius)
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
    const source = byId.get(link.sourceModelId)
    const target = byId.get(link.targetModelId)
    if (source && target) graphic.moveTo(source.position.x, source.position.y).lineTo(target.position.x, target.position.y)
  }
  graphic.stroke({ color: 0x72d6a1, width: 0.08, alpha: 0.45 })
  graphic.eventMode = 'none'
  world.addChild(graphic)
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
    const radius = baseRadiusInches(model.base)
    const ring = new Graphics()
      .circle(model.position.x, model.position.y, radius + 0.28)
      .stroke({ color: result.valid ? 0x72d6a1 : 0xff5d5d, width: result.valid ? 0.11 : 0.18, alpha: 0.98 })
    ring.eventMode = 'none'
    world.addChild(ring)
    if (!result.valid) {
      const marker = new Graphics()
        .circle(model.position.x + radius * 0.78, model.position.y - radius * 0.78, 0.24)
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
      warning.position.set(model.position.x + radius * 0.78, model.position.y - radius * 0.78 - 0.01)
      warning.eventMode = 'none'
      world.addChild(marker, warning)
    }
  }
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value))
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
