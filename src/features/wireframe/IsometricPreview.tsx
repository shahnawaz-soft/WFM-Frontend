import { useMemo } from 'react'

import type { WireframeElement } from '../../api/types'
import { elementPoints } from './elementPoints'

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = 0.5
const SIZE = { width: 640, height: 400, pad: 24 }

/** A static isometric sketch of the placed elements, to check levels and alignment.
 *  (The interactive 3D view comes with wireframe editing, Phase 14.) */
export function IsometricPreview({ elements, selectedId }: { elements: WireframeElement[]; selectedId: string | null }) {
  const lines = useMemo(() => {
    const project = ([x, y, z]: [number, number, number]) => [(x - y) * COS30, (x + y) * SIN30 - z] as const
    const raw = elements.flatMap((e) => {
      const points = elementPoints(e)
      return points ? [{ e, points: points.map(project) }] : []
    })
    if (!raw.length) return []
    const xs = raw.flatMap((r) => r.points.map((p) => p[0]))
    const ys = raw.flatMap((r) => r.points.map((p) => p[1]))
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const scale = Math.min(
      (SIZE.width - 2 * SIZE.pad) / Math.max(maxX - minX, 1),
      (SIZE.height - 2 * SIZE.pad) / Math.max(maxY - minY, 1),
    )
    const at = ([x, y]: readonly [number, number]) => [SIZE.pad + (x - minX) * scale, SIZE.pad + (y - minY) * scale]
    return raw.map((r) => ({ e: r.e, points: r.points.map(at) }))
  }, [elements])

  if (!lines.length) return <p className="muted">Nothing could be placed yet: complete the level set-up of the pages.</p>
  const beams = lines.filter((l) => l.e.element_type === 'beam').length
  const columns = lines.length - beams
  return (
    <svg
      className="iso-preview"
      viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
      role="img"
      aria-label={`Isometric preview: ${beams} beams and ${columns} columns placed`}
    >
      {lines.map(({ e, points }) => (
        <polyline
          key={e.id}
          points={points.map((p) => `${p[0]},${p[1]}`).join(' ')}
          fill="none"
          className={`iso-preview__${e.element_type}`}
          data-selected={e.id === selectedId || undefined}
        />
      ))}
    </svg>
  )
}
