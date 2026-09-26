export function aosPhaseProgressionBlockReason(
  hasStagedMovement: boolean,
  hasSmartMovePreview: boolean,
): string | undefined {
  if (hasStagedMovement) return 'Confirm or cancel the staged movement before ending the phase.'
  if (hasSmartMovePreview) return 'Apply or cancel the Smart Move preview before ending the phase.'
  return undefined
}

