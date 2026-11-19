import type { WireframeElement } from '../../api/types'
import { editElement, removeElement, restoreElement, type ElementChanges, type Point } from '../../api/wireframe'

/** Undo and redo of the changes made to a revision's elements on this page (the old
 *  Wireframer's Ctrl+Z): an edit is undone by editing back, an addition by removing it, a
 *  removal by restoring it. Each step is saved as any change is, noted "Undo" / "Redo". */

export type Values = Required<Pick<ElementChanges, 'element_type' | 'designation' | 'level_label'>> & Pick<ElementChanges, 'start' | 'end'>

export type Change =
  | { kind: 'edit'; id: string; before: Values; after: Values }
  | { kind: 'add'; id: string }
  | { kind: 'remove'; id: string }

export function valuesOf(e: WireframeElement): Values {
  return {
    element_type: e.element_type,
    designation: e.designation,
    level_label: e.level_label,
    ...(e.start && e.end ? { start: e.start as unknown as Point, end: e.end as unknown as Point } : {}),
  }
}

export interface History {
  past: Change[]
  future: Change[]
  /** Each element's version after our last step on it: a removed one isn't listed any more. */
  versions: Record<string, number>
}

export const EMPTY_HISTORY: History = { past: [], future: [], versions: {} }

/** A change made: undoable, and nothing left to redo. */
export function record(history: History, change: Change, version: number): History {
  return { past: [...history.past, change], future: [], versions: { ...history.versions, [change.id]: version } }
}

/** Do ``change`` backwards (undo) or forwards (redo); the element's version after it. */
async function apply(change: Change, version: number, forwards: boolean): Promise<number> {
  const note = forwards ? 'Redo' : 'Undo'
  if (change.kind === 'edit') {
    const values = forwards ? change.after : change.before
    return (await editElement(change.id, version, { ...values, reason: note })).version
  }
  const takeOut = change.kind === 'add' ? !forwards : forwards
  if (takeOut) {
    await removeElement(change.id, version, note)
    return version + 1
  }
  return (await restoreElement(change.id, version, note)).version
}

/** One step back (``undo``) or forward; ``listed`` gives an element's current version when the
 *  page lists it. Returns the history after it, or the same history when there is nothing. */
export async function step(history: History, undo: boolean, listed: (id: string) => number | undefined): Promise<History> {
  const from = undo ? history.past : history.future
  const change = from[from.length - 1]
  if (!change) return history
  const version = listed(change.id) ?? history.versions[change.id]
  if (version === undefined) throw new Error('This element is no longer in the revision.')
  const after = await apply(change, version, !undo)
  const rest = from.slice(0, -1)
  const versions = { ...history.versions, [change.id]: after }
  return undo
    ? { past: rest, future: [...history.future, change], versions }
    : { past: [...history.past, change], future: rest, versions }
}
