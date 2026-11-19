import { type CSSProperties, memo, useMemo } from 'react'

import type { ExtractedMember } from '../../api/types'
import { toViewportRect } from './geometry'
import { memberKind } from './memberAppearance'
import type { PageViewport } from './pdf'
import { TEKLA_COLOURS, type TeklaColour } from './teklaColours'

interface MemberOverlayProps {
  viewport: PageViewport
  members: ExtractedMember[]
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  /** Tekla checking colours by member id: each coloured member is drawn along its span too. */
  colours?: Map<string, TeklaColour> | null
}

/**
 * Outlines each detected member label on the drawing. Pointer only: the keyboard path to the
 * same members is the Quantities list (one focus stop per member there, not hundreds here).
 */
export const MemberOverlay = memo(function MemberOverlay({ viewport, members, selectedId, hoveredId, onSelect, onHover, colours }: MemberOverlayProps) {
  const shapes = useMemo(
    () =>
      members
        .filter((m) => m.label_bbox)
        .map((m) => ({
          member: m,
          rect: toViewportRect(viewport, m.label_bbox!),
          kind: memberKind(m),
        })),
    [members, viewport],
  )

  // The measured span (support centre to support centre) of the selected member.
  const selected = members.find((m) => m.id === selectedId)
  const selectedSpan = useMemo(() => {
    if (!selected || selected.geometry.length < 2 || selected.length_mm == null) return null
    const [[ax, ay], [bx, by]] = selected.geometry as [[number, number], [number, number]]
    const [x1, y1] = viewport.convertToViewportPoint(ax, ay)
    const [x2, y2] = viewport.convertToViewportPoint(bx, by)
    return { x1: x1!, y1: y1!, x2: x2!, y2: y2! }
  }, [selected, viewport])

  // With the Tekla colours on, every coloured member's span, dashed like the old Wireframer's.
  const spans = useMemo(() => {
    if (!colours) return []
    return members.flatMap((m) => {
      const colour = colours.get(m.id)
      if (!colour || m.geometry.length < 2) return []
      const [[ax, ay], [bx, by]] = m.geometry as [[number, number], [number, number]]
      const [x1, y1] = viewport.convertToViewportPoint(ax, ay)
      const [x2, y2] = viewport.convertToViewportPoint(bx, by)
      return [{ id: m.id, colour: TEKLA_COLOURS[colour].colour, x1: x1!, y1: y1!, x2: x2!, y2: y2! }]
    })
  }, [members, viewport, colours])

  return (
    <svg
      className="member-overlay"
      width={viewport.width}
      height={viewport.height}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      aria-hidden="true"
    >
      {spans.length > 0 && (
        <g className="tekla-spans" aria-hidden="true">
          {spans.map((l) => (
            <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.colour} />
          ))}
        </g>
      )}
      {selectedSpan && (
        <g className="member-span" aria-hidden="true">
          <line x1={selectedSpan.x1} y1={selectedSpan.y1} x2={selectedSpan.x2} y2={selectedSpan.y2} />
          <circle cx={selectedSpan.x1} cy={selectedSpan.y1} r={4} />
          <circle cx={selectedSpan.x2} cy={selectedSpan.y2} r={4} />
        </g>
      )}
      {shapes.map(({ member, rect, kind }) => {
        const colour = colours?.get(member.id)
        return (
          <rect
            key={member.id}
            data-member-id={member.id}
            data-kind={kind}
            data-tekla={colour}
            style={colour ? ({ '--tekla': TEKLA_COLOURS[colour].colour } as CSSProperties) : undefined}
            data-selected={member.id === selectedId || undefined}
            data-hovered={member.id === hoveredId || undefined}
            className={`member-shape member-shape--${kind}`}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={2}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(member.id)
            }}
            onPointerEnter={() => onHover(member.id)}
            onPointerLeave={() => onHover(null)}
          >
            <title>{`${member.designation} — ${colour ? TEKLA_COLOURS[colour].label : memberKind(member)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
})
