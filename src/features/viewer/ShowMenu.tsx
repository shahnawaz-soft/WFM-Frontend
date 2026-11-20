import * as Menu from '@radix-ui/react-dropdown-menu'

export interface ShowOption {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  title?: string
}

/** What the drawing shows (labels, grids …), as ticks in one menu instead of a row of boxes.
 *  The menu stays open while ticking, so several can be changed at once. */
export function ShowMenu({ options }: { options: ShowOption[] }) {
  if (options.length === 0) return null
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="button button--secondary">
        Show<span aria-hidden="true"> ▾</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={6}>
          {options.map((o) => (
            <Menu.CheckboxItem
              key={o.label}
              className="menu__item menu__check"
              checked={o.checked}
              title={o.title}
              onCheckedChange={(v) => o.onChange(v === true)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="menu__tick" aria-hidden="true">
                {o.checked ? '☑' : '☐'}
              </span>
              {o.label}
            </Menu.CheckboxItem>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
