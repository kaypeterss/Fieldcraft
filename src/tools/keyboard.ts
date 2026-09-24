export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.contentEditable === 'true' || target.getAttribute('contenteditable') !== null || target.closest('[contenteditable]')) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export type FormationShortcut = 'previous' | 'next' | 'rotate-left' | 'rotate-right' | null

/** Formation shortcuts are intentionally arrow-only; callers still gate them
 * to an active formation-placement session and editable-target safety. */
export function formationShortcutForEvent(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): FormationShortcut {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'ArrowUp') return 'previous'
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowLeft') return 'rotate-left'
  if (event.key === 'ArrowRight') return 'rotate-right'
  return null
}

export function isUndoMovementShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.key.toLowerCase() === 'z'
    && !event.shiftKey
    && !event.altKey
}
