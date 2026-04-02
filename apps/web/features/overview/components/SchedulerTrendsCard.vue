<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { OverviewSchedulerTrendViewModel } from '../adapters'

defineProps<{
  items: OverviewSchedulerTrendViewModel[]
}>()
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[20rem] flex-col rounded-xl">
    <WorkspaceSectionHeader
      title="Scheduler Trends"
      subtitle="Recent sampled scheduler runs with created cadence mix and detected signals."
    />

    <div v-if="items.length > 0" class="flex-1 space-y-3 overflow-y-auto px-5 py-5 no-scrollbar">
      <div
        v-for="item in items"
        :key="item.id"
        class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Tick
            </div>
            <div class="mt-2 text-sm font-medium text-yd-text-primary yd-font-mono">
              {{ item.tick }}
            </div>
          </div>
          <div class="text-right">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Created
            </div>
            <div class="mt-2 text-xl font-semibold text-yd-text-primary yd-font-mono">
              {{ item.createdCount }}
            </div>
          </div>
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
              Cadence Mix
            </div>
            <div class="mt-2 text-xs leading-5 text-yd-text-secondary yd-font-mono">
              {{ item.cadenceBreakdown }}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
              Signals Detected
            </div>
            <div class="mt-2 text-xs leading-5 text-yd-text-secondary yd-font-mono">
              {{ item.signalsDetected }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="No scheduler trend samples"
        description="Trend points will appear once recent scheduler runs have been sampled."
      />
    </div>
  </div>
</template>
