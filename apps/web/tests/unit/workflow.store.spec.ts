import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkflowStore } from '../../features/workflow/store'

describe('useWorkflowStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('tracks selection state for job, trace and intent', () => {
    const workflow = useWorkflowStore()

    workflow.setSelectedJobId('job-1')
    workflow.setSelectedTraceId('trace-1')
    workflow.setSelectedIntentId('intent-1')
    workflow.setActiveTab('intent')

    expect(workflow.selectedJobId).toBe('job-1')
    expect(workflow.selectedTraceId).toBe('trace-1')
    expect(workflow.selectedIntentId).toBe('intent-1')
    expect(workflow.activeTab).toBe('intent')
  })

  it('stores list filters and sync markers', () => {
    const workflow = useWorkflowStore()

    workflow.setListFilters({
      status: 'failed',
      agentId: 'agent-1',
      strategy: 'mock',
      actionIntentId: 'intent-9'
    })
    workflow.setListFetching(true)
    workflow.markListSynced()
    workflow.setDetailPollingEnabled(false)

    expect(workflow.listFilters).toEqual({
      status: 'failed',
      agentId: 'agent-1',
      strategy: 'mock',
      actionIntentId: 'intent-9'
    })
    expect(workflow.isListFetching).toBe(true)
    expect(workflow.lastListSyncedAt).toEqual(expect.any(Number))
    expect(workflow.detailPollingEnabled).toBe(false)
  })
})
