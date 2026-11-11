import { useState } from 'react'

import { toApiError } from '../../api/errors'
import type { PageTekla } from '../../api/types'
import { getPageTekla } from '../../api/wireframe'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { downloadText, pushToTekla, skippedSummary, type TeklaSkipped } from './tekla'

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Export CSV and Push to Tekla on a plan page: its members placed as the 3D wireframe places
 *  them (project mm from the reference point, Z from the level). */
export function TeklaExport({ pageId }: { pageId: string }) {
  const [busy, setBusy] = useState<'csv' | 'push' | null>(null)

  async function load(): Promise<{ data: PageTekla; left: string } | null> {
    const data = await getPageTekla(pageId)
    const left = skippedSummary(data.skipped as TeklaSkipped[])
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
    <>
      <Button loading={busy === 'csv'} disabled={busy !== null} onClick={exportCsv} title="Download this page's beams and columns as CSV, in the old Wireframer's format (mm)">
        Export CSV
      </Button>
      <Button
        loading={busy === 'push'}
        disabled={busy !== null}
        onClick={push}
        title="Send this page's grids, beams and columns to Tekla on this PC (the Tekla macro's HTTP server must be running)"
      >
        Push to Tekla
      </Button>
    </>
  )
}
