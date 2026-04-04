import { describe, expect, it } from 'vitest'

import {
  normalizeWorkflowRouteValue,
  normalizeWorkflowTab
} from '../../features/workflow/route'

describe('workflow route normalizers', () => {
  it('normalizes workflow route values to trimmed strings or null', () => {
    expect(normalizeWorkflowRouteValue(undefined)).toBeNull()
    expect(normalizeWorkflowRouteValue('   ')).toBeNull()
    expect(normalizeWorkflowRouteValue(' job-1 ')).toBe('job-1')
  })

  it('normalizes workflow tabs with job fallback', () => {
    expect(normalizeWorkflowTab('trace')).toBe('trace')
    expect(normalizeWorkflowTab('intent')).toBe('intent')
    expect(normalizeWorkflowTab('workflow')).toBe('workflow')
    expect(normalizeWorkflowTab('unknown')).toBe('job')
    expect(normalizeWorkflowTab(null)).toBe('job')
  })
})
