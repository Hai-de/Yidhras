import { computed, ref, watch } from 'vue'

import type {
  WorkflowIntentDetail,
  WorkflowJobDetail,
  WorkflowJobsSnapshot,
  WorkflowSnapshotDetail,
  WorkflowTraceDetail
} from '../../../composables/api/useWorkflowApi'
import { useWorkflowApi } from '../../../composables/api/useWorkflowApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useNotificationsStore } from '../../../stores/notifications'
import { useOperatorNavigation } from '../../shared/navigation'
import { useOperatorSourceContext } from '../../shared/source-context'
import { buildWorkflowSchedulerSourceViewModel } from '../adapters'
import { useWorkflowRouteState } from '../route'
import { useWorkflowStore } from '../store'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown workflow error'
}

const resolveTraceId = (explicitTraceId: string | null, job: WorkflowJobDetail | null): string | null => {
  if (explicitTraceId) {
    return explicitTraceId
  }

  if (!job?.source_inference_id || job.source_inference_id.startsWith('pending_')) {
    return null
  }

  return job.source_inference_id
}

export const useWorkflowPage = () => {
  const workflowApi = useWorkflowApi()
  const workflowRoute = useWorkflowRouteState()
  const workflowStore = useWorkflowStore()
  const navigation = useOperatorNavigation()
  const sourceContext = useOperatorSourceContext()
  const notifications = useNotificationsStore()

  const jobsSnapshot = ref<WorkflowJobsSnapshot | null>(null)
  const selectedJob = ref<WorkflowJobDetail | null>(null)
  const selectedTrace = ref<WorkflowTraceDetail | null>(null)
  const selectedIntent = ref<WorkflowIntentDetail | null>(null)
  const selectedWorkflow = ref<WorkflowSnapshotDetail | null>(null)
  const isListFetching = ref(false)
  const isDetailFetching = ref(false)
  const isRetrying = ref(false)
  const listErrorMessage = ref<string | null>(null)
  const detailErrorMessage = ref<string | null>(null)
  const lastListSyncedAt = ref<number | null>(null)
  const lastDetailSyncedAt = ref<number | null>(null)

  const fetchJobsList = async () => {
    const filters = workflowRoute.filters.value

    workflowStore.setListFetching(true)
    workflowStore.setListFilters({
      status: filters.status,
      agentId: filters.agentId,
      strategy: filters.strategy,
      actionIntentId: filters.actionIntentId
    })
    isListFetching.value = true

    try {
      jobsSnapshot.value = await workflowApi.listJobs({
        status: filters.status,
        agentId: filters.agentId,
        strategy: filters.strategy,
        actionIntentId: filters.actionIntentId,
        limit: 20
      })
      workflowStore.markListSynced()
      listErrorMessage.value = null
      lastListSyncedAt.value = Date.now()
    } catch (error) {
      const message = getErrorMessage(error)
      listErrorMessage.value = message
      notifications.pushLocalItem({
        level: 'error',
        content: `Workflow list refresh failed: ${message}`,
        code: 'workflow_list_refresh_failed'
      })
    } finally {
      workflowStore.setListFetching(false)
      isListFetching.value = false
    }
  }

  const clearDetailState = () => {
    selectedJob.value = null
    selectedTrace.value = null
    selectedIntent.value = null
    selectedWorkflow.value = null
  }

  const fetchSelectionDetails = async () => {
    workflowRoute.applyRouteToStore()

    const jobId = workflowRoute.selectedJobId.value
    const explicitTraceId = workflowRoute.selectedTraceId.value

    if (!jobId && !explicitTraceId) {
      clearDetailState()
      detailErrorMessage.value = null
      return
    }

    isDetailFetching.value = true

    try {
      let nextJob: WorkflowJobDetail | null = null
      let nextWorkflow: WorkflowSnapshotDetail | null = null

      if (jobId) {
        ;[nextJob, nextWorkflow] = await Promise.all([
          workflowApi.getJob(jobId),
          workflowApi.getJobWorkflow(jobId)
        ])
      }

      const traceId = resolveTraceId(explicitTraceId, nextJob)
      let nextTrace: WorkflowTraceDetail | null = null
      let nextIntent: WorkflowIntentDetail | null = null

      if (traceId) {
        ;[nextTrace, nextIntent] = await Promise.all([
          workflowApi.getTrace(traceId),
          workflowApi.getIntent(traceId)
        ])

        if (!nextWorkflow) {
          nextWorkflow = await workflowApi.getTraceWorkflow(traceId)
        }
      }

      selectedJob.value = nextJob
      selectedTrace.value = nextTrace
      selectedIntent.value = nextIntent
      selectedWorkflow.value = nextWorkflow
      detailErrorMessage.value = null
      lastDetailSyncedAt.value = Date.now()
    } catch (error) {
      const message = getErrorMessage(error)
      detailErrorMessage.value = message
      notifications.pushLocalItem({
        level: 'error',
        content: `Workflow detail refresh failed: ${message}`,
        code: 'workflow_detail_refresh_failed'
      })
    } finally {
      isDetailFetching.value = false
    }
  }

  const listPolling = useVisibilityPolling(fetchJobsList, {
    visibleIntervalMs: 5000,
    hiddenIntervalMs: 15000,
    immediate: false,
    refreshOnVisible: true
  })

  const detailPolling = useVisibilityPolling(fetchSelectionDetails, {
    visibleIntervalMs: 3000,
    hiddenIntervalMs: 7000,
    enabled: computed(
      () => workflowStore.detailPollingEnabled && Boolean(workflowRoute.selectedJobId.value || workflowRoute.selectedTraceId.value)
    ),
    immediate: false,
    refreshOnVisible: true
  })

  watch(
    () => workflowRoute.filters.value,
    filters => {
      workflowStore.setListFilters({
        status: filters.status,
        agentId: filters.agentId,
        strategy: filters.strategy,
        actionIntentId: filters.actionIntentId
      })
      void fetchJobsList()
    },
    { deep: true, immediate: true }
  )

  watch(
    [workflowRoute.selectedJobId, workflowRoute.selectedTraceId, workflowRoute.selectedTab],
    ([jobId, traceId, selectedTab]) => {
      workflowStore.setSelectedJobId(jobId)
      workflowStore.setSelectedTraceId(traceId)
      workflowStore.setSelectedIntentId(selectedTab === 'intent' ? traceId : null)
      workflowStore.setActiveTab(selectedTab as 'job' | 'trace' | 'intent' | 'workflow')
      void fetchSelectionDetails()
    },
    { immediate: true }
  )

  const handleSelectJob = (job: WorkflowJobsSnapshot['items'][number]) => {
    workflowRoute.setSelectedJobId(job.id)
    workflowRoute.setSelectedTraceId(job.source_inference_id && !job.source_inference_id.startsWith('pending_') ? job.source_inference_id : null)
    workflowRoute.setSelectedTab('job')
  }

  const retrySelectedJob = async () => {
    if (!selectedJob.value || selectedJob.value.status !== 'failed') {
      return
    }

    isRetrying.value = true

    try {
      await workflowApi.retryJob(selectedJob.value.id)
      await Promise.all([fetchJobsList(), fetchSelectionDetails()])
      detailErrorMessage.value = null
      notifications.pushLocalItem({
        level: 'info',
        content: `Retry requested for workflow job ${selectedJob.value.id}`,
        code: 'workflow_retry_requested'
      })
    } catch (error) {
      const message = getErrorMessage(error)
      detailErrorMessage.value = message
      notifications.pushLocalItem({
        level: 'error',
        content: `Workflow retry failed: ${message}`,
        code: 'workflow_retry_failed'
      })
    } finally {
      isRetrying.value = false
    }
  }

  const openAgent = (agentId: string) => {
    void navigation.goToAgent(agentId, {
      tab: 'workflows',
      context: {
        sourcePage: 'timeline',
        ...(selectedJob.value?.action_intent_id ? { sourceEventId: selectedJob.value.action_intent_id } : {})
      }
    })
  }

  const openWorkflowIntent = (actionIntentId: string) => {
    workflowRoute.setFilters({ actionIntentId })
    workflowRoute.setSelectedTab('intent')
  }

  const openTrace = (traceId: string) => {
    workflowRoute.setSelectedTraceId(traceId)
    workflowRoute.setSelectedTab('trace')
  }

  const schedulerSource = computed(() => {
    return buildWorkflowSchedulerSourceViewModel({
      sourcePage: sourceContext.source.value.sourcePage,
      sourceSummary: sourceContext.summary.value,
      sourceRunId: sourceContext.source.value.sourceRunId,
      sourceDecisionId: sourceContext.source.value.sourceDecisionId,
      sourceAgentId: sourceContext.source.value.sourceAgentId,
      selectedJob: selectedJob.value
    })
  })

  const schedulerContextMessage = computed(() => {
    if (!schedulerSource.value) {
      return null
    }

    const segments = [schedulerSource.value.sourceLabel]

    if (schedulerSource.value.schedulerReason) {
      segments.push(`reason ${schedulerSource.value.schedulerReason}`)
    }

    if (schedulerSource.value.schedulerKind) {
      segments.push(`kind ${schedulerSource.value.schedulerKind}`)
    }

    if (schedulerSource.value.schedulerRunId) {
      segments.push(`run ${schedulerSource.value.schedulerRunId}`)
    }

    if (schedulerSource.value.schedulerDecisionId) {
      segments.push(`decision ${schedulerSource.value.schedulerDecisionId}`)
    }

    return segments.join(' · ')
  })

  const returnToSource = () => {
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
      return
    }

    if (sourceContext.source.value.sourcePage === 'agent' && sourceContext.source.value.sourceAgentId) {
      void navigation.goToAgent(sourceContext.source.value.sourceAgentId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'overview') {
      void navigation.goToOverview()
    }
  }

  return {
    jobsSnapshot,
    selectedJob,
    selectedTrace,
    selectedIntent,
    selectedWorkflow,
    schedulerSource,
    schedulerContextMessage,
    isListFetching,
    isDetailFetching,
    isRetrying,
    listErrorMessage,
    detailErrorMessage,
    lastListSyncedAt,
    lastDetailSyncedAt,
    filters: workflowRoute.filters,
    selectedJobId: workflowRoute.selectedJobId,
    selectedTraceId: workflowRoute.selectedTraceId,
    selectedTab: workflowRoute.selectedTab,
    refreshList: listPolling.refresh,
    refreshDetails: detailPolling.refresh,
    setFilters: workflowRoute.setFilters,
    selectJob: handleSelectJob,
    retrySelectedJob,
    openAgent,
    openWorkflowIntent,
    openTrace,
    sourceSummary: sourceContext.summary,
    hasSource: sourceContext.hasSource,
    returnToSource
  }
}
