import { computed, ref, watch } from 'vue'

import {
  useWorkflowApi,
  type WorkflowIntentDetail,
  type WorkflowJobDetail,
  type WorkflowJobsSnapshot,
  type WorkflowSnapshotDetail,
  type WorkflowTraceDetail} from '../../../composables/api/useWorkflowApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
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
    } catch (error) {
      listErrorMessage.value = getErrorMessage(error)
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
    } catch (error) {
      detailErrorMessage.value = getErrorMessage(error)
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
    } catch (error) {
      detailErrorMessage.value = getErrorMessage(error)
    } finally {
      isRetrying.value = false
    }
  }

  return {
    jobsSnapshot,
    selectedJob,
    selectedTrace,
    selectedIntent,
    selectedWorkflow,
    isListFetching,
    isDetailFetching,
    isRetrying,
    listErrorMessage,
    detailErrorMessage,
    filters: workflowRoute.filters,
    selectedJobId: workflowRoute.selectedJobId,
    selectedTraceId: workflowRoute.selectedTraceId,
    selectedTab: workflowRoute.selectedTab,
    refreshList: listPolling.refresh,
    refreshDetails: detailPolling.refresh,
    setFilters: workflowRoute.setFilters,
    selectJob: handleSelectJob,
    retrySelectedJob
  }
}
