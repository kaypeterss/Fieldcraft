export function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return <div className="match-dialog-backdrop" role="presentation"><section className="match-dialog" role="alertdialog" aria-labelledby="unsaved-title">
    <span className="eyebrow">MATCH CHANGES</span><h1 id="unsaved-title">Unsaved changes</h1>
    <p className="match-dialog-intro">Save this match before leaving it?</p>
    <div className="match-dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onDiscard}>Discard</button><button type="button" className="primary" onClick={onSave}>Save</button></div>
  </section></div>
}
