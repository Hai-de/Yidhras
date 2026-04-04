import { describe, expect, it } from 'vitest'

import { normalizeTimelineRouteValue } from '../../features/timeline/route'

describe('timeline route normalizers', () => {
  it('normalizes event and tick query values', () => {
    expect(normalizeTimelineRouteValue(undefined)).toBeNull()
    expect(normalizeTimelineRouteValue('   ')).toBeNull()
    expect(normalizeTimelineRouteValue(' 1024 ')).toBe('1024')
  })
})
