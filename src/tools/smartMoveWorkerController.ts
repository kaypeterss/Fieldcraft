import type { Point } from '../engine/geometry/point'
import { GEOMETRY_EPSILON } from '../engine/geometry/tolerance'
import type { SmartMoveRequest, SmartMoveResult } from '../engine/smartMove'
import type {
  SmartMoveRequestKind,
  SmartMoveWorkerRequest,
  SmartMoveWorkerResponse,
} from '../workers/smartMoveWorkerProtocol'

export const SMART_MOVE_LIVE_TARGET_DISTANCE = 0.05
export const SMART_MOVE_LIVE_REQUEST_INTERVAL_MS = 80
export const SMART_MOVE_SETTLE_DELAY_MS = 120
export const SMART_MOVE_THINKING_DELAY_MS = 180

export type SmartMoveAsyncStatus = 'idle' | 'calculating' | 'ready-valid' | 'ready-invalid' | 'error'

export interface SmartMoveAsyncState {
  status: SmartMoveAsyncStatus
  result: SmartMoveResult | null
  resultTarget: Point | null
  currentTarget: Point | null
  currentKind: SmartMoveRequestKind | null
  canApply: boolean
  thinkingVisible: boolean
  errorMessage: string | null
}

export interface SmartMoveSchedulingDiagnostics {
  rawPointerEvents: number
  meaningfulTargetChanges: number
  workerRequestsSubmitted: number
  pendingRequestsReplaced: number
  staleResultsDiscarded: number
  settleSolves: number
  lockedExactSolves: number
  workerErrors: number
  solveTimesMs: number[]
  roundTripTimesMs: number[]
  roundTripOverheadMs: number[]
}

interface SmartMoveWorkerPort {
  postMessage(message: SmartMoveWorkerRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<SmartMoveWorkerResponse>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<SmartMoveWorkerResponse>) => void): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  terminate(): void
}

interface ScheduledIntent {
  message: SmartMoveWorkerRequest
  sentAt: number | null
}

interface CompletedIntent {
  requestId: number
  sessionId: number
  stateRevision: number
  target: Point
}

export interface SmartMoveWorkerControllerOptions {
  createWorker: () => SmartMoveWorkerPort
  onStateChange: (state: SmartMoveAsyncState) => void
  now?: () => number
  liveTargetDistance?: number
  liveRequestIntervalMs?: number
  settleDelayMs?: number
  thinkingDelayMs?: number
}

export const initialSmartMoveAsyncState = (): SmartMoveAsyncState => ({
  status: 'idle',
  result: null,
  resultTarget: null,
  currentTarget: null,
  currentKind: null,
  canApply: false,
  thinkingVisible: false,
  errorMessage: null,
})

export class SmartMoveWorkerController {
  private worker: SmartMoveWorkerPort
  private readonly createWorker: () => SmartMoveWorkerPort
  private readonly onStateChange: (state: SmartMoveAsyncState) => void
  private readonly now: () => number
  private readonly liveTargetDistance: number
  private readonly liveRequestIntervalMs: number
  private readonly settleDelayMs: number
  private readonly thinkingDelayMs: number
  private nextRequestId = 0
  private nextSessionId = 0
  private sessionId: number | null = null
  private stateRevision = 0
  private createRequest: ((target: Point) => SmartMoveRequest) | null = null
  private rawTarget: Point | null = null
  private lockedTarget: Point | null = null
  private lastMeaningfulTarget: Point | null = null
  private lastLiveIntentAt = Number.NEGATIVE_INFINITY
  private cadenceTarget: Point | null = null
  private currentIntent: ScheduledIntent | null = null
  private completedIntent: CompletedIntent | null = null
  private inFlight: ScheduledIntent | null = null
  private pending: ScheduledIntent | null = null
  private cadenceTimer: ReturnType<typeof setTimeout> | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null
  private state = initialSmartMoveAsyncState()
  private diagnostics: SmartMoveSchedulingDiagnostics = createDiagnostics()
  private disposed = false

