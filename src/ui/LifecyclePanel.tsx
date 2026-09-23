import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ModelPresence } from '../domain/types'

export interface LifecyclePanelEntry {
  modelId: string
  label: string
  unitId: string
  unitName: string
  ownerId: string
  ownerName: string
  presence: ModelPresence
}

export interface LifecyclePlacementStatus {
  mode: 'individual' | 'formation'
  placedCount: number
  totalCount: number
  coherency?: Array<{ coherent: boolean; componentCount: number }>
}

type PresenceGroup = 'ON_BATTLEFIELD' | 'OFF_BOARD' | 'DESTROYED'

interface LifecyclePanelProps {
  entries: LifecyclePanelEntry[]
  selectedIds: ReadonlySet<string>
  placement: LifecyclePlacementStatus | null
  requireCoherency: boolean
  message?: string
  onClose: () => void
  onInspect: (modelId: string) => void
  onToggleModel: (modelId: string) => void
  onSelectModels: (modelIds: string[]) => void
  onClearSelection: () => void
  onMoveOffBoard: () => void
  onDestroy: () => void
  onPlaceIndividually: () => void
  onPlaceFormation: () => void
  onCancelPlacement: () => void
  onRequireCoherencyChange: (required: boolean) => void
}

export function LifecyclePanel(props: LifecyclePanelProps) {
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set())
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(() => new Set(props.entries.map((entry) => entry.ownerId)))
  const [expandedPresence, setExpandedPresence] = useState<Set<string>>(() => new Set(
    groupedPlayers(props.entries).map((player) => `${player.ownerId}:ON_BATTLEFIELD`),
  ))
  const selected = props.entries.filter((entry) => props.selectedIds.has(entry.modelId))
  const selectedActive = selected.filter((entry) => entry.presence === 'ON_BATTLEFIELD').length
  const selectedInactive = selected.length - selectedActive
  return <aside className="lifecycle-panel" aria-label="Development lifecycle">
    <div className="lifecycle-panel-heading">
      <div><span className="eyebrow">M9 QA TOOL</span><h2>Lifecycle</h2></div>
      <button type="button" className="panel-close" aria-label="Close Lifecycle" onClick={props.onClose}>×</button>
    </div>
    <div className="lifecycle-selection-summary">
      <strong>{selected.length} selected</strong>
      <button type="button" onClick={props.onClearSelection} disabled={selected.length === 0}>Clear</button>
    </div>
    <div className="lifecycle-actions">
      <button type="button" onClick={props.onMoveOffBoard} disabled={selectedActive === 0}>
        Move Off Board ({selected.length})
      </button>
      <button type="button" onClick={props.onDestroy} disabled={selectedActive === 0}>
        Destroy Selected ({selected.length})
      </button>
      <button type="button" onClick={props.onPlaceIndividually} disabled={selectedInactive === 0}>
        Place Individually ({selected.length})
      </button>
      <button type="button" onClick={props.onPlaceFormation} disabled={selectedInactive === 0}>
        Place as Formation ({selected.length})
      </button>
    </div>
    <label className="lifecycle-coherency-toggle">
      <input type="checkbox" checked={props.requireCoherency}
        onChange={(event) => props.onRequireCoherencyChange(event.target.checked)} />
      Require final unit coherency
    </label>
    {props.placement && <div className="lifecycle-placement-mode">
      <strong>{props.placement.mode === 'formation' ? 'Formation placement' : 'Individual placement'}</strong>
      <span>{props.placement.mode === 'formation'
        ? `${props.placement.totalCount} models · click to commit formation`
        : `Position ${props.placement.placedCount + 1} of ${props.placement.totalCount} · final commit is atomic`}</span>
      {props.placement.coherency && props.placement.coherency.length > 0 && <span className="lifecycle-placement-coherency">
        Projected coherency: {props.placement.coherency.every((entry) => entry.coherent) ? 'Valid' : 'Invalid'}
        {props.placement.coherency.some((entry) => entry.componentCount > 1) ? ' · disconnected' : ''}
      </span>}
      {/* Do not pass the browser click event into the status-message callback. */}
      <button type="button" onClick={() => props.onCancelPlacement()}>Cancel placement</button>
    </div>}
    <div className="lifecycle-groups">
      {groupedPlayers(props.entries).map((player) => {
        const playerExpanded = expandedPlayers.has(player.ownerId)
        return <details className="lifecycle-player" key={player.ownerId} open={playerExpanded}
          onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setExpandedPlayers((current) => {
            const next = new Set(current)
            if (open) next.add(player.ownerId)
            else next.delete(player.ownerId)
            return next
          }) }}>
          <summary><span aria-hidden="true">{playerExpanded ? '▾' : '▸'}</span>
            <strong>{player.ownerName}</strong><small>{player.entries.length} models · {player.units.length} units</small></summary>
          {PRESENCE_GROUPS.map((group) => {
            const units = groupedUnits(player.entries).filter((unit) => unitPresence(unit.entries) === group.presence)
            if (units.length === 0) return null
            const expanded = expandedPresence.has(`${player.ownerId}:${group.presence}`)
            const modelCount = units.reduce((total, unit) => total + unit.entries.length, 0)
            return <details className="lifecycle-group" key={group.presence} open={expanded}
              onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setExpandedPresence((current) => {
                const next = new Set(current)
                const key = `${player.ownerId}:${group.presence}`
                if (open) next.add(key)
                else next.delete(key)
                return next
              }) }}>
              <summary><span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{group.label} · {units.length} units · {modelCount} models</summary>
              <div className="lifecycle-unit-list">{units.map((unit) => <UnitRow key={unit.unitId} unit={unit}
                expandedUnits={expandedUnits} setExpandedUnits={setExpandedUnits} props={props} />)}</div>
            </details>
          })}
        </details>
      })}
    </div>
    {props.message && <p className="lifecycle-feedback" role="status">{props.message}</p>}
  </aside>
}

