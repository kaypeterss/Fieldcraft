/** Mutually exclusive primary pointer interactions. Spatial is an independent overlay. */
export type ActiveTool = 'select' | 'measure' | 'smart-move'

interface ToolbarProps {
  activeTool: ActiveTool
  spatialEnabled: boolean
  diceOpen: boolean
  lifecycleOpen: boolean
  onToolChange: (tool: ActiveTool) => void
  onSpatialToggle: () => void
  onDiceToggle: () => void
  onLifecycleToggle: () => void
  onResetCamera: () => void
}

function SelectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 3 14 8-6.1 2.1L10.8 19 5 3Z" />
    </svg>
  )
}

function MeasureIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 16.5 16.5 4 20 7.5 7.5 20 4 16.5Z" />
      <path d="m13.8 6.7 3.5 3.5M11 9.5l2 2M8.2 12.3l3.5 3.5" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.8 8.3A8 8 0 1 1 4 14" />
      <path d="M4 4v5h5" />
    </svg>
  )
}

function SpatialIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" strokeDasharray="2.2 2.2" />
    </svg>
  )
}

function SmartMoveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="8" r="2.2" />
      <circle cx="7" cy="16" r="2.2" />
      <path d="M11 12h8M16 9l3 3-3 3" />
    </svg>
  )
}

function DiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8" cy="8" r=".8" fill="currentColor" stroke="none" />
      <circle cx="16" cy="8" r=".8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r=".8" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r=".8" fill="currentColor" stroke="none" />
    </svg>
  )
}

function LifecycleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 6h14M5 12h14M5 18h14" />
    <circle cx="8" cy="6" r="1.5" /><circle cx="16" cy="12" r="1.5" /><circle cx="10" cy="18" r="1.5" />
  </svg>
}

export function Toolbar({ activeTool, spatialEnabled, diceOpen, lifecycleOpen, onToolChange, onSpatialToggle, onDiceToggle, onLifecycleToggle, onResetCamera }: ToolbarProps) {
  return (
    <nav className="toolbar" aria-label="Tabletop tools">
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <div className="tool-group">
        <button
          className={activeTool === 'select' ? 'tool-button active' : 'tool-button'}
          onClick={() => onToolChange('select')}
          aria-pressed={activeTool === 'select'}
        >
          <SelectIcon /><span>Select</span><kbd>V</kbd>
        </button>
        <button
          className={activeTool === 'measure' ? 'tool-button active' : 'tool-button'}
          onClick={() => onToolChange('measure')}
          aria-pressed={activeTool === 'measure'}
        >
          <MeasureIcon /><span>Measure</span><kbd>M</kbd>
        </button>
        <button
          className={spatialEnabled ? 'tool-button active' : 'tool-button'}
          onClick={onSpatialToggle}
          aria-pressed={spatialEnabled}
        >
          <SpatialIcon /><span>Spatial</span><kbd>S</kbd>
        </button>
        <button
          className={activeTool === 'smart-move' ? 'tool-button active' : 'tool-button'}
          onClick={() => onToolChange('smart-move')}
          aria-pressed={activeTool === 'smart-move'}
        >
          <SmartMoveIcon /><span>Smart Move</span><kbd>G</kbd>
        </button>
        <button
          className={diceOpen ? 'tool-button active' : 'tool-button'}
          onClick={onDiceToggle}
          aria-pressed={diceOpen}
        >
          <DiceIcon /><span>Dice</span>
        </button>
        <button
          className={lifecycleOpen ? 'tool-button active' : 'tool-button'}
          onClick={onLifecycleToggle}
          aria-pressed={lifecycleOpen}
        >
          <LifecycleIcon /><span>Lifecycle</span>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <button className="tool-button reset" onClick={onResetCamera}>
        <ResetIcon /><span>Reset camera</span><kbd>F</kbd>
      </button>
    </nav>
  )
}
