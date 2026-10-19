import { describe, expect, it } from 'vitest'

import { safeDestination } from './safeDestination'

describe('safeDestination', () => {
  it.each([
    ['/admin/users?x=1', '/admin/users?x=1'],
    ['/', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    [undefined, '/'],
    [42, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeDestination(input)).toBe(expected)
  })
})
