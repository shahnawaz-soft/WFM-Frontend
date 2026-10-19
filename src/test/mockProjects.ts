import { http, HttpResponse } from 'msw'

import type { Membership, Project, ProjectRole, User } from '../api/types'
import { mockBackend } from './mockBackend'

/** Mirrors steelo.projects.access + services for frontend tests. */
const ROLE_CAPS: Record<ProjectRole, string[]> = {
  viewer: ['project.view'],
  editor: ['project.edit', 'project.view'],
  reviewer: ['project.edit', 'project.finalize', 'project.review', 'project.view'],
  owner: ['project.archive', 'project.edit', 'project.finalize', 'project.manage_members', 'project.review', 'project.view'],
}

interface StoredProject {
  id: string
  name: string
  status: 'active' | 'finalized' | 'archived'
  version: number
  finalized_at?: string | null
  created_by: User
  created_at: string
  updated_at: string
  archived_at: string | null
  members: { id: string; user: User; role: ProjectRole; added_by: User; created_at: string }[]
}

let projects: StoredProject[] = []
/** The section data every mock project is pinned to (null = none approved yet). */
let sectionDataset: { id: string; label: string; is_test: boolean } | null = { id: 'ds-1', label: 'AISC Shapes Database v16.0', is_test: false }
let clock = Date.parse('2026-10-01T09:00:00Z')
const tick = () => new Date((clock += 60_000)).toISOString()

const envelope = (status: number, code: string, message: string, details: unknown = {}) =>
  HttpResponse.json({ error: { code, message, details, request_id: `req-${code}` } }, { status })

function currentUser(request: Request): User | null {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const id = mockBackend.state.validTokens.get(token)
  return mockBackend.state.users.find((u) => u.id === id && u.is_active) ?? null
}

function roleOf(p: StoredProject, user: User) {
  return p.members.find((m) => m.user.id === user.id)?.role ?? null
}

function capsOf(p: StoredProject, user: User): string[] {
  const role = roleOf(p, user)
  let caps = new Set(role ? ROLE_CAPS[role] : [])
  if (user.global_role === 'admin') caps = new Set(ROLE_CAPS.owner)
  else if (user.global_role === 'operator') caps.add('project.view')
  if (p.status === 'archived') caps = new Set([...caps].filter((c) => c === 'project.view' || c === 'project.archive'))
  if (p.status === 'finalized')
    caps = new Set([...caps].filter((c) => ['project.view', 'project.finalize', 'project.archive', 'project.manage_members'].includes(c)))
  return [...caps].sort()
}

function visible(p: StoredProject, user: User) {
  return user.global_role !== 'member' || roleOf(p, user) !== null
}

const summary = (u: User) => ({ id: u.id, email: u.email, username: u.username, full_name: u.full_name, is_active: u.is_active })

function serialize(p: StoredProject, user: User): Project {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    created_by: summary(p.created_by),
    created_at: p.created_at,
    updated_at: p.updated_at,
    archived_at: p.archived_at,
    finalized_at: p.finalized_at ?? null,
    version: p.version,
    my_role: roleOf(p, user),
    member_count: p.members.length,
    section_dataset: sectionDataset,
    my_capabilities: capsOf(p, user),
  } as Project
}

const serializeMember = (m: StoredProject['members'][number]): Membership =>
  ({ id: m.id, user: summary(m.user), role: m.role, added_by: summary(m.added_by), created_at: m.created_at }) as Membership