function groupedUnits(entries: LifecyclePanelEntry[]) {
  const groups = new Map<string, { unitId: string; unitName: string; entries: LifecyclePanelEntry[] }>()
  for (const entry of entries) {
    const group = groups.get(entry.unitId) ?? { unitId: entry.unitId, unitName: entry.unitName, entries: [] }
    group.entries.push(entry)
    groups.set(entry.unitId, group)
  }
  return [...groups.values()].sort((left, right) => left.unitName.localeCompare(right.unitName))
}

const PRESENCE_GROUPS: Array<{ presence: PresenceGroup; label: string }> = [
  { presence: 'ON_BATTLEFIELD', label: 'ON BATTLEFIELD' },
  { presence: 'OFF_BOARD', label: 'OFF BOARD / RESERVE' },
  { presence: 'DESTROYED', label: 'DESTROYED' },
]

function groupedPlayers(entries: LifecyclePanelEntry[]) {
  const groups = new Map<string, { ownerId: string; ownerName: string; entries: LifecyclePanelEntry[]; units: ReturnType<typeof groupedUnits> }>()
  for (const entry of entries) {
    const group = groups.get(entry.ownerId) ?? { ownerId: entry.ownerId, ownerName: entry.ownerName, entries: [], units: [] }
    group.entries.push(entry)
    groups.set(entry.ownerId, group)
  }
  return [...groups.values()].map((group) => ({ ...group, units: groupedUnits(group.entries) }))
    .sort((left, right) => left.ownerName.localeCompare(right.ownerName))
}

function unitPresence(entries: LifecyclePanelEntry[]): PresenceGroup {
  if (entries.some((entry) => entry.presence === 'ON_BATTLEFIELD')) return 'ON_BATTLEFIELD'
  if (entries.some((entry) => entry.presence === 'OFF_BOARD')) return 'OFF_BOARD'
  return 'DESTROYED'
}

function UnitRow({ unit, expandedUnits, setExpandedUnits, props }: {
  unit: { unitId: string; unitName: string; entries: LifecyclePanelEntry[] }
  expandedUnits: ReadonlySet<string>
  setExpandedUnits: Dispatch<SetStateAction<Set<string>>>
  props: LifecyclePanelProps
}) {
  const expanded = expandedUnits.has(unit.unitId)
  const counts = presenceCounts(unit.entries)
  return <section className="lifecycle-unit">
    <div className="lifecycle-unit-heading">
      <button type="button" className="lifecycle-unit-toggle" aria-expanded={expanded}
        onClick={() => setExpandedUnits((current) => {
          const next = new Set(current)
          if (next.has(unit.unitId)) next.delete(unit.unitId)
          else next.add(unit.unitId)
          return next
        })}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span><strong>{unit.unitName}</strong><small>{unit.entries.length} models · {presenceSummary(counts)}</small></span>
      </button>
      <button type="button" className="lifecycle-unit-select" onClick={() => props.onSelectModels(unit.entries.map((entry) => entry.modelId))}>Select Unit</button>
    </div>
    {expanded && <div className="lifecycle-unit-models">{unit.entries.map((entry) => <article className="lifecycle-entry" key={entry.modelId}>
      <input type="checkbox" aria-label={`Select ${entry.label}`} checked={props.selectedIds.has(entry.modelId)} onChange={() => props.onToggleModel(entry.modelId)} />
      <button type="button" className="lifecycle-entry-identity" onClick={() => props.onInspect(entry.modelId)}>
        <strong>{entry.label}</strong><span>{entry.modelId}</span><small>{entry.ownerName} · {presenceLabel(entry.presence)}</small>
      </button>
    </article>)}</div>}
  </section>
}

function presenceCounts(entries: LifecyclePanelEntry[]) {
  return entries.reduce((counts, entry) => {
    counts[entry.presence] += 1
    return counts
  }, { ON_BATTLEFIELD: 0, OFF_BOARD: 0, DESTROYED: 0 })
}

function presenceSummary(counts: ReturnType<typeof presenceCounts>) {
  return [
    counts.ON_BATTLEFIELD > 0 && `${counts.ON_BATTLEFIELD} Battlefield`,
    counts.OFF_BOARD > 0 && `${counts.OFF_BOARD} Off Board`,
    counts.DESTROYED > 0 && `${counts.DESTROYED} Destroyed`,
  ].filter(Boolean).join(' · ')
}

function presenceLabel(presence: ModelPresence) {
  return presence === 'ON_BATTLEFIELD' ? 'On Battlefield'
    : presence === 'OFF_BOARD' ? 'Off Board / Reserve' : 'Destroyed'
}
