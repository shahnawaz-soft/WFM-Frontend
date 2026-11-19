import { describe, expect, it } from 'vitest'

import { colourCounts, elementColour, teklaColour } from './teklaColours'

const DATA = { classes: { a: '3', b: '13', c: '2', d: '4' }, skipped: [{ id: 'e' }] }

describe('Tekla colours', () => {
  it('a member takes the colour of the class Push to Tekla sends', () => {
    expect(['a', 'b', 'c', 'd'].map((id) => teklaColour(DATA, id))).toEqual(['grid', 'equal', 'scaled', 'column'])
  })

  it('a member left out of the export is "not sent"; one not in it has none', () => {
    expect(teklaColour(DATA, 'e')).toBe('unsent')
    expect(teklaColour(DATA, 'zzz')).toBeNull()
  })

  it('in 3D: columns red, a person’s additions and edits purple, else the member’s class', () => {
    const beam = { element_type: 'beam', provenance: 'generated', source_member: 'b' }
    expect(elementColour(DATA, beam)).toBe('equal')
    expect(elementColour(DATA, { ...beam, element_type: 'column', source_member: null })).toBe('column')
    expect(elementColour(DATA, { ...beam, provenance: 'added', source_member: null })).toBe('manual')
    expect(elementColour(DATA, { ...beam, provenance: 'edited' })).toBe('manual')
    expect(elementColour(DATA, { ...beam, source_member: 'zzz' })).toBe('unsent')
  })

  it('counts each colour in the legend’s order', () => {
    expect(colourCounts(['scaled', 'grid', null, 'scaled'])).toEqual([
      ['grid', 1],
      ['scaled', 2],
    ])
  })
})
