import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmartMoveRequest } from '../engine/smartMove'
import {
  solveSmartMoveWorkerRequest,
  type SmartMoveWorkerRequest,
  type SmartMoveWorkerResponse,
} from '../workers/smartMoveWorkerProtocol'
import {
  SmartMoveWorkerController,
  type SmartMoveAsyncState,
} from './smartMoveWorkerController'

class FakeWorker {
  messages: SmartMoveWorkerRequest[] = []
  terminated = false
  private messageListeners = new Set<(event: MessageEvent<SmartMoveWorkerResponse>) => void>()
  private errorListeners = new Set<(event: ErrorEvent) => void>()

  postMessage(message: SmartMoveWorkerRequest) {
    this.messages.push(structuredClone(message))
  }

  addEventListener(type: 'message' | 'error', listener: ((event: MessageEvent<SmartMoveWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === 'message') this.messageListeners.add(listener as (event: MessageEvent<SmartMoveWorkerResponse>) => void)
    else this.errorListeners.add(listener as (event: ErrorEvent) => void)
  }

  removeEventListener(type: 'message' | 'error', listener: ((event: MessageEvent<SmartMoveWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === 'message') this.messageListeners.delete(listener as (event: MessageEvent<SmartMoveWorkerResponse>) => void)
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void)
  }

  terminate() {
    this.terminated = true
  }

  complete(index = 0) {
    const response = solveSmartMoveWorkerRequest(this.messages[index])
    this.messageListeners.forEach((listener) => listener({ data: response } as MessageEvent<SmartMoveWorkerResponse>))
    return response
  }

  fail(message: SmartMoveWorkerResponse) {
    this.messageListeners.forEach((listener) => listener({ data: message } as MessageEvent<SmartMoveWorkerResponse>))
  }

  crash() {
    this.errorListeners.forEach((listener) => listener(new ErrorEvent('error')))
  }
}

const requestFor = (target: { x: number; y: number }): SmartMoveRequest => ({
  allModels: [{
    id: 'model-a',
    unitId: 'unit-a',
    ownerId: 'player-1',
    position: { x: 5, y: 5 },
    rotation: 0,
    base: { shape: 'circle', diameterMm: 25 },
    canPassOverModels: false,
  }],
  units: [{ id: 'unit-a', ownerId: 'player-1', definitionId: 'definition-a', modelIds: ['model-a'] }],
  battlefield: { width: 60, height: 44 },
  selectedModelIds: ['model-a'],
  target: { ...target },
  movementRemaining: { 'model-a': 6 },
  coherencyPolicy: { distance: 1, requiredNeighbors: 0, requireConnected: true },
})

function setup() {
  const workers: FakeWorker[] = []
  const states: SmartMoveAsyncState[] = []
  const controller = new SmartMoveWorkerController({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    onStateChange: (state) => states.push(state),
    now: () => Date.now(),
  })
  controller.beginSession(1, requestFor)
  return { controller, workers, states }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Smart Move worker execution', () => {
  it('uses the same pure solver and returns structured-clone-safe equivalent data', () => {
    const message: SmartMoveWorkerRequest = {
      type: 'solve',
      requestId: 7,
      sessionId: 3,
      stateRevision: 2,
      kind: 'locked',
      request: requestFor({ x: 10, y: 5 }),
    }
    const response = solveSmartMoveWorkerRequest(structuredClone(message))
    expect(structuredClone(response).result).toEqual(response.result)
    expect(response.result.valid).toBe(true)
    expect(response.result.target).toEqual({ x: 10, y: 5 })
  })

  it('keeps one request in flight and replaces pending targets with the latest', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    vi.advanceTimersByTime(80)
    controller.previewTarget({ x: 11, y: 5 })
    vi.advanceTimersByTime(80)
    controller.previewTarget({ x: 12, y: 5 })
    expect(workers[0].messages).toHaveLength(1)

    workers[0].complete(0)
    expect(workers[0].messages).toHaveLength(2)
    expect(workers[0].messages[1].request.target).toEqual({ x: 12, y: 5 })
    expect(states.at(-1)?.status).toBe('calculating')

    workers[0].complete(1)
    expect(states.at(-1)?.resultTarget).toEqual({ x: 12, y: 5 })
    expect(states.at(-1)?.canApply).toBe(true)
    expect(controller.getDiagnostics().pendingRequestsReplaced).toBe(1)
    expect(controller.getDiagnostics().staleResultsDiscarded).toBe(1)
    controller.dispose()
  })

