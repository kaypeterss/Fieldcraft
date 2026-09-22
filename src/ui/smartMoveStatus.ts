import type { SmartMoveAsyncStatus } from '../tools/smartMoveWorkerController'

export function smartMoveBadge(status: SmartMoveAsyncStatus) {
  if (status === 'calculating') return { label: 'CALCULATING', tone: 'neutral' } as const
  if (status === 'ready-valid') return { label: 'VALID', tone: 'valid' } as const
  if (status === 'ready-invalid') return { label: 'INVALID', tone: 'invalid' } as const
  if (status === 'search-limit') return { label: 'SEARCH LIMIT', tone: 'warning' } as const
  if (status === 'error') return { label: 'ERROR', tone: 'invalid' } as const
  return { label: 'AWAITING TARGET', tone: 'neutral' } as const
}
