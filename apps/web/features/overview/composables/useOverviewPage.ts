import { computed, ref } from 'vue'

import type { OverviewSummarySnapshot } from '../../../composables/api/useOverviewApi'
import { useOverviewApi } from '../../../composables/api/useOverviewApi'
import type { SchedulerOperatorProjection } from '../../../composables/api/useSchedulerApi'
import { useSchedulerApi } from '../../../composables/api/useSchedulerApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useNotificationsStore } from '../../../stores/notifications'
import { useOperatorNavigation } from '../../shared/navigation'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown overview error'
}

export const useOverviewPage = () => {
  const overviewApi = useOverviewApi()
  const schedulerApi = useSchedulerApi()
  const navigation = useOperatorNavigation()
  const notifications = useNotificationsStore()
  const summary = ref<OverviewSummarySnapshot | null>(null)
  const schedulerProjection = ref<SchedulerOperatorProjection | null>(null)
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)

  const fetchSummary = async () => {
    isFetching.value = true

    try {
      const [overviewSnapshot, schedulerSnapshot] = await Promise.all([
        overviewApi.getSummary(),
        schedulerApi.getOperatorProjection({ sampleRuns: 10, recentLimit: 5 })
      ])
      summary.value = overviewSnapshot
      schedulerProjection.value = schedulerSnapshot
      errorMessage.value = null
      lastSyncedAt.value = Date.now()
    } catch (error) {
      const message = getErrorMessage(error)
      errorMessage.value = message
      notifications.pushLocalItem({
        level: 'error',
        content: `Overview refresh failed: ${message}`,
        code: 'overview_refresh_failed'
      })
    } finally {
      isFetching.value = false
    }
  }

  const polling = useVisibilityPolling(fetchSummary, {
    visibleIntervalMs: 10000,
    hiddenIntervalMs: 20000,
    immediate: true,
    refreshOnVisible: true
  })

  const openSchedulerWorkspace = () => {
    void navigation.goToScheduler({
      context: {
        sourcePage: 'overview'
      }
    })
  }

  const openSchedulerRun = (runId: string) => {
    void navigation.goToScheduler({
      runId,
      context: {
        sourcePage: 'overview',
        sourceRunId: runId
      }
    })
  }

  const openSchedulerDecision = (input: { decisionId: string; createdJobId: string | null; actorId: string }) => {
    const decision = schedulerProjection.value?.recent_decisions.find(item => item.id === input.decisionId) ?? null
    const resolvedJobId = decision?.workflow_link?.job_id ?? input.createdJobId
    if (resolvedJobId) {
      void navigation.goToWorkflowJob(resolvedJobId, {
        sourcePage: 'overview',
        sourceDecisionId: input.decisionId,
        sourceAgentId: input.actorId
      })
      return
    }

    void navigation.goToAgent(input.actorId, {
      tab: 'workflows',
      context: {
        sourcePage: 'overview',
        sourceDecisionId: input.decisionId,
        sourceAgentId: input.actorId
      }
    })
  }

  return {
    summary,
    schedulerProjection,
    schedulerSummary: computed(() => schedulerProjection.value?.summary ?? null),
    schedulerTrends: computed(() => schedulerProjection.value?.trends ?? null),
    schedulerRunItems: computed(() => schedulerProjection.value?.recent_runs ?? []),
    schedulerDecisionItems: computed(() => schedulerProjection.value?.recent_decisions ?? []),
    schedulerTrendItems: computed(() => schedulerProjection.value?.trends.points ?? []),
    isFetching,
    errorMessage,
    lastSyncedAt,
    refresh: polling.refresh,
    openSchedulerWorkspace,
    openSchedulerRun,
    openSchedulerDecision
  }
}