  it('reduces tiny pointer jitter and still submits the exact final settle target', () => {
    const { controller, workers } = setup()
    for (let index = 0; index < 100; index += 1) {
      controller.previewTarget({ x: 10 + (index % 2) * 0.004, y: 5 + (index % 3) * 0.003 })
    }
    expect(workers[0].messages).toHaveLength(1)
    vi.advanceTimersByTime(120)
    workers[0].complete(0)
    expect(workers[0].messages).toHaveLength(2)
    expect(workers[0].messages[1].kind).toBe('settle')
    expect(workers[0].messages[1].request.target).toEqual({ x: 10.004, y: 5 })
    const diagnostics = controller.getDiagnostics()
    expect(diagnostics.rawPointerEvents).toBe(100)
    expect(diagnostics.meaningfulTargetChanges).toBe(1)
    expect(diagnostics.settleSolves).toBe(1)
    controller.dispose()
  })

  it('prioritizes an exact locked target and never applies the stale live result', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    controller.lockTarget({ x: 14.125, y: 6.75 })
    expect(controller.getApplicableResult()).toBeNull()
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].messages[0].kind).toBe('locked')
    expect(workers[1].messages[0].request.target).toEqual({ x: 14.125, y: 6.75 })
    expect(states.at(-1)?.canApply).toBe(false)
    workers[0].complete(0)
    expect(states.at(-1)?.canApply).toBe(false)
    workers[1].complete(0)
    expect(controller.getApplicableResult()?.target).toEqual({ x: 14.125, y: 6.75 })
    expect(controller.getDiagnostics().lockedExactSolves).toBe(1)
    controller.dispose()
  })

  it('gives an exact lock its longer budget even when the live target already resolved', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    workers[0].complete(0)
    expect(states.at(-1)?.status).toBe('ready-valid')
    controller.lockTarget({ x: 10, y: 5 })
    expect(states.at(-1)?.status).toBe('calculating')
    expect(states.at(-1)?.canApply).toBe(false)
    expect(workers[0].messages[1].kind).toBe('locked')
    expect(workers[0].messages[1].request.searchBudgetMs).toBe(10_000)
    workers[0].complete(1)
    expect(controller.getApplicableResult()?.valid).toBe(true)
    controller.dispose()
  })

  it('invalidates old sessions and authoritative-state revisions', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    controller.cancelSession()
    controller.beginSession(2, requestFor)
    controller.previewTarget({ x: 16, y: 5 })
    workers[0].complete(0)
    expect(workers[1].messages[0].request.target).toEqual({ x: 16, y: 5 })
    controller.updateSnapshot(3, requestFor)
    workers[1].complete(0)
    expect(workers[1].terminated).toBe(true)
    expect(workers[2].messages[0].stateRevision).toBe(3)
    expect(states.at(-1)?.canApply).toBe(false)
    workers[2].complete(0)
    expect(states.at(-1)?.canApply).toBe(true)
    expect(controller.getDiagnostics().staleResultsDiscarded).toBe(0)
    controller.dispose()
  })

  it('invalidates a ready preview when the movement policy changes without a state revision', () => {
    const { controller, workers, states } = setup()
    controller.lockTarget({ x: 10, y: 5 })
    workers[0].complete(0)
    expect(controller.getApplicableResult()?.valid).toBe(true)

    controller.updateSnapshot(1, (target) => ({
      ...requestFor(target),
      movementPolicy: { type: 'fixed-rotation-charge', rotationCharge: 2 },
    }))
    expect(states.at(-1)?.canApply).toBe(false)
    expect(controller.getApplicableResult()).toBeNull()
    expect(workers[0].messages).toHaveLength(2)
    expect(workers[0].messages[1].request.movementPolicy).toEqual({
      type: 'fixed-rotation-charge', rotationCharge: 2,
    })
    workers[0].complete(1)
    expect(controller.getApplicableResult()?.valid).toBe(true)
    controller.dispose()
  })

  it('cancels immediately and ignores a later worker result', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    vi.advanceTimersByTime(180)
    expect(states.at(-1)?.thinkingVisible).toBe(true)
    controller.cancelSession()
    expect(states.at(-1)).toMatchObject({ status: 'idle', thinkingVisible: false, result: null })
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    workers[0].complete(0)
    expect(states.at(-1)?.status).toBe('idle')
    expect(controller.getApplicableResult()).toBeNull()
    controller.dispose()
  })

  it('keeps the delayed indicator tied to the current intent when a stale result finishes', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    vi.advanceTimersByTime(80)
    controller.previewTarget({ x: 12, y: 5 })
    vi.advanceTimersByTime(100)
    expect(states.at(-1)?.thinkingVisible).toBe(true)
    workers[0].complete(0)
    expect(states.at(-1)?.thinkingVisible).toBe(true)
    workers[0].complete(1)
    expect(states.at(-1)?.thinkingVisible).toBe(false)
    controller.dispose()
  })

  it('recovers from a worker crash and exposes a compact non-applicable error', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    workers[0].crash()
    expect(workers).toHaveLength(2)
    expect(states.at(-1)).toMatchObject({
      status: 'error',
      canApply: false,
      thinkingVisible: false,
      errorMessage: 'Unable to calculate Smart Move',
    })
    expect(controller.getDiagnostics().workerErrors).toBe(1)
    controller.dispose()
  })

  it('handles a current worker-reported solve error without mutating a result', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    const request = workers[0].messages[0]
    workers[0].fail({
      type: 'error',
      requestId: request.requestId,
      sessionId: request.sessionId,
      stateRevision: request.stateRevision,
      kind: request.kind,
      message: 'test failure',
    })
    expect(states.at(-1)).toMatchObject({ status: 'error', result: null, canApply: false })
    controller.dispose()
  })

  it('ends a locked solve at its hard limit and permits an exact retry', () => {
    const { controller, workers, states } = setup()
    controller.lockTarget({ x: 10, y: 5 })
    expect(workers[0].messages[0].request.searchBudgetMs).toBe(10_000)
    vi.advanceTimersByTime(10_000)
    expect(workers[0].terminated).toBe(true)
    expect(states.at(-1)).toMatchObject({
      status: 'search-limit', result: null, canApply: false, thinkingVisible: false,
    })
    expect(controller.getApplicableResult()).toBeNull()
    workers[0].complete(0)
    expect(states.at(-1)?.status).toBe('search-limit')

    controller.lockTarget({ x: 10, y: 5 })
    expect(workers[1].messages[0].kind).toBe('locked')
    expect(states.at(-1)?.status).toBe('calculating')
    workers[1].complete(0)
    expect(controller.getApplicableResult()?.valid).toBe(true)
    controller.dispose()
  })

  it('replaces a timed-out stale live solve with the latest queued target', () => {
    const { controller, workers, states } = setup()
    controller.previewTarget({ x: 10, y: 5 })
    vi.advanceTimersByTime(80)
    controller.previewTarget({ x: 12, y: 5 })
    vi.advanceTimersByTime(920)
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].messages[0].request.target).toEqual({ x: 12, y: 5 })
    expect(states.at(-1)?.status).toBe('calculating')
    expect(controller.getApplicableResult()).toBeNull()
    workers[1].complete(0)
    expect(states.at(-1)?.status).toBe('ready-valid')
    controller.dispose()
  })

  it('uses the cooperative search budget to return a safe limit result', () => {
    const response = solveSmartMoveWorkerRequest({
      type: 'solve', requestId: 4, sessionId: 2, stateRevision: 1, kind: 'live',
      request: { ...requestFor({ x: 10, y: 5 }), searchBudgetMs: 0 },
    })
    expect(response.result.valid).toBe(false)
    expect(response.result.failureReasons).toContain('SEARCH_LIMIT')
    expect(response.result.positions).toEqual({})
  })
})
