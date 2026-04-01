import { describe, expect, it } from 'vitest'

import {
  normalizeBooleanQuery,
  normalizeGraphDepth,
  normalizeGraphView,
  normalizeOptionalString
} from '../../features/graph/route'

describe('graph route normalizers', () => {
  it('normalizes optional strings', () => {
    expect(normalizeOptionalString(undefined)).toBeNull()
    expect(normalizeOptionalString('   ')).toBeNull()
    expect(normalizeOptionalString(' alpha ')).toBe('alpha')
  })

  it('normalizes boolean query values with fallback', () => {
    expect(normalizeBooleanQuery('true', false)).toBe(true)
    expect(normalizeBooleanQuery('false', true)).toBe(false)
    expect(normalizeBooleanQuery(null, true)).toBe(true)
  })

  it('normalizes graph view and depth', () => {
    expect(normalizeGraphView('tree')).toBe('tree')
    expect(normalizeGraphView('unknown')).toBe('mesh')

    expect(normalizeGraphDepth('2')).toBe(2)
    expect(normalizeGraphDepth('99')).toBe(3)
    expect(normalizeGraphDepth('-2')).toBe(0)
    expect(normalizeGraphDepth('invalid')).toBe(1)
  })
})
