import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ColumnChanges, SchedulerColumns, SchedulerRow } from '../../api/types'
import { createTestQueryClient } from '../../test/renderApp'
import { ColumnScheduler } from './ColumnScheduler'

const api = vi.hoisted(() => ({
  meta: [] as { id: string; name: string; members: string[]; created_at: string }[],
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
  listColumnMetaGroups: async () => api.meta,
  createColumnMetaGroup: async (_: string, name: string, members: string[]) => {
    const group = { id: `g${api.meta.length + 1}`, name, members, created_at: '' }
    api.meta = [...api.meta, group]
    return group
  },
  deleteColumnMetaGroup: async () => {},
  applyColumnsToAbm: async () => ({ updated: 2, locked: 0, not_in_abm: 0 }),
}))

function column(id: string, designation: string, extra: Partial<SchedulerRow> = {}): SchedulerRow {
  return {
    id,
    version: 1,
    mark: 'C1',
    grid: 'A/1',
    designation,
    column_type: 'column',
    rotation: 'B',
    x_mm: String(api.state.columns.length * 6096),
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
    ...extra,
  }
}

function Shared({ editable }: { editable: boolean }) {
  // as the wireframe page: a person who may edit the project names meta-groups
  const [selection, setSelection] = useState<Set<string>>(new Set())
  return (
    <ColumnScheduler
      projectId="p1"
      wireframeId="w1"
      revisionNo={2}
      datasetId={null}
      editable={editable}
      selectedId={null}
      selection={selection}
      onSelectionChange={setSelection}
      onSelect={() => {}}
      onChanged={() => {}}
      canEditProject={editable}
      grids={[
        { label: 'A', direction: 'y', position_mm: '0.0', angle_deg: null, start_mm: null, end_mm: null },
        { label: '1', direction: 'x', position_mm: '0.0', angle_deg: null, start_mm: null, end_mm: null },
      ]}
    />
  )
}

