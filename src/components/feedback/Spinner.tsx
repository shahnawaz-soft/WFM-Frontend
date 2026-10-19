interface SpinnerProps {
  size?: 'small' | 'medium'
  /** Screen-reader text. Pass "" when the surrounding element already describes the state. */
  label?: string
}

export function Spinner({ size = 'medium', label = 'Loading' }: SpinnerProps) {
  return (
    <span className={`spinner spinner--${size}`} role={label ? 'status' : undefined}>
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  )
}
