import { NavLink, Outlet } from 'react-router'

import type { Capability } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { GlobalActivityIndicator } from '../components/feedback/GlobalActivityIndicator'
import { Icon, type IconName } from '../components/ui/Icon'
import { env } from '../lib/env'
import { UserMenu } from './UserMenu'

interface NavItem {
  to: string
  label: string
  icon: IconName
  end?: boolean
  /** Shown only to users with this capability (the API enforces it independently). */
  requires?: Capability
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/projects', label: 'Projects', icon: 'projects' },
  { to: '/connection-templates', label: 'Connection templates', icon: 'templates' },
  { to: '/admin/users', label: 'Users', icon: 'users', requires: 'users.manage' },
  { to: '/admin/sections', label: 'Section data', icon: 'sections', requires: 'users.manage' },
  { to: '/ops', label: 'Operations', icon: 'operations', requires: 'ops.view' },
]

export function AppShell() {
  const { can } = useAuth()
  const items = NAV_ITEMS.filter((item) => !item.requires || can(item.requires))

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <GlobalActivityIndicator />
      <aside className="app-sidebar">
        <NavLink to="/" className="app-header__brand">
          {/* Decorative: the link's accessible name is the text "Steelo". */}
          <img src="/sologo-64.png" alt="" width="32" height="32" className="app-header__mark" />
          <span className="app-sidebar__label">Steelo</span>
        </NavLink>
        <nav aria-label="Main">
          <ul className="app-nav">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end}>
                  <Icon name={item.icon} />
                  <span className="app-sidebar__label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="app-sidebar__end">
          <UserMenu />
          <p className="app-footer">Steelo {env.appVersion}</p>
        </div>
      </aside>
      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