function renderScheduler(editable = true, client = createTestQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <Shared editable={editable} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.state.columns = []
  for (const [id, designation] of [
    ['aaaaaaaa-1', 'W14X99'],
    ['bbbbbbbb-2', 'W14X99'],
    ['cccccccc-3', 'W14X68'],
  ] as const)
    api.state.columns = [...api.state.columns, column(id, designation)]
  api.calls.length = 0
  api.meta = []
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
    fireEvent.change(screen.getByLabelText('Rotation of the selection'), { target: { value: 'T' } })
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['aaaaaaaa-1', 'bbbbbbbb-2'], changes: { rotation: 'T' } })
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls[1]).toEqual({ ids: ['aaaaaaaa-1', 'bbbbbbbb-2'], changes: { rotation: 'B' } })
    await user.click(screen.getByRole('button', { name: /Redo/ }))
    await waitFor(() => expect(api.calls).toHaveLength(3))
    expect(api.calls[2]!.changes).toEqual({ rotation: 'T' })
  })

  it('applies a change in the side panel to the whole selection', async () => {
    const user = userEvent.setup()
    renderScheduler()
    await screen.findByRole('table', { name: 'Column schedule' })
    await user.click(screen.getByLabelText('Select all columns'))
    expect(screen.getByText('3 columns selected')).toBeInTheDocument()
    // The side panel, as on the extraction page: a change applies to every selected column.
    await user.selectOptions(screen.getByLabelText('Top level of the selection'), '2ND FLOOR')
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3'], changes: { top_level: '2ND FLOOR' } })
  })

  it('a profile typed for one picked column changes only that column', async () => {
    const user = userEvent.setup()
    renderScheduler()
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    await user.click(within(table).getByText('cccccccc'))
    expect(screen.getByRole('heading', { name: 'Column C1' })).toBeInTheDocument()
    const input = screen.getByLabelText('Profile of the selection')
    await user.clear(input)
    await user.type(input, 'W14X90{Enter}')
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['cccccccc-3'], changes: { designation: 'W14X90' } })
  })

  it('shows plain values in the table, edited only in the side panel', async () => {
    renderScheduler()
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    expect(within(table).queryByRole('textbox')).toBeNull()
    expect(within(table).queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Selected columns' })).toHaveTextContent('Pick a column')
  })

  it('finds columns by grid, mark or profile', async () => {
    const user = userEvent.setup()
    renderScheduler(false)
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    await user.type(screen.getByLabelText('Search columns'), 'w14x68')
    expect(within(table).getAllByRole('row')).toHaveLength(2) // header + 1
  })

  it('applies the columns to the ABM after confirming', async () => {
    const user = userEvent.setup()
    renderScheduler()
    await user.click(await screen.findByRole('button', { name: 'Apply to ABM…' }))
    await user.click(screen.getByRole('button', { name: 'Apply to ABM' }))
    expect(await screen.findByText(/ABM updated: 2 column entries changed/)).toBeInTheDocument()
  })

  it("refreshes this project's ABM only", async () => {
    const user = userEvent.setup()
    const client = createTestQueryClient()
    client.setQueryData(['abm', 'p1', 'summary', false], {})
    client.setQueryData(['abm', 'p2', 'summary', false], {})
    renderScheduler(true, client)
    await user.click(await screen.findByRole('button', { name: 'Apply to ABM…' }))
    await user.click(screen.getByRole('button', { name: 'Apply to ABM' }))
    await screen.findByText(/ABM updated/)
    expect(client.getQueryState(['abm', 'p1', 'summary', false])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['abm', 'p2', 'summary', false])?.isInvalidated).toBe(false)
  })

  it('lists a stack of pieces at one grid location as one column group, opened to its pieces', async () => {
    const user = userEvent.setup()
    api.state.columns = [
      column('aaaaaaaa-1', 'W14X99', { x_mm: '0.0' }),
      column('dddddddd-4', 'W14X99', { x_mm: '0.0', bottom_mm: '4267.2', top_mm: '8534.4', bottom_display: '14\'-0"', top_display: '28\'-0"', page_number: 9 }),
      column('bbbbbbbb-2', 'W14X68', { x_mm: '6096.0', grid: 'A/2' }),
    ]
    renderScheduler(false)
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    expect(screen.getByText('2 groups · 3 columns')).toBeInTheDocument()
    let rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('28\'-0"') // its height: 0'-0" to 28'-0"
    expect(rows[0]).toHaveTextContent('p.7, p.9')
    expect(within(rows[0]!).getAllByRole('cell')[10]).toHaveTextContent('2') // members
    await user.click(within(rows[0]!).getByRole('button', { name: /2 members/ }))
    rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4) // the group, its two pieces, the other column
  })

  it("a column group's profile changes every piece of it", async () => {
    const user = userEvent.setup()
    api.state.columns = [
      column('aaaaaaaa-1', 'W14X99', { x_mm: '0.0' }),
      column('dddddddd-4', 'W14X99', { x_mm: '0.0', bottom_mm: '4267.2', top_mm: '8534.4' }),
    ]
    renderScheduler()
    const table = await screen.findByRole('table', { name: 'Column schedule' })
    await user.click(within(table).getAllByRole('row')[1]!.querySelector('td:nth-child(3)')!)
    expect(screen.getByRole('heading', { name: 'Column group · 2 pieces' })).toBeInTheDocument()
    const input = screen.getByLabelText('Profile of the selection')
    await user.clear(input)
    await user.type(input, 'W14X120{Enter}')
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ ids: ['aaaaaaaa-1', 'dddddddd-4'], changes: { designation: 'W14X120' } })
  })

  it('shows the column groups by elevation in the Visual view, with the picked one\'s properties', async () => {
    const user = userEvent.setup()
    renderScheduler(false)
    await screen.findByRole('table', { name: 'Column schedule' })
    await user.click(screen.getByRole('button', { name: 'Visual' }))
    const list = screen.getByRole('navigation', { name: 'Column groups' })
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    await user.click(within(list).getByRole('button', { name: /Column Group 2/ }))
    const props = screen.getByRole('complementary', { name: 'Properties' })
    expect(props).toHaveTextContent('bbbbbbbb')
    expect(props).toHaveTextContent('Members1')
    expect(props).toHaveTextContent('Bottom | Top0\'-0" | 14\'-0"')
  })

  it('shows the columns on the grid in the Grid view; a picked set becomes a named meta-group', async () => {
    const user = userEvent.setup()
    renderScheduler()
    await screen.findByRole('table', { name: 'Column schedule' })
    await user.click(screen.getByRole('button', { name: 'Grid' }))
    const plan = screen.getByRole('img', { name: 'Columns on the grid' })
    const dots = plan.querySelectorAll('.col-grid__dot')
    expect(dots).toHaveLength(3)
    expect(plan.querySelectorAll('.col-grid__line')).toHaveLength(2)
    await user.click(dots[0]!)
    await user.keyboard('{Control>}')
    await user.click(dots[1]!)
    await user.keyboard('{/Control}')
    await user.click(screen.getByRole('button', { name: /Group Selected \(2\)/ }))
    await user.type(screen.getByLabelText('Meta-group name'), 'Frame A{Enter}')
    const groups = screen.getByRole('region', { name: 'Meta-groups' })
    expect(await within(groups).findByText('Frame A')).toBeInTheDocument()
    expect(api.meta[0]!.members).toEqual(['aaaaaaaa-1', 'bbbbbbbb-2']) // no member: kept by the column
    // A click on the meta-group selects its columns again.
    await user.click(dots[2]!)
    await user.click(within(groups).getByRole('button', { name: /^Frame A/ }))
    expect(screen.getByText('2 columns selected')).toBeInTheDocument()
  })
})
