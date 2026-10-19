export type ViewerTab = 'quantities' | 'flags' | 'scale' | 'level' | 'page'

const TABS: { id: ViewerTab; label: string; glyph: string }[] = [
  { id: 'quantities', label: 'Quantities', glyph: '▤' },
  { id: 'flags', label: 'Flags', glyph: '⚑' },
  { id: 'scale', label: 'Scale', glyph: '⇔' },
  { id: 'level', label: 'Level', glyph: '⊥' },
  { id: 'page', label: 'Page', glyph: '▢' },
]

interface ViewerRailProps {
  active: ViewerTab
  open: boolean
  counts: Partial<Record<ViewerTab, number>>
  onChange: (tab: ViewerTab) => void
}

/** Vertical tab list. Selecting the open tab again collapses the panel. */
export function ViewerRail({ active, open, counts, onChange }: ViewerRailProps) {
  return (
    <div className="rail" role="tablist" aria-orientation="vertical" aria-label="Page tools">
      {TABS.map((tab) => {
        const selected = open && tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls="viewer-panel"
            className="rail__tab"
            onClick={() => onChange(tab.id)}
          >
            <span className="rail__glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            <span className="rail__label">{tab.label}</span>
            {counts[tab.id] ? <span className="rail__count">{counts[tab.id]}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