export const mockProjects = {
  reset() {
    projects = []
    sectionDataset = { id: 'ds-1', label: 'AISC Shapes Database v16.0', is_test: false }
  },
  withoutSectionData() {
    sectionDataset = null
  },
  /** Seed a project owned by ``ownerEmail`` with extra ``members`` (email → role). */
  create(name: string, ownerEmail: string, members: Record<string, ProjectRole> = {}, status: 'active' | 'archived' = 'active') {
    const owner = mockBackend.userByEmail(ownerEmail)
    const now = tick()
    const p: StoredProject = {
      id: crypto.randomUUID(),
      name,
      status,
      version: 1,
      created_by: owner,
      created_at: now,
      updated_at: now,
      archived_at: status === 'archived' ? now : null,
      members: [{ id: crypto.randomUUID(), user: owner, role: 'owner', added_by: owner, created_at: now }],
    }
    for (const [email, role] of Object.entries(members)) {
      p.members.push({ id: crypto.randomUUID(), user: mockBackend.userByEmail(email), role, added_by: owner, created_at: now })
    }
    projects.push(p)
    return p
  },
  get all() {
    return projects
  },
  /** The section-data version every mock project uses (null after withoutSectionData()). */
  get sectionDataset() {
    return sectionDataset
  },
}

function find(request: Request, id: string) {
  const user = currentUser(request)
  if (!user) return { error: envelope(401, 'token_not_valid', 'Given token not valid') }
  const p = projects.find((x) => x.id === id)
  if (!p || !visible(p, user)) return { error: envelope(404, 'not_found', 'Project not found.') }
  return { user, p }
}

function requireCap(p: StoredProject, user: User, cap: string) {
  if (capsOf(p, user).includes(cap)) return null
  if (p.status === 'archived') return envelope(403, 'project_archived', 'This project is archived and read-only. Restore it to make changes.')
  return envelope(403, 'permission_denied', 'Your project role does not allow this action.')
}

const touch = (p: StoredProject) => {
  p.version += 1
  p.updated_at = tick()
}

function setArchived(request: Request, id: string, archive: boolean) {
  const r = find(request, id)
  if (r.error) return r.error
  const denied = requireCap(r.p, r.user, 'project.archive')
  if (denied) return denied
  r.p.status = archive ? 'archived' : r.p.finalized_at ? 'finalized' : 'active'
  r.p.archived_at = archive ? tick() : null
  touch(r.p)
  return HttpResponse.json(serialize(r.p, r.user))
}

