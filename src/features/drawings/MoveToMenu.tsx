import * as Menu from '@radix-ui/react-dropdown-menu'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { setPagesKind } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import { notify } from '../../components/feedback/toastStore'
import { MOVABLE_GROUPS, groupLabel, type KindGroup } from './sheets'

interface MoveToMenuProps {
  projectId: string
  pageIds: string[]
  /** The tab the page is in now (one page): ticked in the menu. */
  current?: KindGroup
  /** The tab of the kind read from the page (one page): "As read" names it. */
  asRead?: KindGroup
  /** Whether a person moved the page (one page): only then is "As read" offered. */
  moved?: boolean
  trigger: ReactNode
  triggerClassName: string
  triggerLabel: string
  disabled?: boolean
  onDone?: () => void
}

/** Move pages to another tab of the project page (Plans, Elevations …). It only changes where
 *  they are listed: what Steelo read from them stays as it was. */
export function MoveToMenu({
  projectId,
  pageIds,
  current,
  asRead,
  moved,
  trigger,
  triggerClassName,
  triggerLabel,
  disabled,
  onDone,
}: MoveToMenuProps) {
  const queryClient = useQueryClient()
  const move = useMutation({
    mutationFn: (kind: string) => setPagesKind(projectId, pageIds, kind),
    meta: { suppressErrorToast: true },
    onSuccess: ({ updated }, kind) => {
      const pages = `${updated} ${updated === 1 ? 'page' : 'pages'}`
      if (updated) notify.success(kind ? `${pages} moved to ${groupLabel(kind as KindGroup)}` : `${pages} back where read`)
      onDone?.()
      return queryClient.invalidateQueries({ queryKey: ['drawing-set'] })
    },
    onError: (error) => notify.error('Could not move the pages', toApiError(error).message),
  })
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerClassName} aria-label={triggerLabel} disabled={disabled || move.isPending}>
        {trigger}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={6}>
          <div className="menu__header">
            <span>Move to tab</span>
          </div>
          {MOVABLE_GROUPS.map((g) => (
            <Menu.Item
              key={g.key}
              className="menu__item"
              disabled={g.key === current}
              onSelect={() => move.mutate(g.key)}
            >
              {g.label}
              {g.key === current ? ' ✓' : ''}
            </Menu.Item>
          ))}
          {(moved || current === undefined) && (
            <>
              <Menu.Separator className="menu__separator" />
              <Menu.Item className="menu__item" onSelect={() => move.mutate('')}>
                {asRead ? `As read (${groupLabel(asRead)})` : 'As read'}
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