  private readonly handleMessage = (event: MessageEvent<SmartMoveWorkerResponse>) => {
    const response = event.data
    if (!this.inFlight || response.requestId !== this.inFlight.message.requestId) {
      this.diagnostics.staleResultsDiscarded += 1
      return
    }

    const completed = this.inFlight
    this.inFlight = null
    const roundTripMs = completed.sentAt === null ? 0 : Math.max(0, this.now() - completed.sentAt)
    if (response.type === 'result') {
      appendSample(this.diagnostics.solveTimesMs, response.solveTimeMs)
      appendSample(this.diagnostics.roundTripTimesMs, roundTripMs)
      appendSample(this.diagnostics.roundTripOverheadMs, Math.max(0, roundTripMs - response.solveTimeMs))
    }

    if (this.isCurrentResponse(response)) {
      if (response.type === 'result') {
        this.completedIntent = {
          requestId: response.requestId,
          sessionId: response.sessionId,
          stateRevision: response.stateRevision,
          target: { ...response.result.target },
        }
        this.clearThinkingTimer()
        this.updateState({
          status: response.result.valid ? 'ready-valid' : 'ready-invalid',
          result: response.result,
          resultTarget: { ...response.result.target },
          currentTarget: { ...response.result.target },
          currentKind: response.kind,
          canApply: response.result.valid,
          thinkingVisible: false,
          errorMessage: null,
        })
      } else {
        this.diagnostics.workerErrors += 1
        this.clearThinkingTimer()
        this.updateState({
          ...this.state,
          status: 'error',
          canApply: false,
          thinkingVisible: false,
          errorMessage: 'Unable to calculate Smart Move',
        })
      }
    } else {
      this.diagnostics.staleResultsDiscarded += 1
    }

    this.sendPendingIfPossible()
  }

  private readonly handleWorkerError = () => {
    this.diagnostics.workerErrors += 1
    const failedWasCurrent = Boolean(this.inFlight && this.currentIntent
      && this.inFlight.message.requestId === this.currentIntent.message.requestId)
    this.detachWorker()
    this.inFlight = null
    if (!this.disposed) {
      this.worker = this.createWorker()
      this.attachWorker()
    }
    if (failedWasCurrent) {
      this.clearThinkingTimer()
      this.updateState({
        ...this.state,
        status: 'error',
        canApply: false,
        thinkingVisible: false,
        errorMessage: 'Unable to calculate Smart Move',
      })
    }
    this.sendPendingIfPossible()
  }

  constructor(options: SmartMoveWorkerControllerOptions) {
    this.createWorker = options.createWorker
    this.onStateChange = options.onStateChange
    this.now = options.now ?? (() => performance.now())
    this.liveTargetDistance = options.liveTargetDistance ?? SMART_MOVE_LIVE_TARGET_DISTANCE
    this.liveRequestIntervalMs = options.liveRequestIntervalMs ?? SMART_MOVE_LIVE_REQUEST_INTERVAL_MS
    this.settleDelayMs = options.settleDelayMs ?? SMART_MOVE_SETTLE_DELAY_MS
    this.thinkingDelayMs = options.thinkingDelayMs ?? SMART_MOVE_THINKING_DELAY_MS
    this.worker = this.createWorker()
    this.attachWorker()
  }

  beginSession(stateRevision: number, createRequest: (target: Point) => SmartMoveRequest) {
    if (this.inFlight) this.replaceWorker()
    this.clearTargetTimers()
    this.clearThinkingTimer()
    this.sessionId = ++this.nextSessionId
    this.stateRevision = stateRevision
    this.createRequest = createRequest
    this.rawTarget = null
    this.lockedTarget = null
    this.lastMeaningfulTarget = null
    this.lastLiveIntentAt = Number.NEGATIVE_INFINITY
    this.cadenceTarget = null
    this.currentIntent = null
    this.completedIntent = null
    this.pending = null
    this.state = initialSmartMoveAsyncState()
    this.onStateChange(this.state)
  }

  updateSnapshot(stateRevision: number, createRequest: (target: Point) => SmartMoveRequest) {
    if (this.sessionId === null) return
    this.createRequest = createRequest
    if (stateRevision === this.stateRevision) return
    this.stateRevision = stateRevision
    this.completedIntent = null
    this.pending = null
    if (this.rawTarget) {
      this.scheduleIntent(this.lockedTarget ? 'locked' : 'state-refresh', this.lockedTarget ?? this.rawTarget)
    } else {
      this.clearThinkingTimer()
      this.updateState(initialSmartMoveAsyncState())
    }
  }

