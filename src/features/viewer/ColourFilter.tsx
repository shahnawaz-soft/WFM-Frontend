import { Button } from '../../components/ui/Button'
import { TEKLA_COLOURS, type TeklaColour } from './teklaColours'

/** Review by Tekla colour: show only one colour's members (in the list and on the drawing),
 *  and step through them with Next (or the N key). */
export function ColourFilter({
  counts,
  active,
  onPick,
  onNext,
}: {
  counts: [TeklaColour, number][]
  active: TeklaColour | null
  onPick: (colour: TeklaColour | null) => void
  onNext: () => void
}) {
  const total = counts.reduce((n, [, c]) => n + c, 0)
  return (
    <div className="colour-filter" role="group" aria-label="Review by Tekla colour">
      <button type="button" aria-pressed={active === null} onClick={() => onPick(null)}>
        All <span className="family-tabs__count">{total}</span>
      </button>
      {counts.map(([key, count]) => (
        <button key={key} type="button" aria-pressed={active === key} title={TEKLA_COLOURS[key].title} onClick={() => onPick(key)}>
          <span className="colour-filter__key" style={{ background: TEKLA_COLOURS[key].colour }} aria-hidden="true" />
          {TEKLA_COLOURS[key].label.split(':')[0]} <span className="family-tabs__count">{count}</span>
        </button>
      ))}
      <Button onClick={onNext} disabled={total === 0} title="Show the next member of this colour on the drawing (key: N)">
        Next ›
      </Button>
    </div>
  )
}
