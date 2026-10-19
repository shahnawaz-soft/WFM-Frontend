import type { ExtractionRun } from '../../../api/types'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import { feetInches } from '../../abm/format'

export function ScalePanel({ run }: { run: ExtractionRun | null }) {
  const scales = run?.summary.scales_found ?? []
  const check = run?.scale_check ?? null
  const spacings = run?.grid_spacings ?? []
  // The engine read "not to scale" on the sheet (``review_reasons``): say so, not just "not found".
  const notToScale = !!run && !run.scale_text && run.review_reasons.some((r) => r.code === 'not_to_scale')
  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Scale</h2>
        <p className="muted">Read from the scale statements printed on the sheet, and checked against its printed dimensions.</p>
      </div>
      {!run && <p className="muted">Run Plan on this page to read its scale.</p>}
      {run && (
        <>
          <p className="scale-value">
            {run.scale_text || (notToScale ? 'Not to scale' : 'Not found')}{' '}
            {notToScale ? (
              <StatusBadge tone="info" label="Marked on the drawing" />
            ) : !run.scale_text ? (
              <StatusBadge tone="warning" label="Check" />
            ) : check?.verdict === 'confirmed' ? (
              <StatusBadge tone="success" label="Confirmed by dimensions" />
            ) : check?.verdict === 'disagrees' ? (
              <StatusBadge tone="error" label="Dimensions disagree" />
            ) : run.scale_confidence !== null && run.scale_confidence < 0.7 ? (
              <StatusBadge tone="warning" label="Confirm" />
            ) : (
              <StatusBadge tone="success" label="Single scale on sheet" />
            )}
          </p>
          {notToScale && (
            <p>
              The drawing marks this sheet or its views “not to scale”, so lengths can’t be measured from it. Enter lengths
              by hand, or take them from a plan that has a scale.
            </p>
          )}
          {check && !notToScale && <p>{describeCheck(check, run.scale_text)}</p>}
          {scales.length > 1 && (
            <>
              <p>This sheet states several scales; the smallest (usually the plan) was assumed:</p>
              <ul>
                {scales.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {spacings.length > 0 && (
            <table className="table table--compact">
              <caption>Grid spacing, as printed</caption>
              <thead>
                <tr>
                  <th scope="col">Grids</th>
                  <th scope="col">Printed</th>
                  <th scope="col">On the drawing</th>
                </tr>
              </thead>
              <tbody>
                {spacings.map((s) => (
                  <tr key={s.grids.join('|')}>
                    <td>{s.grids.join(' – ')}</td>
                    <td>{s.text}</td>
                    <td>{s.agrees === true ? 'Matches' : s.agrees === false ? `Measures ${feetInches(String(s.drawn_mm))}` : 'Not checked'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

function describeCheck(check: NonNullable<ExtractionRun['scale_check']>, scaleText: string): string {
  const implied = check.implied_text ?? (check.implied_ratio ? `about 1:${Math.round(check.implied_ratio)}` : '')
  switch (check.verdict) {
    case 'confirmed':
      return `${check.agree} of ${check.checked} printed dimensions measure true at this scale.`
    case 'disagrees':
      return `The printed dimensions measure as if the plan were drawn at ${implied}. Lengths were measured at ${scaleText}; check the scale before relying on them.`
    case 'suggested':
      return `No scale is written on this page, but its printed dimensions measure as if it were drawn at ${implied}.`
    default:
      if (!scaleText) {
        return check.checked
          ? `No scale was found to check the ${check.checked} printed dimensions against.`
          : 'No scale was found, and no printed dimensions could be checked.'
      }
      return check.checked
        ? `${check.agree} of ${check.checked} printed dimensions measure true at this scale: not enough to confirm it.`
        : 'No printed dimensions could be checked on this page.'
  }
}
