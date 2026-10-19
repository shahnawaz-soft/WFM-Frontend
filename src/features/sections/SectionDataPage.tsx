import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { approveDataset, listSectionDatasets, searchProfiles } from '../../api/sections'
import type { SectionDataset } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

const STATUS = {
  draft: { label: 'Imported, not approved', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'success' },
  retired: { label: 'Retired', tone: 'neutral' },
} as const

/** Administrators: imported section catalogue versions, approval and lookup. */
export function SectionDataPage() {
  const queryClient = useQueryClient()
  const datasets = useQuery({ queryKey: ['section-datasets'], queryFn: listSectionDatasets })
  const [approving, setApproving] = useState<SectionDataset | null>(null)
  const approve = useMutation({
    mutationFn: (d: SectionDataset) => approveDataset(d.id, true),
    meta: { successMessage: 'Section data approved and set as default' },
    onSuccess: () => {
      setApproving(null)
      return queryClient.invalidateQueries({ queryKey: ['section-datasets'] })
    },
  })
  const active = datasets.data?.find((d) => d.is_default) ?? datasets.data?.[0]

  return (
    <>
      <h1>Section data</h1>
      <p className="lead">
        Member weights come from the approved section catalogue (AISC Shapes Database). Each project stays on the version it
        started with unless its owner changes it.
      </p>
      <section className="card" aria-labelledby="import-help">
        <h2 id="import-help">Importing a new version</h2>
        <ol>
          <li>Download the AISC Shapes Database (.xlsx) from aisc.org.</li>
          <li>
            On the server run <code>python manage.py import_sections &lt;file&gt; --dataset-version 16.0</code>.
          </li>
          <li>Approve it here.</li>
        </ol>
      </section>

      {datasets.isPending && <LoadingState label="Loading section data…" />}
      {datasets.error && <ErrorState title="Could not load section data" error={datasets.error} />}
      {datasets.data?.length === 0 && <EmptyState title="No section data imported yet" />}
      {datasets.data && datasets.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Imported section data versions</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col" className="num">Sections</th>
                <th scope="col">Status</th>
                <th scope="col">Imported</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {datasets.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.label}</strong>
                    <div className="muted">{d.original_filename}</div>
                  </td>
                  <td className="num">{d.profile_count.toLocaleString()}</td>
                  <td>
                    <StatusBadge tone={STATUS[d.status].tone} label={STATUS[d.status].label} />{' '}
                    {d.is_default && <StatusBadge tone="info" label="Default" />}{' '}
                    {d.is_test && <StatusBadge tone="warning" label="Test data" />}
                  </td>
                  <td>{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="table__actions">
                    {!d.is_default && d.status !== 'retired' && (
                      <Button onClick={() => setApproving(d)}>{d.status === 'approved' ? 'Make default' : 'Approve'}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {active && <ProfileLookup dataset={active} />}
      <ConfirmDialog
        open={approving !== null}
        title={`Approve ${approving?.label}?`}
        confirmLabel="Approve and make default"
        tone="primary"
        pending={approve.isPending}
        onConfirm={() => approving && approve.mutate(approving)}
        onCancel={() => setApproving(null)}
      >
        <p>
          New projects will use it for member weights. Existing projects keep their version; projects with no section data
          yet start using it and their members are matched.
        </p>
      </ConfirmDialog>
    </>
  )
}

function ProfileLookup({ dataset }: { dataset: SectionDataset }) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const results = useQuery({
    queryKey: ['section-profiles', dataset.id, debounced],
    queryFn: () => searchProfiles(dataset.id, debounced),
    enabled: debounced.length >= 2,
  })
  return (
    <section className="card" aria-labelledby="lookup-heading">
      <h2 id="lookup-heading">Look up a section in {dataset.label}</h2>
      <TextField label="Section" placeholder="e.g. W12X26" value={search} onChange={(e) => setSearch(e.target.value)} />
      {results.data && results.data.length === 0 && <p className="muted">No sections match.</p>}
      {results.data && results.data.length > 0 && (
        <table className="table table--compact">
          <caption className="visually-hidden">Matching sections</caption>
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col" className="num">lb/ft</th>
              <th scope="col" className="num">kg/m</th>
            </tr>
          </thead>
          <tbody>
            {results.data.slice(0, 20).map((p) => (
              <tr key={p.id}>
                <td>{p.designation}</td>
                <td className="num">{Number(p.weight_lb_per_ft)}</td>
                <td className="num">{Number(p.weight_kg_per_m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
