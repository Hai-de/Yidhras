import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { normalizeOptionalString } from '../../lib/route/query'

export const useSchedulerRouteState = () => {
  const partitionIdQuery = useRouteQuery<string | null>('partition_id', null, { mode: 'replace' })
  const workerIdQuery = useRouteQuery<string | null>('worker_id', null, { mode: 'replace' })
  const runIdQuery = useRouteQuery<string | null>('run_id', null, { mode: 'replace' })
  const decisionIdQuery = useRouteQuery<string | null>('decision_id', null, { mode: 'replace' })

  const filters = computed(() => ({
    partitionId: normalizeOptionalString(partitionIdQuery.value),
    workerId: normalizeOptionalString(workerIdQuery.value),
    runId: normalizeOptionalString(runIdQuery.value),
    decisionId: normalizeOptionalString(decisionIdQuery.value)
  }))

  const setFilters = (input: {
    partitionId?: string | null
    workerId?: string | null
    runId?: string | null
    decisionId?: string | null
  }) => {
    partitionIdQuery.value = normalizeOptionalString(input.partitionId)
    workerIdQuery.value = normalizeOptionalString(input.workerId)
    runIdQuery.value = normalizeOptionalString(input.runId)
    decisionIdQuery.value = normalizeOptionalString(input.decisionId)
  }

  return {
    filters,
    setFilters
  }
}
