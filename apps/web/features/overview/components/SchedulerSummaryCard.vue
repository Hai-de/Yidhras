<script setup lang="ts">
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
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[20rem] flex-col rounded-xl">
    <WorkspaceSectionHeader
      title="Scheduler Summary"
      subtitle="Recent scheduler projection totals, top reasons, and latest run context for operator triage."
    />

    <div v-if="metrics.length > 0" class="flex-1 space-y-5 px-5 py-5">
      <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
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

      <div class="grid gap-3 md:grid-cols-2">
        <MetricPill v-for="item in metrics" :key="item.id" :label="item.label" :value="item.value" />
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div
          v-for="group in highlightGroups"
          :key="group.title"
          class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4"
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

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="Scheduler summary not available"
        description="The summary projection will populate after recent scheduler runs are available."
      />
    </div>
  </div>
</template>
