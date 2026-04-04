import { describe, expect, it } from 'vitest'

import {
  normalizeSocialRouteValue,
  normalizeSocialSort
} from '../../features/social/route'

describe('social route normalizers', () => {
  it('normalizes optional social route values', () => {
    expect(normalizeSocialRouteValue(undefined)).toBeNull()
    expect(normalizeSocialRouteValue('   ')).toBeNull()
    expect(normalizeSocialRouteValue(' circle-1 ')).toBe('circle-1')
  })

  it('normalizes social sort with latest fallback', () => {
    expect(normalizeSocialSort('signal')).toBe('signal')
    expect(normalizeSocialSort('latest')).toBe('latest')
    expect(normalizeSocialSort('unknown')).toBe('latest')
  })
})
