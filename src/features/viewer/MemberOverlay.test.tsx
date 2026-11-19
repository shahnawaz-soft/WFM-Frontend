import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ExtractedMember } from '../../api/types'
import { MemberOverlay } from './MemberOverlay'
import type { PageViewport } from './pdf'
import type { TeklaColour } from './teklaColours'

const viewport = {
  width: 200,
  height: 200,
  scale: 1,
  convertToViewportPoint: (x: number, y: number) => [x, 200 - y],
} as unknown as PageViewport

const member = (id: string) =>
  ({
    id,
    designation: 'W12X26',
    label_bbox: [10, 10, 30, 16],
    geometry: [
      [0, 20],
      [100, 20],
    ],
    review_status: 'pending',
    warnings: [],
    low_confidence: false,
  }) as unknown as ExtractedMember

function draw(colours?: Map<string, TeklaColour>) {
  return render(
    <MemberOverlay viewport={viewport} members={[member('a'), member('b')]} selectedId={null} hoveredId={null} onSelect={() => {}} onHover={() => {}} colours={colours} />,
  ).container
}

describe('Tekla colours on the page', () => {
  it('draws each coloured member along its span and colours its label box', () => {
    const page = draw(new Map([['a', 'grid']]))
    const spans = page.querySelectorAll('.tekla-spans line')
    expect(spans).toHaveLength(1)
    expect(spans[0]).toHaveAttribute('stroke', '#00ff04')
    expect(page.querySelector('[data-member-id="a"]')).toHaveAttribute('data-tekla', 'grid')
    expect(page.querySelector('[data-member-id="b"]')).not.toHaveAttribute('data-tekla')
  })

  it('without the colours the page is as before', () => {
    const page = draw()
    expect(page.querySelector('.tekla-spans')).toBeNull()
    expect(page.querySelector('[data-tekla]')).toBeNull()
  })
})
