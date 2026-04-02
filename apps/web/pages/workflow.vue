<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Workflow Console"
      title="Decision jobs and dispatch state"
      description="Inspect queued and completed jobs, review trace and intent details, and retry failed work without leaving the operator shell."
      :freshness="workflowFreshness"
    >
      <template #actions>
        <AppButton @click="refreshList">
          Refresh List
        </AppButton>
      </template>
    </WorkspacePageHeader>

    <SourceContextBanner
      v-if="workflowSourceSummary"
      :message="workflowSourceSummary"
      return-label="Return to source"
      @return="returnToSource"
    />

    <WorkspaceStatusBanner
      v-if="workflowSchedulerContextMessage"
      tone="info"
      title="Scheduler / Operator Context"
      :message="workflowSchedulerContextMessage"
    />

    <WorkflowFiltersBar
      :status="filters.status"
      :agent-id="filters.agentId"
      :strategy="filters.strategy"
      @apply="handleApplyFilters"
      @reset="handleResetFilters"
    />

    <WorkspaceStatusBanner
      v-if="listErrorMessage"
      title="Workflow list error"
      :message="listErrorMessage"
    />

    <div class="grid min-h-0 flex-1 xl:grid-cols-[1.1fr,0.9fr]" :style="sectionGridStyle">
      <WorkflowJobsTable
        :items="jobsSnapshot?.items ?? []"
        :selected-job-id="selectedJobId"
        :is-loading="isListFetching"
        @select-job="selectJob"
      />

      <WorkflowDetailPanel
        :job="selectedJob"
        :trace="selectedTrace"
        :intent="selectedIntent"
        :workflow="selectedWorkflow"
        :scheduler-source="workflowSchedulerSource"
        :is-loading="isDetailFetching"
        :error-message="detailErrorMessage"
        :is-retrying="isRetrying"
        @retry="retrySelectedJob"
        @open-agent="workflowPage.openAgent"
        @open-workflow-intent="workflowPage.openWorkflowIntent"
        @open-trace="workflowPage.openTrace"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import AppButton from '../components/ui/AppButton.vue'
import SourceContextBanner from '../features/shared/components/SourceContextBanner.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'
import WorkflowDetailPanel from '../features/workflow/components/WorkflowDetailPanel.vue'
import WorkflowFiltersBar from '../features/workflow/components/WorkflowFiltersBar.vue'
import WorkflowJobsTable from '../features/workflow/components/WorkflowJobsTable.vue'
import { useWorkflowPage } from '../features/workflow/composables/useWorkflowPage'

const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const

const sectionGridStyle = {
  gap: 'var(--yd-layout-card-gap)'
} as const

const workflowPage = useWorkflowPage()

const jobsSnapshot = workflowPage.jobsSnapshot
const selectedJob = workflowPage.selectedJob
const selectedTrace = workflowPage.selectedTrace
const selectedIntent = workflowPage.selectedIntent
const selectedWorkflow = workflowPage.selectedWorkflow
const workflowSchedulerSource = workflowPage.schedulerSource
const workflowSchedulerContextMessage = workflowPage.schedulerContextMessage
const isListFetching = workflowPage.isListFetching
const isDetailFetching = workflowPage.isDetailFetching
const isRetrying = workflowPage.isRetrying
const listErrorMessage = workflowPage.listErrorMessage
const detailErrorMessage = workflowPage.detailErrorMessage
const filters = workflowPage.filters
const selectedJobId = workflowPage.selectedJobId
const selectJob = workflowPage.selectJob
const retrySelectedJob = workflowPage.retrySelectedJob
const refreshList = workflowPage.refreshList
const workflowSourceSummary = workflowPage.sourceSummary
const returnToSource = workflowPage.returnToSource

const workflowFreshness = computed(() => {
  return formatFreshnessLabel(workflowPage.lastListSyncedAt.value, {
    isSyncing: isListFetching.value,
    syncingLabel: 'Refreshing workflow list',
    idleLabel: workflowPage.lastDetailSyncedAt.value
      ? `Detail synced ${new Date(workflowPage.lastDetailSyncedAt.value).toLocaleTimeString('zh-CN', { hour12: false })}`
      : 'Awaiting first workflow sync'
  })
})

const handleApplyFilters = (nextFilters: {
  status: string | null
  agentId: string | null
  strategy: string | null
}) => {
  workflowPage.setFilters(nextFilters)
}

const handleResetFilters = () => {
  workflowPage.setFilters({
    status: null,
    agentId: null,
    strategy: null
  })
}
</script>
