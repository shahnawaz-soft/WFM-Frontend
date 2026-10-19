import { Fragment } from 'react'

import type { AbmTotals } from '../../api/types'
import { Button } from '../../components/ui/Button'
import type { FilterState } from './filters'
import { feetInches, formatKg, formatLb, formatTonnes, formatTons, lbValue, type Amounts } from './format'

interface AbmTotalsViewProps {
  totals: AbmTotals
  /** Show the entries behind a number (switches to the entry list with these filters). */
  onShow: (filters: Partial<FilterState>) => void
}

type Group = AbmTotals['groups'][number]

const sumLb = (groups: Group[], key: 'reviewed' | 'incomplete') =>
  groups.reduce((n, g) => n + (g[key] ? Number((g[key] as Amounts).lb) : 0), 0)

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Project tonnage (PRD §4.4). Only the reviewed bucket is called a total; everything else
 *  is labelled as not final and links to the entries that need attention. */
export function AbmTotalsView({ totals, onShow }: AbmTotalsViewProps) {
  const { reviewed, incomplete, not_weighed: notWeighed } = totals
  const reasons = notWeighed.reasons
  const byProfile = new Map<string, Group[]>()
  for (const g of totals.groups) byProfile.set(g.profile, [...(byProfile.get(g.profile) ?? []), g])

  return (
    <div className="tonnage">
      <div className="tonnage__cards">
        <section className="tonnage__card tonnage__card--total" aria-labelledby="t-reviewed">
          <h3 id="t-reviewed">Reviewed total</h3>
          <p className="tonnage__value">{formatTons(reviewed.weight)}</p>
          <p>
            {formatTonnes(reviewed.weight)} · {formatLb(reviewed.weight)} · {formatKg(reviewed.weight)}
          </p>
          <p className="muted">
            {plural(reviewed.entries, 'accepted entry', 'accepted entries')} (quantity {reviewed.quantity.toLocaleString()})
          </p>
        </section>

        <section className="tonnage__card tonnage__card--incomplete" aria-labelledby="t-incomplete">
          <h3 id="t-incomplete">Not final: awaiting review</h3>
          <p className="tonnage__value">{formatTons(incomplete.weight)}</p>
          <p>
            {formatTonnes(incomplete.weight)} · {formatLb(incomplete.weight)}
          </p>
          {incomplete.entries > 0 ? (
            <Button onClick={() => onShow({ status: 'open' })}>
              Show {plural(incomplete.entries, 'entry', 'entries')} to review
            </Button>
          ) : (
            <p className="muted">Nothing weighed is waiting for review.</p>
          )}
        </section>

        <section className="tonnage__card tonnage__card--missing" aria-labelledby="t-missing">
          <h3 id="t-missing">Not weighed</h3>
          <p className="tonnage__value">{plural(notWeighed.entries, 'entry', 'entries')}</p>
          {notWeighed.entries === 0 ? (
            <p className="muted">Every entry has a section and a length.</p>
          ) : (
            <ul className="tonnage__reasons">
              {reasons.no_length.entries > 0 && (
                <li>
                  <button type="button" className="link-button" onClick={() => onShow({ length_missing: true, match: 'matched' })}>
                    {plural(reasons.no_length.entries, 'without a length', 'without a length')}
                  </button>
                </li>
              )}
              {reasons.not_in_section_data.entries > 0 && (
                <li>
                  <button type="button" className="link-button" onClick={() => onShow({ match: 'unmatched,ambiguous,no_section_data' })}>
                    {plural(reasons.not_in_section_data.entries, 'not in section data', 'not in section data')}
                  </button>
                </li>
              )}
              {reasons.unsupported.entries > 0 && (
                <li>
                  <button type="button" className="link-button" onClick={() => onShow({ match: 'unsupported' })}>
                    {plural(reasons.unsupported.entries, 'unsupported type', 'unsupported types')}
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {totals.not_in_tonnage.entries > 0 && (
        <p className="muted" role="note">
          <button type="button" className="link-button" onClick={() => onShow({ match: 'not_in_tonnage' })}>
            {plural(totals.not_in_tonnage.entries, 'joist entry', 'joist entries')}
          </button>{' '}
          (quantity {totals.not_in_tonnage.quantity.toLocaleString()}
          {totals.not_in_tonnage.length_mm ? `, ${feetInches(totals.not_in_tonnage.length_mm)} in all` : ''}) are counted in the ABM
          but not in the tonnage.
        </p>
      )}

      <p className={totals.complete ? 'notice notice--success' : 'muted'} role="status">
        {totals.complete
          ? 'Every entry is reviewed and weighed: the reviewed total is complete.'
          : `The reviewed total is not complete yet. Including entries awaiting review, the estimate is ${formatTons(totals.estimate_all_weighed)} (${formatTonnes(totals.estimate_all_weighed)}); entries that cannot be weighed are not included.`}
      </p>

      <div className="abm__table">
        <table className="table table--compact tonnage__groups">
          <caption className="visually-hidden">Quantities and weights by section</caption>
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col" className="num">
                Entries
              </th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Total length
              </th>
              <th scope="col" className="num">
                lb/ft
              </th>
              <th scope="col" className="num">
                Reviewed (lb)
              </th>
              <th scope="col" className="num">
                Not final (lb)
              </th>
              <th scope="col" className="num">
                Not weighed
              </th>
            </tr>
          </thead>
          <tbody>
            {[...byProfile.entries()].map(([profile, groups]) => (
              <Fragment key={profile}>
                {groups.map((g) => (
                  <tr key={g.designation}>
                    <th scope="row">
                      <button
                        type="button"
                        className="link-button"
                        aria-label={`${g.designation}: show its entries`}
                        onClick={() => onShow({ designation: g.designation })}
                      >
                        {g.designation}
                      </button>
                    </th>
                    <td className="num">{g.entries}</td>
                    <td className="num">{g.quantity}</td>
                    <td className="num nowrap">
                      {feetInches(g.measured_length_mm) ?? '—'}
                      {g.unmeasured > 0 && g.measured_length_mm != null && <span className="muted"> +{g.unmeasured} unmeasured</span>}
                    </td>
                    <td className="num">{g.unit_weight_lb_per_ft ? Number(g.unit_weight_lb_per_ft) : '—'}</td>
                    <td className="num">{lbValue(g.reviewed) ?? '—'}</td>
                    <td className="num">{lbValue(g.incomplete) ?? '—'}</td>
                    <td className="num">{g.counted_in_tonnage ? g.not_weighed || '—' : <span className="muted">Not in tonnage</span>}</td>
                  </tr>
                ))}
                <tr className="tonnage__subtotal">
                  <th scope="row">{profile} subtotal</th>
                  <td className="num">{groups.reduce((n, g) => n + g.entries, 0)}</td>
                  <td className="num">{groups.reduce((n, g) => n + g.quantity, 0)}</td>
                  <td />
                  <td />
                  <td className="num">{Math.round(sumLb(groups, 'reviewed')).toLocaleString('en-US')}</td>
                  <td className="num">{Math.round(sumLb(groups, 'incomplete')).toLocaleString('en-US')}</td>
                  <td className="num">{groups.reduce((n, g) => n + g.not_weighed, 0) || '—'}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted tonnage__units">
        Units: lengths in feet-inches (centre-to-centre of supports); weights in lb and kg; tonnage in US tons (2,000 lb)
        and metric tonnes. Unit weights from {totals.section_dataset ?? 'no section data (none approved yet)'}.
      </p>
    </div>
  )
}
