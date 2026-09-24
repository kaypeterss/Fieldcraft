import { useState } from 'react'

export function SaveAsDialog({ initialName, onConfirm, onCancel }: {
  initialName: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const valid = name.trim().length > 0
  return <div className="match-dialog-backdrop" role="presentation">
    <form className="match-dialog save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title"
      onSubmit={(event) => { event.preventDefault(); if (valid) onConfirm(name.trim()) }}>
      <span className="eyebrow">FIELDCRAFT</span>
      <h1 id="save-as-title">Save Match As</h1>
      <p className="match-dialog-intro">Create an independent copy and continue working in it.</p>
      <label className="match-name-field">New match name
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="match-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>Create Copy</button>
      </div>
    </form>
  </div>
}