export const projectHandlers = [
  http.post('*/api/v1/projects/:id/section-dataset/', async ({ request, params }) => {
    const r = find(request, params.id as string)
    if (r.error) return r.error
    const denied = requireCap(r.p, r.user, 'project.manage_members')
    if (denied) return denied
    const body = (await request.json()) as { dataset_id: string }
    const labels: Record<string, string> = { 'ds-0': 'AISC Shapes Database v15.0', 'ds-1': 'AISC Shapes Database v16.0' }
    sectionDataset = { id: body.dataset_id, label: labels[body.dataset_id] ?? body.dataset_id, is_test: false }
    touch(r.p)
    return HttpResponse.json(serialize(r.p, r.user))
  }),
  http.get('*/api/v1/projects/', ({ request }) => {
    const user = currentUser(request)
    if (!user) return envelope(401, 'token_not_valid', 'Given token not valid')
    const params = new URL(request.url).searchParams
    const status = params.get('status') ?? 'current'
    const search = params.get('search')?.toLowerCase() ?? ''
    const limit = Number(params.get('limit') ?? 50)
    const results = projects
      .filter((p) => visible(p, user) && (status === 'all' || p.status === status || (status === 'current' && p.status !== 'archived')) && p.name.toLowerCase().includes(search))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return HttpResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results: results.slice(0, limit).map((p) => serialize(p, user)),
    })
  }),

  http.post('*/api/v1/projects/', async ({ request }) => {
    const user = currentUser(request)
    if (!user) return envelope(401, 'token_not_valid', 'Given token not valid')
    const { name } = (await request.json()) as { name: string }
    if (!name.trim()) return envelope(400, 'validation_error', 'Some fields are invalid.', { name: ['This field may not be blank.'] })
    const p = mockProjects.create(name.trim(), user.email)
    return HttpResponse.json(serialize(p, user), { status: 201 })
  }),

  http.get('*/api/v1/projects/:id/', ({ request, params }) => {
    const r = find(request, params.id as string)
    return r.error ?? HttpResponse.json(serialize(r.p, r.user))
  }),

  http.patch('*/api/v1/projects/:id/', async ({ request, params }) => {
    const r = find(request, params.id as string)
    if (r.error) return r.error
    const denied = requireCap(r.p, r.user, 'project.edit')
    if (denied) return denied
    const body = (await request.json()) as { name: string; version?: number }
    if (body.version !== undefined && body.version !== r.p.version) {
      return envelope(409, 'stale_version', 'This project was changed by someone else. Reload to see the latest version.')
    }
    r.p.name = body.name
    touch(r.p)
    return HttpResponse.json(serialize(r.p, r.user))
  }),

  ...(['archive', 'restore'] as const).map((action) =>
    http.post(`*/api/v1/projects/:id/${action}/`, ({ request, params }) => setArchived(request, params.id as string, action === 'archive')),
  ),

  http.get('*/api/v1/projects/:id/members/', ({ request, params }) => {
    const r = find(request, params.id as string)
    return r.error ?? HttpResponse.json(r.p.members.map(serializeMember))
  }),

  http.post('*/api/v1/projects/:id/members/', async ({ request, params }) => {
    const r = find(request, params.id as string)
    if (r.error) return r.error
    const denied = requireCap(r.p, r.user, 'project.manage_members')
    if (denied) return denied
    const { user_id, role } = (await request.json()) as { user_id: string; role: ProjectRole }
    const user = mockBackend.state.users.find((u) => u.id === user_id)!
    if (r.p.members.some((m) => m.user.id === user_id)) {
      return envelope(400, 'validation_error', 'Some fields are invalid.', { user: ['This user is already a member of the project.'] })
    }
    const m = { id: crypto.randomUUID(), user, role, added_by: r.user, created_at: tick() }
    r.p.members.push(m)
    touch(r.p)
    return HttpResponse.json(serializeMember(m), { status: 201 })
  }),

  http.patch('*/api/v1/projects/:id/members/:mid/', async ({ request, params }) => {
    const r = find(request, params.id as string)
    if (r.error) return r.error
    const denied = requireCap(r.p, r.user, 'project.manage_members')
    if (denied) return denied
    const m = r.p.members.find((x) => x.id === params.mid)!
    const { role } = (await request.json()) as { role: ProjectRole }
    if (m.role === 'owner' && role !== 'owner' && r.p.members.filter((x) => x.role === 'owner').length === 1) {
      return envelope(409, 'last_owner_required', 'A project must keep at least one owner. Make someone else an owner first.')
    }
    m.role = role
    touch(r.p)
    return HttpResponse.json(serializeMember(m))
  }),

  http.delete('*/api/v1/projects/:id/members/:mid/', ({ request, params }) => {
    const r = find(request, params.id as string)
    if (r.error) return r.error
    const denied = requireCap(r.p, r.user, 'project.manage_members')
    if (denied) return denied
    const m = r.p.members.find((x) => x.id === params.mid)!
    if (m.role === 'owner' && r.p.members.filter((x) => x.role === 'owner').length === 1) {
      return envelope(409, 'last_owner_required', 'A project must keep at least one owner. Make someone else an owner first.')
    }
    r.p.members = r.p.members.filter((x) => x !== m)
    touch(r.p)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('*/api/v1/users/lookup/', ({ request }) => {
    if (!currentUser(request)) return envelope(401, 'token_not_valid', 'Given token not valid')
    const search = new URL(request.url).searchParams.get('search')?.toLowerCase() ?? ''
    if (search.length < 2) return HttpResponse.json([])
    return HttpResponse.json(
      mockBackend.state.users
        .filter((u) => u.is_active && (u.email.includes(search) || u.full_name.toLowerCase().includes(search) || u.username.includes(search)))
        .map((u) => ({ id: u.id, email: u.email, username: u.username, full_name: u.full_name })),
    )
  }),
]
