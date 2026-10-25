import { createBrowserRouter, Outlet, type RouteObject } from 'react-router'

import { RequireAuth, RequireCapability } from '../auth/guards'
import { ProjectDetailPage } from '../features/projects/ProjectDetailPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
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
            // One column scheduler: on the wireframe page (the old read-only schedule page's link).
            path: 'projects/:projectId/columns',
            lazy: async () => ({ Component: (await import('../features/wireframe/ColumnsRedirect')).ColumnsRedirect }),
          },
          {
            path: 'projects/:projectId/revisions/:setId',
            lazy: async () => ({ Component: (await import('../features/revisions/RevisionPage')).RevisionPage }),
          },
          {
            path: 'projects/:projectId/wireframe',
            lazy: async () => ({ Component: (await import('../features/wireframe/WireframePage')).WireframePage }),
          },
          {
            path: 'connection-templates',
            lazy: async () => ({ Component: (await import('../features/connections/TemplatesPage')).TemplatesPage }),
          },
          { path: 'profile', element: <ProfilePage /> },
          {
            // Admin pages: few people open them, so they stay out of the main bundle.
            element: (
              <RequireCapability capability="users.manage">
                <Outlet />
              </RequireCapability>
            ),
            children: [
              {
                path: 'admin/users',
                lazy: async () => ({ Component: (await import('../features/users/UsersPage')).UsersPage }),
              },
              {
                path: 'admin/sections',
                lazy: async () => ({ Component: (await import('../features/sections/SectionDataPage')).SectionDataPage }),
              },
            ],
          },
          {
            element: (
              <RequireCapability capability="ops.view">
                <Outlet />
              </RequireCapability>
            ),
            children: [{ path: 'ops', lazy: async () => ({ Component: (await import('../features/ops/OpsPage')).OpsPage }) }],
          },
          { path: 'unauthorized', element: <UnauthorizedPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
