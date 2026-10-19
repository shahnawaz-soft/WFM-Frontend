import type { ExtractedMember, ExtractionIssue } from '../../../api/types'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import type { StatusTone } from '../../../components/ui/StatusIcon'

const SEVERITY: Record<string, { label: string; tone: StatusTone }> = {
  info: { label: 'Note', tone: 'info' },
  warning: { label: 'Check', tone: 'warning' },
  error: { label: 'Problem', tone: 'error' },
}

interface FlagsPanelProps {
  issues: ExtractionIssue[]
  members: ExtractedMember[]
  loading: boolean
  onShowMember: (id: string) => void
}

/** Everything that needs a person's attention on this page, with an explanation. */
export function FlagsPanel({ issues, members, loading, onShowMember }: FlagsPanelProps) {
  const low = members.filter((m) => m.low_confidence).length
  const unsupported = members.filter((m) => m.warnings.includes('unsupported_profile')).length
  const byId = new Map(members.map((m) => [m.id, m]))

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Flags</h2>
        <p className="muted">Items that need checking before results are used.</p>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {!loading && issues.length === 0 && <p className="muted">Nothing flagged on this page.</p>}
      <ul className="issue-list" aria-label="Flags on this page">
        {issues.map((issue) => {
          const member = issue.member ? byId.get(issue.member) : undefined
          return (
            <li key={issue.id}>
              <StatusBadge tone={SEVERITY[issue.severity]!.tone} label={SEVERITY[issue.severity]!.label} />
              <span>{issue.message}</span>
              {member && (
                <button type="button" className="link-button" onClick={() => onShowMember(member.id)}>
                  Show {member.designation} on the drawing
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {(low > 0 || unsupported > 0) && (
        <dl className="facts">
          {low > 0 && (
            <>
              <dt>Low confidence</dt>
              <dd>{low} members</dd>
            </>
          )}
          {unsupported > 0 && (
            <>
              <dt>Unsupported type</dt>
              <dd>{unsupported} members</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
