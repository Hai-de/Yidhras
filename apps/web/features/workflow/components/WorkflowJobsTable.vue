<script setup lang="ts">
import type { WorkflowJobListItem } from '../../../composables/api/useWorkflowApi'
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import { resolveJobStatusTone, resolveWorkflowStateTone } from '../adapters'

const props = defineProps<{
  items: WorkflowJobListItem[]
  selectedJobId: string | null
  isLoading: boolean
}>()

const emit = defineEmits<{
  selectJob: [job: WorkflowJobListItem]
}>()
</script>

<template>
  <div class="yd-workbench-pane flex h-full min-h-[28rem] flex-col rounded-md">
    <WorkspaceSectionHeader
      title="Decision Jobs"
      :subtitle="props.isLoading ? 'Refreshing workflow jobs…' : `${props.items.length} job(s) in current page.`"
    />

    <div v-if="props.items.length > 0" class="min-h-0 flex-1 overflow-auto no-scrollbar">
      <table class="min-w-full border-collapse text-left text-sm">
        <thead class="bg-yd-panel sticky top-0">
          <tr class="border-b border-yd-border-muted text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
            <th class="px-4 py-3">Job</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Workflow</th>
            <th class="px-4 py-3">Strategy</th>
            <th class="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in props.items"
            :key="item.id"
            class="cursor-pointer border-b border-yd-border-muted transition-colors hover:bg-yd-elevated/55"
            :class="item.id === props.selectedJobId ? 'bg-yd-elevated/70' : ''"
            @click="emit('selectJob', item)"
          >
            <td class="px-4 py-3 align-top">
              <div class="text-sm font-medium text-yd-text-primary yd-font-mono">{{ item.id }}</div>
              <div class="mt-1 text-xs text-yd-text-secondary">{{ item.job_type }}</div>
            </td>
            <td class="px-4 py-3 align-top">
              <WorkflowStatusBadge :label="item.status" :tone="resolveJobStatusTone(item.status)" />
            </td>
            <td class="px-4 py-3 align-top">
              <WorkflowStatusBadge
                :label="item.workflow.workflow_state"
                :tone="resolveWorkflowStateTone(item.workflow.workflow_state)"
              />
            </td>
            <td class="px-4 py-3 align-top text-xs text-yd-text-secondary">
              {{ item.strategy ?? '—' }}
            </td>
            <td class="px-4 py-3 align-top text-xs text-yd-text-secondary yd-font-mono">
              {{ item.updated_at }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="No workflow jobs in current view"
        description="Adjust status, agent, or strategy filters to inspect another slice of the workflow queue."
      />
    </div>
  </div>
</template>
