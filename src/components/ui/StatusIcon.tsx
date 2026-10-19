export type StatusTone = 'success' | 'error' | 'info' | 'warning' | 'neutral'

const GLYPH: Record<StatusTone, string> = {
  success: '✓',
  error: '!',
  warning: '▲',
  info: 'i',
  neutral: '•',
}

/** Shape + glyph per tone, so status is never conveyed by colour alone. Decorative. */
export function StatusIcon({ tone }: { tone: StatusTone }) {
  return (
    <span className={`status-icon status-icon--${tone}`} aria-hidden="true">
      {GLYPH[tone]}
    </span>
  )
}
