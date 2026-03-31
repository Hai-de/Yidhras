<template>
  <div class="flex h-full flex-col gap-4 overflow-hidden p-6">
    <WorkflowFiltersBar
      :status="filters.status"
      :agent-id="filters.agentId"
      :strategy="filters.strategy"
      @apply="handleApplyFilters"
      @reset="handleResetFilters"
    />

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.1fr,0.9fr]">
      <div class="flex min-h-0 flex-col gap-3">
        <div v-if="listErrorMessage" class="rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger">
          {{ listErrorMessage }}
        </div>
        <WorkflowJobsTable
          :items="jobsSnapshot?.items ?? []"
          :selected-job-id="selectedJobId"
          :is-loading="isListFetching"
          @select-job="selectJob"
        />
      </div>

      <WorkflowDetailPanel
        :job="selectedJob"
        :trace="selectedTrace"
        :intent="selectedIntent"
        :workflow="selectedWorkflow"
        :is-loading="isDetailFetching"
        :error-message="detailErrorMessage"
        :is-retrying="isRetrying"
        @retry="retrySelectedJob"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import WorkflowDetailPanel from '../features/workflow/components/WorkflowDetailPanel.vue'
import WorkflowFiltersBar from '../features/workflow/components/WorkflowFiltersBar.vue'
import WorkflowJobsTable from '../features/workflow/components/WorkflowJobsTable.vue'
import { useWorkflowPage } from '../features/workflow/composables/useWorkflowPage'

const workflowPage = useWorkflowPage()

const jobsSnapshot = workflowPage.jobsSnapshot
const selectedJob = workflowPage.selectedJob
const selectedTrace = workflowPage.selectedTrace
const selectedIntent = workflowPage.selectedIntent
const selectedWorkflow = workflowPage.selectedWorkflow
const isListFetching = workflowPage.isListFetching
const isDetailFetching = workflowPage.isDetailFetching
const isRetrying = workflowPage.isRetrying
const listErrorMessage = workflowPage.listErrorMessage
const detailErrorMessage = workflowPage.detailErrorMessage
const filters = workflowPage.filters
const selectedJobId = workflowPage.selectedJobId
const selectJob = workflowPage.selectJob
const retrySelectedJob = workflowPage.retrySelectedJob

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
