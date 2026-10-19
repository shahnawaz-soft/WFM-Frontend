import type { ButtonHTMLAttributes } from 'react'

import { Spinner } from '../feedback/Spinner'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  /** Shows a spinner, disables the button and announces the busy state. */
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={['button', `button--${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size="small" label="" />}
      {children}
    </button>
  )
}
