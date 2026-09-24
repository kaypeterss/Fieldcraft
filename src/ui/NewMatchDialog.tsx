import { useMemo, useState } from 'react'
import type { RegisteredGameSystem } from '../gameSystem/registry'

interface NewMatchDialogProps {
  registrations: readonly RegisteredGameSystem[]
  onCreate: (gameSystemId: string, adapterVersion: string, matchName: string) => void
  onCancel: () => void
}

export function NewMatchDialog({ registrations, onCreate, onCancel }: NewMatchDialogProps) {
  const [selectedKey, setSelectedKey] = useState(() => registrationKey(registrations[0]))
  const [matchName, setMatchName] = useState('')
  const selected = useMemo(() => registrations.find((entry) => registrationKey(entry) === selectedKey), [registrations, selectedKey])

  return (
    <div className="match-dialog-backdrop" role="presentation">
      <section className="match-dialog" role="dialog" aria-modal="true" aria-labelledby="new-match-title">
        <span className="eyebrow">FIELDCRAFT</span>
        <h1 id="new-match-title">New Match</h1>
        <p className="match-dialog-intro">Choose the exact GameSystem that will own this match.</p>
        <label className="match-name-field">Match name<input value={matchName} onChange={(event) => setMatchName(event.target.value)} placeholder="Practice Match" /></label>
        <fieldset className="game-system-choices">
          <legend>Game System</legend>
          {registrations.map((registration) => {
            const key = registrationKey(registration)
            return (
              <label key={key} className={selectedKey === key ? 'game-system-choice selected' : 'game-system-choice'}>
                <input type="radio" name="game-system" value={key} checked={selectedKey === key}
                  onChange={() => setSelectedKey(key)} />
                <span>
                  <strong>{registration.gameSystem.name}</strong>
                  <small>{registration.ui.description}</small>
                </span>
              </label>
            )
          })}
        </fieldset>
        {selected && (
          <div className="match-setup-summary">
            <span className="panel-section-label">AVAILABLE CONFIGURATION</span>
            <dl>
              <div><dt>Adapter</dt><dd>{selected.gameSystem.version}</dd></div>
              {selected.ui.setupSummary.map((item) => (
                <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
              ))}
            </dl>
          </div>
        )}
        <div className="match-dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={!selected}
            onClick={() => selected && onCreate(selected.gameSystem.id, selected.gameSystem.version, matchName)}>
            Create Match
          </button>
        </div>
      </section>
    </div>
  )
}

function registrationKey(registration: RegisteredGameSystem | undefined): string {
  return registration ? `${registration.gameSystem.id}\u0000${registration.gameSystem.version}` : ''
}
