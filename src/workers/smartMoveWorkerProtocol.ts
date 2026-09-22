import { solveSmartMove, type SmartMoveRequest, type SmartMoveResult } from '../engine/smartMove'

export type SmartMoveRequestKind = 'live' | 'settle' | 'locked' | 'state-refresh'

export interface SmartMoveWorkerRequest {
  type: 'solve'
  requestId: number
  sessionId: number
  stateRevision: number
  kind: SmartMoveRequestKind
  request: SmartMoveRequest
}

export interface SmartMoveWorkerSuccess {
  type: 'result'
  requestId: number
  sessionId: number
  stateRevision: number
  kind: SmartMoveRequestKind
  result: SmartMoveResult
  solveTimeMs: number
}

export interface SmartMoveWorkerFailure {
  type: 'error'
  requestId: number
  sessionId: number
  stateRevision: number
  kind: SmartMoveRequestKind
  message: string
}

export type SmartMoveWorkerResponse = SmartMoveWorkerSuccess | SmartMoveWorkerFailure

export function solveSmartMoveWorkerRequest(message: SmartMoveWorkerRequest): SmartMoveWorkerSuccess {
  const startedAt = nowMilliseconds()
  return {
    type: 'result',
    requestId: message.requestId,
    sessionId: message.sessionId,
    stateRevision: message.stateRevision,
    kind: message.kind,
    result: solveSmartMove(message.request),
    solveTimeMs: nowMilliseconds() - startedAt,
  }
}

function nowMilliseconds() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
