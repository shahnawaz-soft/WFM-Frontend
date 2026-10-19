import { describe, expect, it } from 'vitest'

import type { WireframeElement } from '../../api/types'
import { elementPoints } from './elementPoints'

const element = (extra: Partial<WireframeElement>) =>
  ({ start: ['0', '0', '0'], end: ['100', '0', '0'], details: {}, ...extra }) as unknown as WireframeElement

describe('element points', () => {
  it('draws a straight member through its ends', () => {
    expect(elementPoints(element({}))).toEqual([
      [0, 0, 0],
      [100, 0, 0],
    ])
  })

  it('draws a curved member through its path', () => {
    const path = [
      ['0', '0', '0'],
      ['50', '20', '0'],
      ['100', '0', '0'],
    ]
    expect(elementPoints(element({ details: { path } }))).toHaveLength(3)
  })

  it('has nothing to draw when not placed', () => {
    expect(elementPoints(element({ start: null }))).toBeNull()
  })
})
