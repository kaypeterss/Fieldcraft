export interface NumericDraftOptions {
  min: number
  integer?: boolean
  fallback: number
}

/** Converts an editable draft into a safe committed value without producing NaN. */
export function normalizeNumericDraft(draft: string, options: NumericDraftOptions): number {
  const parsed = Number(draft.trim())
  if (draft.trim() === '' || !Number.isFinite(parsed)) return options.fallback
  const normalized = options.integer ? Math.trunc(parsed) : parsed
  return Math.max(options.min, normalized)
}

export function formatNumericValue(value: number, integer = false): string {
  return String(integer ? Math.trunc(value) : value)
}
