import { http, HttpResponse } from 'msw'

import type { CurrentUser, GlobalRole, User } from '../api/types'

/**
 * Small stateful stand-in for the Django auth/users API, faithful to its contract:
 * refresh cookie → session, short-lived bearer tokens, error envelope, capabilities by role.
 */
const CAPABILITIES: Record<GlobalRole, string[]> = {
  member: ['projects.create'],
  operator: ['ops.view', 'projects.create'],
  admin: ['ops.view', 'projects.create', 'users.manage'],
}

export const PASSWORD = 'correct-horse-battery'

function makeUser(email: string, role: GlobalRole, first = 'Test', last = 'User', username = ''): User {
  return {
    id: crypto.randomUUID(),
    email,
    username,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    global_role: role,
    is_active: true,
    last_login: null,
    date_joined: '2026-09-30T10:00:00Z',
  }
}

function toCurrent(user: User): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: user.full_name,
    global_role: user.global_role,
    capabilities: CAPABILITIES[user.global_role],
  }
}

const envelope = (status: number, code: string, message: string, details: unknown = {}) =>
  HttpResponse.json({ error: { code, message, details, request_id: `req-${code}` } }, { status })

interface State {
  users: User[]
  passwords: Map<string, string>
  sessionUserId: string | null
  validTokens: Map<string, string>
  refreshCalls: number
}

let state: State

export const mockBackend = {
  reset() {
    const admin = makeUser('admin@steelo.test', 'admin', 'Ada', 'Admin')
    const member = makeUser('estimator@steelo.test', 'member', 'Esha', 'Estimator', 'esha')
    state = {
      users: [admin, member],
      passwords: new Map([
        [admin.email, PASSWORD],
        [member.email, PASSWORD],
      ]),
      sessionUserId: null,
      validTokens: new Map(),
      refreshCalls: 0,
    }
  },
  get state() {
    return state
  },
  userByEmail(email: string) {
    return state.users.find((u) => u.email === email)!
  },
  addUser(email: string, role: GlobalRole, first: string, last: string, username = '') {
    const user = makeUser(email, role, first, last, username)
    state.users.push(user)
    state.passwords.set(email, PASSWORD)
    return user
  },
  /** Simulate an existing refresh cookie, as after a page reload. */
  startSession(email: string) {
    state.sessionUserId = this.userByEmail(email).id
  },
  /** Invalidate every access token (as if they all expired). */
  expireAccessTokens() {
    state.validTokens.clear()
  },
  endSession() {
    state.sessionUserId = null
  },
}

function issueToken(userId: string) {
  const token = `access-${crypto.randomUUID()}`
  state.validTokens.set(token, userId)
  return token
}

function authedUser(request: Request): User | null {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const userId = state.validTokens.get(token)
  return state.users.find((u) => u.id === userId && u.is_active) ?? null
}

const notAuthenticated = () => envelope(401, 'token_not_valid', 'Given token not valid for any token type')

