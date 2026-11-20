import * as Menu from '@radix-ui/react-dropdown-menu'
import { useState } from 'react'

import { toApiError } from '../../api/errors'
import type { PageTekla } from '../../api/types'
import { getPageTekla } from '../../api/wireframe'
import { notify } from '../../components/feedback/toastStore'
import { downloadText, pushToTekla, skippedSummary, type TeklaSkipped } from './tekla'

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The Export menu of a plan page, Export CSV and Push to Tekla: its members placed as the 3D
 *  wireframe places them (project mm from the reference point, Z from the level). */
export function TeklaExport({ pageId }: { pageId: string }) {
  const [busy, setBusy] = useState<'csv' | 'push' | null>(null)

  async function load(): Promise<{ data: PageTekla; left: string } | null> {
    const data = await getPageTekla(pageId)
    const skipped = skippedSummary(data.skipped as TeklaSkipped[])
    // No elevation set: beams still go out, at Z = 0 (their lengths and plan positions hold).
    const assumed = data.elevation_assumed ? 'No elevation set: exported at elevation 0.' : ''
    // No reference point and no grid: placed from the sheet's corner (one page needs no other).
    const corner = data.reference_assumed ? "No reference point: placed from the sheet's corner." : ''
    const left = [assumed, corner, skipped].filter(Boolean).join(' ')
    if (data.counts.beams + data.counts.columns === 0) {
      notify.error('Nothing on this page can be placed yet', left || 'No members found on this page.')
      return null
    }
    return { data, left }
  }

  async function run(kind: 'csv' | 'push', action: () => Promise<void>) {
    setBusy(kind)
    try {
      await action()
    } catch (e) {
      notify.error(kind === 'csv' ? 'Export failed' : 'Push to Tekla failed', toApiError(e).message)
    } finally {
      setBusy(null)
    }
  }

  const exportCsv = () =>
    run('csv', async () => {
      const loaded = await load()
      if (!loaded) return
      const { data, left } = loaded
      if (data.counts.beams) downloadText(data.beams_csv, `beams_${data.file_stem}.csv`)
      if (data.counts.columns) downloadText(data.columns_csv, `columns_${data.file_stem}.csv`)
      notify.success(`Exported ${plural(data.counts.beams, 'beam')} and ${plural(data.counts.columns, 'column')}`, left || undefined)
    })

  const push = () =>
    run('push', async () => {
      const loaded = await load()
      if (!loaded) return
      const result = await pushToTekla(loaded.data.payload)
      const counts = `grids ${result.grids}, ${plural(result.beams, 'beam')}, ${plural(result.columns, 'column')}`
      if (result.ok) notify.success(`Pushed to Tekla: ${counts}`, loaded.left || undefined)
      else notify.error(`Tekla reported ${plural(result.errors.length, 'error')} (${counts} inserted)`, 'See the error window in Tekla.')
    })

  return (
    <Menu.Root>
      <Menu.Trigger className="button button--secondary" disabled={busy !== null} aria-busy={busy !== null || undefined}>
        {busy === 'csv' ? 'Exporting…' : busy === 'push' ? 'Pushing to Tekla…' : 'Export'}
        <span aria-hidden="true"> ▾</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={6}>
          <Menu.Item className="menu__item" onSelect={exportCsv} title="Download this page's beams and columns as CSV, in the old Wireframer's format (mm)">
            Export CSV
          </Menu.Item>
          <Menu.Item
            className="menu__item"
            onSelect={push}
            title="Send this page's grids, beams and columns to Tekla on this PC (the Tekla macro's HTTP server must be running)"
          >
            Push to Tekla
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
