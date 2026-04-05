<script setup lang="ts">
import AppButton from '../../../components/ui/AppButton.vue'
import MetricPill from '../../shared/components/MetricPill.vue'
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type {
  OverviewSchedulerHighlightGroup,
  OverviewSchedulerSummaryMetric
} from '../adapters'

defineProps<{
  latestRunLabel: string
  latestRunMeta: string
  metrics: OverviewSchedulerSummaryMetric[]
  highlightGroups: OverviewSchedulerHighlightGroup[]
}>()

const emit = defineEmits<{
  openSchedulerWorkspace: []
}>()
</script>

<template>
  <div class="yd-workbench-pane flex h-full min-h-[20rem] flex-col rounded-md">
    <WorkspaceSectionHeader
      title="Scheduler Summary"
      subtitle="Recent scheduler projection totals, highlights, ownership cues, and latest run context for operator triage."
    >
      <template #actions>
        <AppButton size="sm" variant="secondary" kind="toolbar" @click="emit('openSchedulerWorkspace')">
          Open Scheduler Workspace
        </AppButton>
      </template>
    </WorkspaceSectionHeader>

    <div v-if="metrics.length > 0" class="flex-1 space-y-4 px-4 py-4">
      <div class="yd-workbench-inset rounded-md px-4 py-4">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Latest Run
        </div>
        <div class="mt-2 text-sm font-medium text-yd-text-primary yd-font-mono">
          {{ latestRunLabel }}
        </div>
        <div class="mt-2 text-xs leading-5 text-yd-text-secondary">
          {{ latestRunMeta }}
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MetricPill v-for="item in metrics" :key="item.id" :label="item.label" :value="item.value" />
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="group in highlightGroups"
          :key="group.title"
          class="yd-workbench-inset rounded-md px-4 py-4"
        >
          <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
            {{ group.title }}
          </div>
          <div v-if="group.items.length > 0" class="mt-3 space-y-2 text-sm text-yd-text-secondary">
            <div v-for="item in group.items" :key="item" class="yd-font-mono text-xs leading-5 text-yd-text-primary">
              {{ item }}
            </div>
          </div>
          <div v-else class="mt-3 text-sm text-yd-text-secondary">
            No aggregate highlights available yet.
          </div>
        </div>
      </div>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="Scheduler summary not available"
        description="The summary projection will populate after recent scheduler runs are available."
      />
    </div>
  </div>
</template>
