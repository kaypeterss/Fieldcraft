/// <reference lib="webworker" />

import {
  solveSmartMoveWorkerRequest,
  type SmartMoveWorkerFailure,
  type SmartMoveWorkerRequest,
  type SmartMoveWorkerResponse,
} from './smartMoveWorkerProtocol'

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<SmartMoveWorkerRequest>) => {
  const message = event.data
  try {
    workerScope.postMessage(solveSmartMoveWorkerRequest(message) satisfies SmartMoveWorkerResponse)
  } catch (error) {
    const failure: SmartMoveWorkerFailure = {
      type: 'error',
      requestId: message.requestId,
      sessionId: message.sessionId,
      stateRevision: message.stateRevision,
      kind: message.kind,
      message: error instanceof Error ? error.message : 'Unknown Smart Move worker error',
    }
    workerScope.postMessage(failure satisfies SmartMoveWorkerResponse)
  }
}

export {}
