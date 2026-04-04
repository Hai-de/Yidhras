import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { normalizeOptionalString } from '../../lib/route/query'

export type WorkflowRouteTab = 'job' | 'trace' | 'intent' | 'workflow'

export const normalizeWorkflowRouteValue = (value: string | null | undefined): string | null => {
  return normalizeOptionalString(value)
}

export const normalizeWorkflowTab = (value: string | null | undefined): WorkflowRouteTab => {
  switch (value) {
    case 'trace':
    case 'intent':
    case 'workflow':
      return value
    default:
      return 'job'
  }
}

export const useWorkflowRouteState = () => {
  const jobIdQuery = useRouteQuery<string | null>('job_id', null, { mode: 'replace' })
  const traceIdQuery = useRouteQuery<string | null>('trace_id', null, { mode: 'replace' })
  const tabQuery = useRouteQuery<string | null>('tab', null, { mode: 'replace' })
  const statusQuery = useRouteQuery<string | null>('status', null, { mode: 'replace' })
  const agentIdQuery = useRouteQuery<string | null>('agent_id', null, { mode: 'replace' })
  const strategyQuery = useRouteQuery<string | null>('strategy', null, { mode: 'replace' })
  const actionIntentIdQuery = useRouteQuery<string | null>('action_intent_id', null, {
    mode: 'replace'
  })

  const selectedJobId = computed(() => normalizeWorkflowRouteValue(jobIdQuery.value))
  const selectedTraceId = computed(() => normalizeWorkflowRouteValue(traceIdQuery.value))
  const selectedTab = computed(() => normalizeWorkflowTab(tabQuery.value))
  const filters = computed(() => ({
    status: normalizeWorkflowRouteValue(statusQuery.value),
    agentId: normalizeWorkflowRouteValue(agentIdQuery.value),
    strategy: normalizeWorkflowRouteValue(strategyQuery.value),
    actionIntentId: normalizeWorkflowRouteValue(actionIntentIdQuery.value)
  }))

  const setSelectedJobId = (jobId: string | null) => {
    jobIdQuery.value = normalizeWorkflowRouteValue(jobId)
  }

  const setSelectedTraceId = (traceId: string | null) => {
    traceIdQuery.value = normalizeWorkflowRouteValue(traceId)
  }

  const setSelectedTab = (tab: WorkflowRouteTab) => {
    tabQuery.value = tab === 'job' ? null : tab
  }

  const setFilters = (nextFilters: {
    status?: string | null
    agentId?: string | null
    strategy?: string | null
    actionIntentId?: string | null
  }) => {
    statusQuery.value = normalizeWorkflowRouteValue(nextFilters.status)
    agentIdQuery.value = normalizeWorkflowRouteValue(nextFilters.agentId)
    strategyQuery.value = normalizeWorkflowRouteValue(nextFilters.strategy)
    actionIntentIdQuery.value = normalizeWorkflowRouteValue(nextFilters.actionIntentId)
  }

  return {
    selectedJobId,
    selectedTraceId,
    selectedTab,
    filters,
    setSelectedJobId,
    setSelectedTraceId,
    setSelectedTab,
    setFilters
  }
}