  previewTarget(target: Point) {
    if (this.sessionId === null || this.lockedTarget) return
    this.diagnostics.rawPointerEvents += 1
    this.rawTarget = { ...target }
    this.resetSettleTimer()

    if (this.lastMeaningfulTarget
      && distanceBetween(this.lastMeaningfulTarget, target) < this.liveTargetDistance) return

    this.diagnostics.meaningfulTargetChanges += 1
    this.lastMeaningfulTarget = { ...target }
    const elapsed = this.now() - this.lastLiveIntentAt
    if (elapsed >= this.liveRequestIntervalMs) {
      this.clearCadenceTimer()
      this.cadenceTarget = null
      this.lastLiveIntentAt = this.now()
      this.scheduleIntent('live', target)
      return
    }

    this.cadenceTarget = { ...target }
    if (this.cadenceTimer === null) {
      this.cadenceTimer = setTimeout(() => {
        this.cadenceTimer = null
        const latest = this.cadenceTarget
        this.cadenceTarget = null
        if (!latest || this.sessionId === null || this.lockedTarget) return
        this.lastLiveIntentAt = this.now()
        this.scheduleIntent('live', latest)
      }, Math.max(0, this.liveRequestIntervalMs - elapsed))
    }
  }

  lockTarget(target: Point) {
    if (this.sessionId === null) return
    this.rawTarget = { ...target }
    this.lockedTarget = { ...target }
    this.lastMeaningfulTarget = { ...target }
    this.clearTargetTimers()
    this.cadenceTarget = null
    this.pending = null

    if (this.state.result && this.completedIntent
      && this.completedIntent.sessionId === this.sessionId
      && this.completedIntent.stateRevision === this.stateRevision
      && pointsEqual(this.completedIntent.target, target)) {
      this.currentIntent = {
        message: {
          type: 'solve',
          requestId: this.completedIntent.requestId,
          sessionId: this.completedIntent.sessionId,
          stateRevision: this.completedIntent.stateRevision,
          kind: 'locked',
          request: this.createRequest!({ ...target }),
        },
        sentAt: null,
      }
      this.clearThinkingTimer()
      this.updateState({
        ...this.state,
        status: this.state.result.valid ? 'ready-valid' : 'ready-invalid',
        currentTarget: { ...target },
        currentKind: 'locked',
        canApply: this.state.result.valid,
        thinkingVisible: false,
        errorMessage: null,
      })
      return
    }

    this.diagnostics.lockedExactSolves += 1
    if (this.inFlight
      && !pointsEqual(this.inFlight.message.request.target, target)) {
      this.replaceWorker()
    }
    this.scheduleIntent('locked', target)
  }

  cancelSession() {
    if (this.inFlight) this.replaceWorker()
    this.clearTargetTimers()
    this.clearThinkingTimer()
    this.sessionId = null
    this.createRequest = null
    this.rawTarget = null
    this.lockedTarget = null
    this.lastMeaningfulTarget = null
    this.cadenceTarget = null
    this.currentIntent = null
    this.completedIntent = null
    this.pending = null
    this.state = initialSmartMoveAsyncState()
    this.onStateChange(this.state)
  }

  getApplicableResult() {
    return this.state.canApply && this.state.result && this.currentIntent && this.completedIntent
      && this.currentIntent.message.requestId === this.completedIntent.requestId
      && this.currentIntent.message.sessionId === this.completedIntent.sessionId
      && this.currentIntent.message.stateRevision === this.completedIntent.stateRevision
      ? this.state.result
      : null
  }

  getRawTarget() {
    return this.rawTarget ? { ...this.rawTarget } : null
  }

  getDiagnostics(): SmartMoveSchedulingDiagnostics {
    return {
      ...this.diagnostics,
      solveTimesMs: [...this.diagnostics.solveTimesMs],
      roundTripTimesMs: [...this.diagnostics.roundTripTimesMs],
      roundTripOverheadMs: [...this.diagnostics.roundTripOverheadMs],
    }
  }

  dispose() {
    this.disposed = true
    this.clearTargetTimers()
    this.clearThinkingTimer()
    this.detachWorker()
    this.worker.terminate()
  }

