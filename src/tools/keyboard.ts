export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.contentEditable === 'true' || target.getAttribute('contenteditable') !== null || target.closest('[contenteditable]')) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function isUndoMovementShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.key.toLowerCase() === 'z'
    && !event.shiftKey
    && !event.altKey
}
