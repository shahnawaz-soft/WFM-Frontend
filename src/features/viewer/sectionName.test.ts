import { describe, expect, it } from 'vitest'

import { sectionName } from './memberAppearance'

describe('sectionName', () => {
  it('says what is missing when the drawing gives no section', () => {
    expect(sectionName({ designation: 'W14X99', member_type: 'column' })).toBe('W14X99')
    expect(sectionName({ designation: '', member_type: 'column' })).toBe('Column, no label')
    expect(sectionName({ designation: '', member_type: 'beam' })).toBe('No label')
  })
})
