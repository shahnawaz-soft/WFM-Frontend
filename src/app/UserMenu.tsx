import * as Menu from '@radix-ui/react-dropdown-menu'
import { useNavigate } from 'react-router'

import { GLOBAL_ROLE_LABELS } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  return (
    <Menu.Root>
      <Menu.Trigger className="user-menu__trigger" aria-label={`Account menu for ${user.full_name}`}>
        <span className="user-menu__avatar" aria-hidden="true">
          {(user.first_name || user.email).charAt(0).toUpperCase()}
        </span>
        <span className="user-menu__name">{user.full_name}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={6}>
          <div className="menu__header">
            <strong>{user.full_name}</strong>
            <span>{user.email}</span>
            {user.username && <span>@{user.username}</span>}
            <span>{GLOBAL_ROLE_LABELS[user.global_role]}</span>
          </div>
          <Menu.Separator className="menu__separator" />
          <Menu.Item className="menu__item" onSelect={() => navigate('/profile')}>
            Profile and password
          </Menu.Item>
          <Menu.Item
            className="menu__item"
            onSelect={async () => {
              await signOut()
              navigate('/login', { replace: true })
            }}
          >
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
