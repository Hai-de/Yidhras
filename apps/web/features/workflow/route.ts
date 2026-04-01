import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { normalizeOptionalString } from '../../lib/route/query'
import { useWorkflowStore } from './store'

export const useWorkflowRouteState = () => {
  const workflow = useWorkflowStore()

  const jobIdQuery = useRouteQuery<string | null>('job_id', null, { mode: 'replace' })
  const traceIdQuery = useRouteQuery<string | null>('trace_id', null, { mode: 'replace' })
  const tabQuery = useRouteQuery<string | null>('tab', null, { mode: 'replace' })
  const statusQuery = useRouteQuery<string | null>('status', null, { mode: 'replace' })
  const agentIdQuery = useRouteQuery<string | null>('agent_id', null, { mode: 'replace' })
  const strategyQuery = useRouteQuery<string | null>('strategy', null, { mode: 'replace' })
  const actionIntentIdQuery = useRouteQuery<string | null>('action_intent_id', null, {
    mode: 'replace'
  })

  const selectedJobId = computed(() => normalizeOptionalString(jobIdQuery.value))
  const selectedTraceId = computed(() => normalizeOptionalString(traceIdQuery.value))
  const selectedTab = computed(() => normalizeOptionalString(tabQuery.value) ?? 'job')
  const filters = computed(() => ({
    status: normalizeOptionalString(statusQuery.value),
    agentId: normalizeOptionalString(agentIdQuery.value),
    strategy: normalizeOptionalString(strategyQuery.value),
    actionIntentId: normalizeOptionalString(actionIntentIdQuery.value)
  }))

  const applyRouteToStore = () => {
    workflow.setSelectedJobId(selectedJobId.value)
    workflow.setSelectedTraceId(selectedTraceId.value)
    workflow.setSelectedIntentId(selectedTab.value === 'intent' ? selectedTraceId.value : null)
  }

  const setSelectedJobId = (jobId: string | null) => {
    jobIdQuery.value = normalizeOptionalString(jobId)
    workflow.setSelectedJobId(normalizeOptionalString(jobId))
  }

  const setSelectedTraceId = (traceId: string | null) => {
    traceIdQuery.value = normalizeOptionalString(traceId)
    workflow.setSelectedTraceId(normalizeOptionalString(traceId))
  }

  const setSelectedTab = (tab: 'job' | 'trace' | 'intent' | 'workflow') => {
    tabQuery.value = tab === 'job' ? null : tab
  }

  const setFilters = (nextFilters: {
    status?: string | null
    agentId?: string | null
    strategy?: string | null
    actionIntentId?: string | null
  }) => {
    statusQuery.value = normalizeOptionalString(nextFilters.status)
    agentIdQuery.value = normalizeOptionalString(nextFilters.agentId)
    strategyQuery.value = normalizeOptionalString(nextFilters.strategy)
    actionIntentIdQuery.value = normalizeOptionalString(nextFilters.actionIntentId)
  }

  return {
    selectedJobId,
    selectedTraceId,
    selectedTab,
    filters,
    applyRouteToStore,
    setSelectedJobId,
    setSelectedTraceId,
    setSelectedTab,
    setFilters
  }
}