  private scheduleIntent(kind: SmartMoveRequestKind, target: Point) {
    if (this.sessionId === null || !this.createRequest) return
    if (this.currentIntent
      && this.currentIntent.message.sessionId === this.sessionId
      && this.currentIntent.message.stateRevision === this.stateRevision
      && pointsEqual(this.currentIntent.message.request.target, target)) return

    const wasCalculating = this.state.status === 'calculating'
    const intent: ScheduledIntent = {
      message: {
        type: 'solve',
        requestId: ++this.nextRequestId,
        sessionId: this.sessionId,
        stateRevision: this.stateRevision,
        kind,
        request: this.createRequest({ ...target }),
      },
      sentAt: null,
    }
    this.currentIntent = intent
    this.updateState({
      ...this.state,
      status: 'calculating',
      currentTarget: { ...target },
      currentKind: kind,
      canApply: false,
      errorMessage: null,
    })
    if (!wasCalculating) this.startThinkingTimer()

    if (!this.inFlight) {
      this.send(intent)
    } else {
      if (this.pending) this.diagnostics.pendingRequestsReplaced += 1
      this.pending = intent
    }
  }

  private send(intent: ScheduledIntent) {
    intent.sentAt = this.now()
    this.inFlight = intent
    this.diagnostics.workerRequestsSubmitted += 1
    try {
      this.worker.postMessage(intent.message)
    } catch {
      this.handleWorkerError()
    }
  }

  private sendPendingIfPossible() {
    if (this.inFlight || !this.pending) return
    const pending = this.pending
    this.pending = null
    if (!this.currentIntent || pending.message.requestId !== this.currentIntent.message.requestId) {
      this.diagnostics.staleResultsDiscarded += 1
      return
    }
    this.send(pending)
  }

  private isCurrentResponse(response: SmartMoveWorkerResponse) {
    return this.sessionId !== null
      && this.currentIntent !== null
      && response.requestId === this.currentIntent.message.requestId
      && response.sessionId === this.sessionId
      && response.stateRevision === this.stateRevision
  }

  private resetSettleTimer() {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      if (this.sessionId === null || this.lockedTarget || !this.rawTarget) return
      const target = this.rawTarget
      if (this.currentIntent
        && this.currentIntent.message.sessionId === this.sessionId
        && this.currentIntent.message.stateRevision === this.stateRevision
        && pointsEqual(this.currentIntent.message.request.target, target)) return
      this.diagnostics.settleSolves += 1
      this.scheduleIntent('settle', target)
    }, this.settleDelayMs)
  }

  private startThinkingTimer() {
    this.clearThinkingTimer()
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = null
      if (this.state.status !== 'calculating' || this.sessionId === null) return
      this.updateState({ ...this.state, thinkingVisible: true })
    }, this.thinkingDelayMs)
  }

  private clearCadenceTimer() {
    if (this.cadenceTimer !== null) clearTimeout(this.cadenceTimer)
    this.cadenceTimer = null
  }

  private clearTargetTimers() {
    this.clearCadenceTimer()
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    this.settleTimer = null
  }

  private clearThinkingTimer() {
    if (this.thinkingTimer !== null) clearTimeout(this.thinkingTimer)
    this.thinkingTimer = null
  }

  private updateState(state: SmartMoveAsyncState) {
    this.state = state
    this.onStateChange(state)
  }

  private attachWorker() {
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
  }

  private detachWorker() {
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
  }

  private replaceWorker() {
    this.detachWorker()
    this.worker.terminate()
    this.inFlight = null
    this.pending = null
    if (!this.disposed) {
      this.worker = this.createWorker()
      this.attachWorker()
    }
  }
}

function pointsEqual(left: Point, right: Point) {
  return Math.abs(left.x - right.x) <= GEOMETRY_EPSILON
    && Math.abs(left.y - right.y) <= GEOMETRY_EPSILON
}

function distanceBetween(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function appendSample(samples: number[], value: number) {
  samples.push(value)
  if (samples.length > 100) samples.shift()
}

function createDiagnostics(): SmartMoveSchedulingDiagnostics {
  return {
    rawPointerEvents: 0,
    meaningfulTargetChanges: 0,
    workerRequestsSubmitted: 0,
    pendingRequestsReplaced: 0,
    staleResultsDiscarded: 0,
    settleSolves: 0,
    lockedExactSolves: 0,
    workerErrors: 0,
    solveTimesMs: [],
    roundTripTimesMs: [],
    roundTripOverheadMs: [],
  }
}
