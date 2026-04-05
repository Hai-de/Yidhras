import { computed, ref, watch } from 'vue'

import type {
  SchedulerDecisionItem,
  SchedulerOperatorProjection,
  SchedulerRunReadModel
} from '../../../composables/api/useSchedulerApi'
import { useSchedulerApi } from '../../../composables/api/useSchedulerApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useNotificationsStore } from '../../../stores/notifications'
import { useOperatorNavigation } from '../../shared/navigation'
import { useOperatorSourceContext } from '../../shared/source-context'
import { useSchedulerRouteState } from '../route'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown scheduler workspace error'
}

export const useSchedulerPage = () => {
  const schedulerApi = useSchedulerApi()
  const navigation = useOperatorNavigation()
  const notifications = useNotificationsStore()
  const sourceContext = useOperatorSourceContext()
  const routeState = useSchedulerRouteState()

  const projection = ref<SchedulerOperatorProjection | null>(null)
  const selectedRun = ref<SchedulerRunReadModel | null>(null)
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)

  const fetchProjection = async () => {
    isFetching.value = true
    try {
      const snapshot = await schedulerApi.getOperatorProjection({ sampleRuns: 12, recentLimit: 6 })
      projection.value = snapshot
      errorMessage.value = null
      lastSyncedAt.value = Date.now()
    } catch (error) {
      const message = getErrorMessage(error)
      errorMessage.value = message
      notifications.pushLocalItem({
        level: 'error',
        content: `Scheduler workspace refresh failed: ${message}`,
        code: 'scheduler_workspace_refresh_failed'
      })
    } finally {
      isFetching.value = false
    }
  }

  const fetchSelectedRun = async (runId: string | null) => {
    if (!runId) {
      selectedRun.value = null
      return
    }

    try {
      selectedRun.value = await schedulerApi.getRunById(runId)
    } catch (error) {
      const message = getErrorMessage(error)
      notifications.pushLocalItem({
        level: 'error',
        content: `Scheduler run detail refresh failed: ${message}`,
        code: 'scheduler_run_detail_refresh_failed'
      })
    }
  }

  const polling = useVisibilityPolling(fetchProjection, {
    visibleIntervalMs: 10000,
    hiddenIntervalMs: 20000,
    immediate: true,
    refreshOnVisible: true
  })

  watch(
    () => routeState.filters.value.runId,
    runId => {
      void fetchSelectedRun(runId)
    },
    { immediate: true }
  )

  const filteredRuns = computed(() => {
    const items = projection.value?.recent_runs ?? []
    const { partitionId, workerId } = routeState.filters.value

    return items.filter(item => {
      if (partitionId && item.partition_id !== partitionId) {
        return false
      }
      if (workerId && item.worker_id !== workerId) {
        return false
      }
      return true
    })
  })

  const filteredDecisions = computed(() => {
    const items = projection.value?.recent_decisions ?? []
    const { partitionId, runId, decisionId } = routeState.filters.value

    return items.filter(item => {
      if (partitionId && item.partition_id !== partitionId) {
        return false
      }
      if (runId && item.scheduler_run_id !== runId) {
        return false
      }
      if (decisionId && item.id !== decisionId) {
        return false
      }
      return true
    })
  })

  const filteredOwnership = computed(() => {
    const items = projection.value?.ownership.assignments ?? []
    const { partitionId, workerId } = routeState.filters.value

    return items.filter(item => {
      if (partitionId && item.partition_id !== partitionId) {
        return false
      }
      if (workerId && item.worker_id !== workerId) {
        return false
      }
      return true
    })
  })

  const filteredWorkers = computed(() => {
    const items = projection.value?.workers.items ?? []
    const { workerId } = routeState.filters.value
    return workerId ? items.filter(item => item.worker_id === workerId) : items
  })

  const filteredMigrations = computed(() => {
    const items = projection.value?.ownership.recent_migrations ?? []
    const { partitionId, workerId } = routeState.filters.value

    return items.filter(item => {
      if (partitionId && item.partition_id !== partitionId) {
        return false
      }
      if (workerId && item.to_worker_id !== workerId && item.from_worker_id !== workerId) {
        return false
      }
      return true
    })
  })

  const filteredRebalance = computed(() => {
    const items = projection.value?.rebalance.recommendations ?? []
    const { partitionId, workerId } = routeState.filters.value

    return items.filter(item => {
      if (partitionId && item.partition_id !== partitionId) {
        return false
      }
      if (workerId && item.to_worker_id !== workerId && item.from_worker_id !== workerId) {
        return false
      }
      return true
    })
  })

  const resolveDecisionJobId = (decision: SchedulerDecisionItem): string | null => {
    return decision.workflow_link?.job_id ?? decision.created_job_id
  }

  const openRun = (runId: string) => {
    routeState.setFilters({
      ...routeState.filters.value,
      runId
    })
  }

  const openDecision = (decisionId: string) => {
    const decision = projection.value?.recent_decisions.find(item => item.id === decisionId) ?? null
    if (!decision) {
      return
    }

    const resolvedJobId = resolveDecisionJobId(decision)
    if (resolvedJobId) {
      void navigation.goToWorkflowJob(resolvedJobId, {
        sourcePage: 'scheduler',
        sourceRunId: decision.scheduler_run_id,
        sourceDecisionId: decision.id,
        sourceAgentId: decision.actor_id,
        sourcePartitionId: decision.partition_id
      })
      return
    }

    void navigation.goToAgent(decision.actor_id, {
      tab: 'workflows',
      context: {
        sourcePage: 'scheduler',
        sourceRunId: decision.scheduler_run_id,
        sourceDecisionId: decision.id,
        sourceAgentId: decision.actor_id,
        sourcePartitionId: decision.partition_id
      }
    })
  }

  const filterByPartition = (partitionId: string) => {
    routeState.setFilters({
      ...routeState.filters.value,
      partitionId,
      runId: null,
      decisionId: null
    })
  }

  const filterByWorker = (workerId: string) => {
    routeState.setFilters({
      ...routeState.filters.value,
      workerId,
      runId: null,
      decisionId: null
    })
  }

  const clearFilters = () => {
    routeState.setFilters({
      partitionId: null,
      workerId: null,
      runId: null,
      decisionId: null
    })
  }

  const returnToSource = () => {
    if (sourceContext.source.value.sourcePage === 'overview') {
      void navigation.goToOverview()
      return
    }

    if (sourceContext.source.value.sourcePage === 'agent' && sourceContext.source.value.sourceAgentId) {
      void navigation.goToAgent(sourceContext.source.value.sourceAgentId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'workflow') {
      void navigation.goToWorkflow()
      return
    }

    if (sourceContext.source.value.sourcePage === 'social' && sourceContext.source.value.sourcePostId) {
      void navigation.goToSocialPost(sourceContext.source.value.sourcePostId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'timeline' && sourceContext.source.value.sourceEventId) {
      void navigation.goToTimelineEvent(sourceContext.source.value.sourceEventId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'graph' && sourceContext.source.value.sourceRootId) {
      void navigation.goToGraphRoot(sourceContext.source.value.sourceRootId, {
        ...(sourceContext.source.value.sourceNodeId
          ? { selectedNodeId: sourceContext.source.value.sourceNodeId }
          : {})
      })
    }
  }

  return {
    projection,
    selectedRun,
    filteredRuns,
    filteredDecisions,
    filteredOwnership,
    filteredWorkers,
    filteredMigrations,
    filteredRebalance,
    filters: routeState.filters,
    isFetching,
    errorMessage,
    lastSyncedAt,
    refresh: polling.refresh,
    openRun,
    openDecision,
    filterByPartition,
    filterByWorker,
    clearFilters,
    returnToSource,
    sourceSummary: sourceContext.summary
  }
}
