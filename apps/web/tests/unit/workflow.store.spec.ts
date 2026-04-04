import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkflowStore } from '../../features/workflow/store'

describe('useWorkflowStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('tracks non-url workflow fetch and polling state', () => {
    const workflow = useWorkflowStore()

    workflow.setListFetching(true)
    workflow.markListSynced()
    workflow.setDetailPollingEnabled(false)

    expect(workflow.isListFetching).toBe(true)
    expect(workflow.lastListSyncedAt).toEqual(expect.any(Number))
    expect(workflow.detailPollingEnabled).toBe(false)
  })
})
