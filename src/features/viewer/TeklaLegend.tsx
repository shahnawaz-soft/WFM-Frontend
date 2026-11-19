import { colourCounts, TEKLA_COLOURS, type TeklaColour } from './teklaColours'

/** The Tekla colours in use, with how many members have each. */
export function TeklaLegend({ colours }: { colours: Iterable<TeklaColour | null> }) {
  const counts = colourCounts(colours)
  return (
    <ul className="legend" aria-label="Tekla colours">
      {counts.map(([key, count]) => (
        <li key={key} title={TEKLA_COLOURS[key].title}>
          <svg width="22" height="12" aria-hidden="true">
            <line x1="1" y1="6" x2="21" y2="6" stroke={TEKLA_COLOURS[key].colour} strokeWidth="3" />
          </svg>
          {TEKLA_COLOURS[key].label} ({count})
        </li>
      ))}
    </ul>
  )
}
