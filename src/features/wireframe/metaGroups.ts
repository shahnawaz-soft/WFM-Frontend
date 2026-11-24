import type { ColumnMetaGroup, SchedulerRow } from '../../api/types'

/** What a meta-group keeps a column by: its extracted member, so a newly generated revision
 *  keeps the group (a column added in the model has none: its own id). */
export const memberKey = (row: SchedulerRow): string => row.source_member ?? row.id

/** The columns of this revision in a meta-group. */
export function rowsOf(group: ColumnMetaGroup, rows: SchedulerRow[]): SchedulerRow[] {
  const members = new Set(group.members)
  return rows.filter((r) => members.has(memberKey(r)))
}

/** Colours told apart in the grid view (status is never colour alone: the list names them). */
export const META_COLOURS = ['#d97706', '#0891b2', '#7c3aed', '#16a34a', '#db2777', '#4f46e5', '#65a30d', '#b91c1c']
