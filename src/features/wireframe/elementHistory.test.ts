import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WireframeElement } from '../../api/types'
import { EMPTY_HISTORY, record, step, valuesOf } from './elementHistory'

const calls: string[] = []
vi.mock('../../api/wireframe', () => ({
  editElement: async (id: string, version: number, changes: { designation: string; reason: string }) => {
    calls.push(`edit ${id} v${version} ${changes.designation} (${changes.reason})`)
    return { id, version: version + 1 }
  },
  removeElement: async (id: string, version: number, reason: string) => {
    calls.push(`remove ${id} v${version} (${reason})`)
  },
  restoreElement: async (id: string, version: number, reason: string) => {
    calls.push(`restore ${id} v${version} (${reason})`)
    return { id, version: version + 1 }
  },
}))

const element = (designation: string, version: number) =>
  ({ id: 'e1', version, element_type: 'beam', designation, level_label: 'L2', start: ['0', '0', '0'], end: ['1000', '0', '0'] }) as unknown as WireframeElement

beforeEach(() => {
  calls.length = 0
})

describe('undo and redo of element changes', () => {
  it('an edit is undone by editing back and redone by editing again', async () => {
    let h = record(EMPTY_HISTORY, { kind: 'edit', id: 'e1', before: valuesOf(element('W12X26', 1)), after: valuesOf(element('W12X30', 2)) }, 2)
    h = await step(h, true, () => 2)
    h = await step(h, false, () => 3)
    expect(calls).toEqual(['edit e1 v2 W12X26 (Undo)', 'edit e1 v3 W12X30 (Redo)'])
    expect(h.past).toHaveLength(1)
    expect(h.future).toHaveLength(0)
  })

  it('a removal is undone by restoring it, at the version the removal left (it is not listed)', async () => {
    let h = record(EMPTY_HISTORY, { kind: 'remove', id: 'e1' }, 4)
    h = await step(h, true, () => undefined)
    expect(calls).toEqual(['restore e1 v4 (Undo)'])
    h = await step(h, false, () => 5)
    expect(calls[1]).toBe('remove e1 v5 (Redo)')
  })

  it('an addition is undone by removing it; a new change clears what was left to redo', async () => {
    let h = record(EMPTY_HISTORY, { kind: 'add', id: 'e1' }, 1)
    h = await step(h, true, () => 1)
    expect(calls).toEqual(['remove e1 v1 (Undo)'])
    expect(h.future).toHaveLength(1)
    h = record(h, { kind: 'add', id: 'e2' }, 1)
    expect(h.future).toHaveLength(0)
  })

  it('with nothing to undo, nothing happens', async () => {
    expect(await step(EMPTY_HISTORY, true, () => 1)).toBe(EMPTY_HISTORY)
    expect(calls).toEqual([])
  })
})
