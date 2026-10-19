import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { authHandlers } from './mockBackend'
import { drawingHandlers } from './mockDrawings'
import { projectHandlers } from './mockProjects'

export const healthyResponse = {
  status: 'ok',
  version: 'test',
  checks: { database: 'ok', storage: 'ok', redis: 'ok' },
}

/** Default handlers = a healthy backend. Tests override per case with server.use(...). */
export const server = setupServer(
  http.get('*/health/ready', () => HttpResponse.json(healthyResponse)),
  // Project routes first: more specific paths than /users/:id/ handlers.
  ...drawingHandlers,
  ...projectHandlers,
  ...authHandlers,
)
