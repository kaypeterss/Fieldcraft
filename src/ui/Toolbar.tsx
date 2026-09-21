export type ActiveTool = 'select' | 'measure'

interface ToolbarProps {
  activeTool: ActiveTool
  onToolChange: (tool: ActiveTool) => void
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

export function Toolbar({ activeTool, onToolChange, onResetCamera }: ToolbarProps) {
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
      </div>
      <div className="toolbar-spacer" />
      <button className="tool-button reset" onClick={onResetCamera}>
        <ResetIcon /><span>Reset camera</span><kbd>F</kbd>
      </button>
    </nav>
  )
}
