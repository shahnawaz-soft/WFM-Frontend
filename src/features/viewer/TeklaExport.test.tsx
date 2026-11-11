import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PageTekla } from '../../api/types'
import { notify } from '../../components/feedback/toastStore'
import { TeklaExport } from './TeklaExport'

const mocks = vi.hoisted(() => ({ data: null as unknown as PageTekla, downloads: [] as string[], pushed: [] as unknown[] }))

vi.mock('../../api/wireframe', () => ({ getPageTekla: async () => mocks.data }))
vi.mock('./tekla', async (original) => ({
  ...(await original<typeof import('./tekla')>()),
  downloadText: (_: string, name: string) => mocks.downloads.push(name),
  pushToTekla: async (payload: unknown) => {
    mocks.pushed.push(payload)
    return { ok: true, grids: 1, beams: 1, columns: 0, errors: [] }
  },
}))

const LEVEL = 'The page has no level elevation.'

beforeEach(() => {
  mocks.downloads = []
  mocks.pushed = []
  mocks.data = {
    file_stem: '02=Stru_p15',
    beams_csv: 'COMPONENT_ID…',
    columns_csv: 'COMPONENT_ID…',
    payload: { replaceExisting: true, beams: [{ profile: 'W12X26' }] },
    counts: { beams: 1, columns: 0, skipped: 1 },
    skipped: [{ id: 'x', kind: 'column', designation: '', reasons: [LEVEL] }],
  }
})

describe('TeklaExport', () => {
  it('downloads the CSV of each kind the page has', async () => {
    const success = vi.spyOn(notify, 'success')
    render(<TeklaExport pageId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(mocks.downloads).toEqual(['beams_02=Stru_p15.csv']))
    expect(success).toHaveBeenCalledWith('Exported 1 beam and 0 columns', `1 left out: ${LEVEL} (1)`)
  })

  it('pushes the payload to Tekla', async () => {
    const success = vi.spyOn(notify, 'success')
    render(<TeklaExport pageId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Push to Tekla' }))
    await waitFor(() => expect(mocks.pushed).toEqual([mocks.data.payload]))
    expect(success).toHaveBeenCalledWith('Pushed to Tekla: grids 1, 1 beam, 0 columns', `1 left out: ${LEVEL} (1)`)
  })

  it('says why when nothing can be placed', async () => {
    const error = vi.spyOn(notify, 'error')
    mocks.data = { ...mocks.data, counts: { beams: 0, columns: 0, skipped: 1 } }
    render(<TeklaExport pageId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Push to Tekla' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Nothing on this page can be placed yet', `1 left out: ${LEVEL} (1)`))
    expect(mocks.pushed).toEqual([])
  })
})
