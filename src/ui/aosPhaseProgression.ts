export function aosPhaseProgressionBlockReason(
  hasStagedMovement: boolean,
  hasSmartMovePreview: boolean,
  hasUnresolvedCombat = false,
): string | undefined {
  if (hasStagedMovement) return 'Confirm or cancel the staged movement before ending the phase.'
  if (hasSmartMovePreview) return 'Apply or cancel the Smart Move preview before ending the phase.'
  if (hasUnresolvedCombat) return 'Resolve all required Fights before ending the phase.'
  return undefined
}
