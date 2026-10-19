import { StatusIcon, type StatusTone } from './StatusIcon'

/**
 * The one way to display a status: icon + text label + colour. Every status in the app
 * (pages, jobs, members, ABM rows) will render through this component.
 */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <StatusIcon tone={tone} />
      {label}
    </span>
  )
}
