import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ColumnChanges, SchedulerColumns, SchedulerRow } from '../../api/types'
import { createTestQueryClient } from '../../test/renderApp'
import { ColumnScheduler } from './ColumnScheduler'

const api = vi.hoisted(() => ({
  state: { columns: [] as SchedulerRow[] },
  calls: [] as { ids: string[]; changes: ColumnChanges }[],
}))

vi.mock('../../api/wireframe', () => ({
  getSchedulerColumns: async (): Promise<SchedulerColumns> => ({
    levels: [
      { label: 'FOUNDATION', elevation_mm: '0.0', elevation_display: '0\'-0"' },
      { label: '2ND FLOOR', elevation_mm: '4267.2', elevation_display: '14\'-0"' },
    ],
    columns: api.state.columns,
  }),
  bulkEditColumns: async (_: string, items: { id: string; version: number }[], changes: ColumnChanges) => {
    api.calls.push({ ids: items.map((i) => i.id), changes })
    api.state.columns = api.state.columns.map((c) =>
      items.some((i) => i.id === c.id)
        ? {
            ...c,
            version: c.version + 1,
            ...(changes.designation !== undefined ? { designation: changes.designation } : {}),
            ...(changes.rotation ? { rotation: changes.rotation } : {}),
          }
        : c,
    )
    return { levels: [], columns: api.state.columns }
  },
  downloadColumnsCsv: vi.fn(),
  applyColumnsToAbm: async () => ({ updated: 2, locked: 0, not_in_abm: 0 }),
}))

function column(id: string, designation: string): SchedulerRow {
  return {
    id,
    version: 1,
    mark: 'C1',
    grid: 'A/1',
    designation,
    column_type: 'column',
    rotation: 'B',
    x_mm: '0.0',
    y_mm: '0.0',
    bottom_mm: '0.0',
    top_mm: '4267.2',
    height_mm: '4267.2',
    bottom_display: '0\'-0"',
    top_display: '14\'-0"',
    height_display: '14\'-0"',
    bottom_level: 'FOUNDATION',
    top_level: '2ND FLOOR',
    level_label: 'FOUNDATION',
    page_number: 7,
    source_member: null,
    provenance: 'generated',
    completeness: 'ok',
    issues: [],
  }
}

function Shared({ editable }: { editable: boolean }) {
  const [selection, setSelection] = useState<Set<string>>(new Set())
  return (
    <ColumnScheduler
      wireframeId="w1"
      revisionNo={2}
      datasetId={null}
      editable={editable}
      selectedId={null}
      selection={selection}
      onSelectionChange={setSelection}
      onSelect={() => {}}
      onChanged={() => {}}
    />
  )
}

function renderScheduler(editable = true) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Shared editable={editable} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.state.columns = [column('aaaaaaaa-1', 'W14X99'), column('bbbbbbbb-2', 'W14X99'), column('cccccccc-3', 'W14X68')]
  api.calls.length = 0
})

describe('Column scheduler', () => {
  it('lists columns with mark, profile, height, levels and rotation', async () => {
    renderScheduler(false)
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    const first = within(table).getAllByRole('row')[1]!
    expect(first).toHaveTextContent('A/1')
    expect(first).toHaveTextContent('C1')
    expect(first).toHaveTextContent('W14X99')
    expect(first).toHaveTextContent('14\'-0"')
    expect(first).toHaveTextContent('2ND FLOOR')
    expect(first).toHaveTextContent('Back')
  })

  it('edits every selected column at once, and undoes it', async () => {
    const user = userEvent.setup()
    renderScheduler()
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    const rows = within(table).getAllByRole('row').slice(1)
    await user.click(rows[0]!.querySelector('td:nth-child(2)')!)
    await user.keyboard('{Control>}')
    await user.click(rows[1]!.querySelector('td:nth-child(2)')!)
    await user.keyboard('{/Control}')
    expect(screen.getByText('2 columns selected')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Rotation of aaaaaaaa'), { target: { value: 'T' } })
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['aaaaaaaa-1', 'bbbbbbbb-2'], changes: { rotation: 'T' } })
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls[1]).toEqual({ ids: ['aaaaaaaa-1', 'bbbbbbbb-2'], changes: { rotation: 'B' } })
    await user.click(screen.getByRole('button', { name: /Redo/ }))
    await waitFor(() => expect(api.calls).toHaveLength(3))
    expect(api.calls[2]!.changes).toEqual({ rotation: 'T' })
  })

  it('applies a bulk change from the bar to the selection', async () => {
    const user = userEvent.setup()
    renderScheduler()
    await screen.findByRole('table', { name: 'Column schedule' })
    await user.click(screen.getByLabelText('Select all columns'))
    expect(screen.getByText('3 columns selected')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Top level for the selected columns'), '2ND FLOOR')
    await user.click(screen.getByRole('button', { name: 'Apply to 3' }))
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3'], changes: { top_level: '2ND FLOOR' } })
  })

  it('a profile typed in one row changes only that row when it is not selected', async () => {
    const user = userEvent.setup()
    renderScheduler()
    const input = await screen.findByLabelText('Profile of cccccccc')
    await user.clear(input)
    await user.type(input, 'W14X90{Enter}')
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['cccccccc-3'], changes: { designation: 'W14X90' } })
  })

  it('applies the columns to the ABM after confirming', async () => {
    const user = userEvent.setup()
    renderScheduler()
    await user.click(await screen.findByRole('button', { name: 'Apply to ABM…' }))
    await user.click(screen.getByRole('button', { name: 'Apply to ABM' }))
    expect(await screen.findByText(/ABM updated: 2 column entries changed/)).toBeInTheDocument()
  })
})
