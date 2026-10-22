import { createBrowserRouter, type RouteObject } from 'react-router'

import { RequireAuth, RequireCapability } from '../auth/guards'
import { TemplatesPage } from '../features/connections/TemplatesPage'
import { ProjectDetailPage } from '../features/projects/ProjectDetailPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { OpsPage } from '../features/ops/OpsPage'
import { SectionDataPage } from '../features/sections/SectionDataPage'
import { UsersPage } from '../features/users/UsersPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ProfilePage } from '../pages/ProfilePage'
import { RouteErrorPage } from '../pages/RouteErrorPage'
import { UnauthorizedPage } from '../pages/UnauthorizedPage'
import { AppShell } from './AppShell'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:projectId', element: <ProjectDetailPage /> },
          {
            // Lazy: keeps PDF.js out of the main bundle.
            path: 'projects/:projectId/pages/:pageId',
            lazy: async () => ({ Component: (await import('../features/viewer/PageViewerPage')).PageViewerPage }),
          },
          {
            path: 'projects/:projectId/abm',
            lazy: async () => ({ Component: (await import('../features/abm/AbmPage')).AbmPage }),
          },
          {
            path: 'projects/:projectId/history',
            lazy: async () => ({ Component: (await import('../features/review-summary/ProjectHistoryPage')).ProjectHistoryPage }),
          },
          {
            path: 'projects/:projectId/columns',
            lazy: async () => ({ Component: (await import('../features/columns/ColumnSchedulePage')).ColumnSchedulePage }),
          },
          {
            path: 'projects/:projectId/revisions/:setId',
            lazy: async () => ({ Component: (await import('../features/revisions/RevisionPage')).RevisionPage }),
          },
          {
            path: 'projects/:projectId/wireframe',
            lazy: async () => ({ Component: (await import('../features/wireframe/WireframePage')).WireframePage }),
          },
          { path: 'connection-templates', element: <TemplatesPage /> },
          { path: 'profile', element: <ProfilePage /> },
          {
            path: 'admin/users',
            element: (
              <RequireCapability capability="users.manage">
                <UsersPage />
              </RequireCapability>
            ),
          },
          {
            path: 'admin/sections',
            element: (
              <RequireCapability capability="users.manage">
                <SectionDataPage />
              </RequireCapability>
            ),
          },
          {
            path: 'ops',
            element: (
              <RequireCapability capability="ops.view">
                <OpsPage />
              </RequireCapability>
            ),
          },
          { path: 'unauthorized', element: <UnauthorizedPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