export const authHandlers = [
  http.post('*/api/v1/auth/login/', async ({ request }) => {
    const { login, password } = (await request.json()) as { login: string; password: string }
    const id = login.trim().toLowerCase()
    const user = state.users.find((u) => (id.includes('@') ? u.email === id : u.username === id))
    if (!user || !user.is_active || state.passwords.get(user.email) !== password) {
      return envelope(401, 'invalid_credentials', 'Invalid email, username or password.')
    }
    state.sessionUserId = user.id
    return HttpResponse.json({ access: issueToken(user.id), user: toCurrent(user) })
  }),

  http.post('*/api/v1/auth/refresh/', ({ request }) => {
    state.refreshCalls += 1
    if (request.headers.get('X-Requested-With') !== 'XMLHttpRequest') {
      return envelope(403, 'client_header_required', 'Missing client header.')
    }
    const user = state.users.find((u) => u.id === state.sessionUserId && u.is_active)
    if (!user) return envelope(401, 'session_expired', 'Your session has expired. Please sign in again.')
    return HttpResponse.json({ access: issueToken(user.id), user: toCurrent(user) })
  }),

  http.post('*/api/v1/auth/logout/', () => {
    state.sessionUserId = null
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('*/api/v1/auth/me/', ({ request }) => {
    const user = authedUser(request)
    return user ? HttpResponse.json(toCurrent(user)) : notAuthenticated()
  }),

  http.patch('*/api/v1/auth/me/', async ({ request }) => {
    const user = authedUser(request)
    if (!user) return notAuthenticated()
    const changes = (await request.json()) as Partial<User>
    Object.assign(user, changes, { full_name: `${changes.first_name ?? user.first_name} ${changes.last_name ?? user.last_name}` })
    return HttpResponse.json(toCurrent(user))
  }),

  http.post('*/api/v1/auth/change-password/', async ({ request }) => {
    const user = authedUser(request)
    if (!user) return notAuthenticated()
    const body = (await request.json()) as { current_password: string; new_password: string }
    if (state.passwords.get(user.email) !== body.current_password) {
      return envelope(400, 'validation_error', 'Some fields are invalid.', {
        current_password: ['Your current password is incorrect.'],
      })
    }
    state.passwords.set(user.email, body.new_password)
    return HttpResponse.json({ access: issueToken(user.id), user: toCurrent(user) })
  }),

  http.get('*/api/v1/users/', ({ request }) => {
    const user = authedUser(request)
    if (!user) return notAuthenticated()
    if (user.global_role !== 'admin') return envelope(403, 'permission_denied', 'You do not have permission to perform this action.')
    const params = new URL(request.url).searchParams
    const search = params.get('search')?.toLowerCase() ?? ''
    const results = state.users.filter(
      (u) =>
        (!search || u.email.includes(search) || u.username.includes(search) || u.full_name.toLowerCase().includes(search)) &&
        (!params.get('global_role') || u.global_role === params.get('global_role')) &&
        (!params.get('is_active') || String(u.is_active) === params.get('is_active')),
    )
    return HttpResponse.json({ count: results.length, next: null, previous: null, results })
  }),

  http.post('*/api/v1/users/', async ({ request }) => {
    if (authedUser(request)?.global_role !== 'admin') return notAuthenticated()
    const body = (await request.json()) as { email: string; username?: string; password: string; global_role: GlobalRole; first_name: string; last_name: string }
    if (state.users.some((u) => u.email === body.email.toLowerCase())) {
      return envelope(400, 'validation_error', 'Some fields are invalid.', {
        email: ['A user with this email already exists.'],
      })
    }
    const username = (body.username ?? '').trim().toLowerCase()
    if (username && state.users.some((u) => u.username === username)) {
      return envelope(400, 'validation_error', 'Some fields are invalid.', {
        username: ['This username is already taken.'],
      })
    }
    const created = makeUser(body.email.toLowerCase(), body.global_role, body.first_name, body.last_name, username)
    state.users.push(created)
    state.passwords.set(created.email, body.password)
    return HttpResponse.json(created, { status: 201 })
  }),

  http.patch('*/api/v1/users/:id/', async ({ request, params }) => {
    const actor = authedUser(request)
    if (actor?.global_role !== 'admin') return notAuthenticated()
    const target = state.users.find((u) => u.id === params.id)!
    const changes = (await request.json()) as Partial<User>
    if (target.id === actor.id && (changes.global_role !== 'admin' || changes.is_active === false)) {
      return envelope(409, 'cannot_modify_self', 'You cannot remove your own administrator access or deactivate yourself.')
    }
    if (changes.username !== undefined) {
      const username = (changes.username ?? '').trim().toLowerCase()
      if (username && state.users.some((u) => u.username === username && u.id !== target.id)) {
        return envelope(400, 'validation_error', 'Some fields are invalid.', {
          username: ['This username is already taken.'],
        })
      }
      Object.assign(changes, { username })
    }
    Object.assign(target, changes)
    return HttpResponse.json(target)
  }),

  http.post('*/api/v1/users/:id/reset-password/', async ({ request, params }) => {
    if (authedUser(request)?.global_role !== 'admin') return notAuthenticated()
    const target = state.users.find((u) => u.id === params.id)!
    const { new_password } = (await request.json()) as { new_password: string }
    state.passwords.set(target.email, new_password)
    return new HttpResponse(null, { status: 204 })
  }),
]
