import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Pager } from './Pager'
import { usePage } from './usePage'

function List({ count, focus }: { count: number; focus: number | null }) {
  const view = usePage(count, focus, 10)
  return (
    <>
      <ul>
        {Array.from({ length: view.end - view.start }, (_, i) => (
          <li key={i}>row {view.start + i}</li>
        ))}
      </ul>
      <Pager label="Rows" count={count} view={view} />
    </>
  )
}

describe('Pager', () => {
  it('shows one page of rows at a time', async () => {
    render(<List count={25} focus={null} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('Rows 1–10 of 25')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next ›' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next ›' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled()
  })

  it('turns to the page of the row picked elsewhere', () => {
    const { rerender } = render(<List count={25} focus={null} />)
    rerender(<List count={25} focus={23} />)
    expect(screen.getByText('row 23')).toBeInTheDocument()
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })

  it('is not there when every row fits', () => {
    render(<List count={8} focus={null} />)
    expect(screen.queryByRole('navigation', { name: 'Rows' })).toBeNull()
  })
})
