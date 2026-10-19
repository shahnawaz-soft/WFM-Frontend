import { useQuery } from '@tanstack/react-query'

import type { LevelProposal } from '../../api/types'
import { getLevelProposals } from '../../api/wireframe'

export const PROPOSAL_ISSUES: Record<string, string> = {
  no_level_title: 'No level in the sheet title',
  title_names_two_levels: 'The title names two levels: check which this is',
  no_elevation_marked: 'No elevation marked for this level on the elevation or section sheets: type it',
  elevation_alternatives: 'Marked with another elevation too: check',
  no_common_grid_point: 'This plan shows no grid crossing the other plans place: pick one by hand',
  aligned_on_other_crossing: "This plan doesn't show the shared crossing: aligned on another one the other plans place",
  elevation_typed_on_other_page: 'Elevation typed on another plan of this level',
}

/** What a proposal would set: the fields it has a value for. */
export const hasProposal = (p: LevelProposal) => Boolean(p.level_label || p.elevation_mm != null || p.reference_point)

/** The proposals differ from what the page has now (worth applying). */
export const differs = (p: LevelProposal) =>
  (p.level_label && p.level_label !== p.current.level_label) ||
  (p.elevation_mm != null && p.elevation_mm !== p.current.elevation_mm) ||
  (p.reference_point && (!p.current.has_reference_point || p.reference_label !== p.current.reference_label))

/** Where a page's level form stands against the drawings' proposal: saved already, filled in
 * but not saved, or different (worth offering). ``form`` holds what ``Use these`` would put
 * in it; ``point`` is the reference point picked but not saved, if any. */
export function proposalState(
  p: LevelProposal,
  form: { level_label: string; elevation: string; reference_label: string },
  saved: { level_label: string; elevation: string; reference_label: string },
  point: [number, number] | null,
): 'applied' | 'filled' | 'differs' {
  const edited =
    point != null ||
    form.level_label !== saved.level_label ||
    form.elevation !== saved.elevation ||
    form.reference_label !== saved.reference_label
  if (!edited) return differs(p) ? 'differs' : 'applied'
  const [px, py] = p.reference_point ?? []
  const filled =
    (!p.level_label || form.level_label === p.level_label) &&
    (p.elevation_mm == null || form.elevation === p.elevation_display) &&
    (!p.reference_label || form.reference_label === p.reference_label) &&
    (!p.reference_point || (point != null && point[0] === px && point[1] === py))
  return filled ? 'filled' : 'differs'
}

export function useLevelProposals(projectId: string) {
  return useQuery({ queryKey: ['level-proposals', projectId], queryFn: () => getLevelProposals(projectId) })
}
