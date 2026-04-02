import { computed, ref } from 'vue'

import type { OverviewSummarySnapshot } from '../../../composables/api/useOverviewApi'
import { useOverviewApi } from '../../../composables/api/useOverviewApi'
import type {
  SchedulerSummarySnapshot,
  SchedulerTrendsSnapshot
} from '../../../composables/api/useSchedulerApi'
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
  const schedulerRuns = ref<Awaited<ReturnType<typeof schedulerApi.listRuns>> | null>(null)
  const schedulerDecisions = ref<Awaited<ReturnType<typeof schedulerApi.listDecisions>> | null>(null)
  const schedulerSummary = ref<SchedulerSummarySnapshot | null>(null)
  const schedulerTrends = ref<SchedulerTrendsSnapshot | null>(null)
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)

  const fetchSummary = async () => {
    isFetching.value = true

    try {
      const [overviewSnapshot, runsSnapshot, decisionsSnapshot, summarySnapshot, trendsSnapshot] = await Promise.all([
        overviewApi.getSummary(),
        schedulerApi.listRuns({ limit: 5 }),
        schedulerApi.listDecisions({ limit: 5 }),
        schedulerApi.getSummary({ sampleRuns: 10 }),
        schedulerApi.getTrends({ sampleRuns: 10 })
      ])
      summary.value = overviewSnapshot
      schedulerRuns.value = runsSnapshot
      schedulerDecisions.value = decisionsSnapshot
      schedulerSummary.value = summarySnapshot
      schedulerTrends.value = trendsSnapshot
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

  const openSchedulerRun = (runId: string) => {
    void navigation.goToWorkflowWithSchedulerRun(runId, {
      sourcePage: 'overview',
      sourceRunId: runId
    })
  }

  const openSchedulerDecision = (input: { decisionId: string; createdJobId: string | null; actorId: string }) => {
    if (input.createdJobId) {
      void navigation.goToWorkflowJob(input.createdJobId, {
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
    schedulerRuns,
    schedulerDecisions,
    schedulerSummary,
    schedulerTrends,
    schedulerRunItems: computed(() => schedulerRuns.value?.items ?? []),
    schedulerDecisionItems: computed(() => schedulerDecisions.value?.items ?? []),
    schedulerTrendItems: computed(() => schedulerTrends.value?.points ?? []),
    isFetching,
    errorMessage,
    lastSyncedAt,
    refresh: polling.refresh,
    openSchedulerRun,
    openSchedulerDecision
  }
}
