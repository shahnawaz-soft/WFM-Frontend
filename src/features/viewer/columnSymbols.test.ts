import { describe, expect, it } from 'vitest'

import { describeColumn } from './columnSymbols'
import { isColumnMember, lengthNote } from './memberAppearance'
import type { ExtractedMember } from '../../api/types'

describe('column descriptions', () => {
  it('leads with the section when a label is tied to the symbol', () => {
    expect(describeColumn({ shape: 'wide_flange', depth_in: 13.6, flange_in: 12.5, designation: 'W12X120' })).toBe(
      'W12X120 · Wide-flange column (I), drawn about 13.6" × 12.5"',
    )
    expect(describeColumn({ shape: 'square_tube', depth_in: 5, flange_in: 5, designation: '' })).toBe('Square tube column, drawn about 5"')
  })

  it('explains that a labelled column takes its height from the levels', () => {
    const member = { warnings: ['column_by_leader'] } as unknown as ExtractedMember
    expect(lengthNote(member)).toBe('Column: height from levels')
  })

  it('knows column members, whatever case their type is typed in', () => {
    expect([isColumnMember({ member_type: 'column' }), isColumnMember({ member_type: ' Col ' }), isColumnMember({ member_type: '' })]).toEqual([
      true,
      true,
      false,
    ])
  })
})
