import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'

import { toApiError } from '../../api/errors'
import { getProject } from '../../api/projects'
import { getProjectHistory } from '../../api/review'
import type { HistoryCategory, HistoryItem } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { SelectField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'

const PAGE = 50

const CATEGORY_OPTIONS: { value: HistoryCategory | ''; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'members', label: 'Member corrections and decisions' },
  { value: 'pages', label: 'Pages and drawings' },
  { value: 'processing', label: 'Processing runs and errors' },
  { value: 'project', label: 'Project settings and people' },
]

function who(item: HistoryItem): string {
  if (item.actor_type === 'job') return item.actor ? `Background job (requested by ${item.actor.full_name})` : 'Background job'
  if (item.actor_type === 'system' || !item.actor) return 'System'
  return item.actor.full_name
}

/** Project history (AC-009): every change, run and error with who and when, newest first. */
export function ProjectHistoryPage() {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const category = (params.get('category') ?? '') as HistoryCategory | ''
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const history = useInfiniteQuery({
    queryKey: ['project', projectId, 'history', category],
    queryFn: ({ pageParam }) => getProjectHistory(projectId, { category, before: pageParam ?? undefined, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
  })

  const error = project.error ?? history.error
  if (error) {
    return toApiError(error).status === 404 ? (
      <div className="state state--empty">
        <h1 className="state__title">Project not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    ) : (
      <ErrorState title="Could not load the project history" error={error} />
    )
  }
  if (!project.data) return <LoadingState label="Loading history…" />

  const items = history.data?.pages.flatMap((p) => p.results) ?? []
  const days = new Map<string, HistoryItem[]>()
  for (const item of items) {
    const day = new Date(item.occurred_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    days.set(day, [...(days.get(day) ?? []), item])
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
        <Link to={`/projects/${projectId}`}>{project.data.name}</Link>
      </nav>
      <div className="page-header">
        <div>
          <h1>Project history</h1>
          <p className="muted">Every change, processing run and error, with who made it and when. Newest first.</p>
        </div>
      </div>
      <div className="filters">
        <SelectField
          label="Show"
          value={category}
          onChange={(e) =>
            setParams(
              (p) => {
                const next = new URLSearchParams(p)
                if (e.target.value) next.set('category', e.target.value)
                else next.delete('category')
                return next
              },
              { replace: true },
            )
          }
          options={CATEGORY_OPTIONS}
        />
      </div>

      {history.isPending && <LoadingState label="Loading history…" />}
      {history.isSuccess && items.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      {[...days.entries()].map(([day, list]) => (
        <section key={day} className="history-day" aria-label={day}>
          <h2>{day}</h2>
          <ol className="timeline">
            {list.map((item) => (
              <li key={item.id} className="timeline__item" data-error={item.is_error || undefined}>
                <time dateTime={item.occurred_at}>
                  {new Date(item.occurred_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </time>
                <div>
                  <p className="timeline__summary">
                    {item.is_error && <StatusBadge tone="error" label="Error" />} {item.summary}
                  </p>
                  <p className="muted timeline__meta">
                    {who(item)}
                    {item.reason && <> · “{item.reason}”</>}
                    {item.page && (
                      <>
                        {' · '}
                        <Link
                          to={`/projects/${projectId}/pages/${item.page.id}${item.member_id ? `?member=${item.member_id}` : ''}`}
                        >
                          {item.member_id ? 'Show member' : 'Open page'}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {history.hasNextPage && (
        <div className="button-row">
          <Button loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
            Show older
          </Button>
        </div>
      )}
    </>
  )
}
