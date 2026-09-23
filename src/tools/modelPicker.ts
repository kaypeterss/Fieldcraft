export type ModelPickerTarget = 'viewer' | 'target'

export interface ModelPickerSelection {
  viewerId: string | null
  targetId: string | null
}

export function cancelModelPick(current: ModelPickerSelection): ModelPickerSelection {
  return { ...current }
}

/** Completes one transient battlefield pick without changing primary selection. */
export function applyModelPick(
  pickTarget: ModelPickerTarget,
  modelId: string,
  current: ModelPickerSelection,
): ModelPickerSelection {
  if (pickTarget === 'viewer') {
    return { viewerId: modelId, targetId: current.targetId === modelId ? null : current.targetId }
  }
  return { viewerId: current.viewerId === modelId ? null : current.viewerId, targetId: modelId }
}
