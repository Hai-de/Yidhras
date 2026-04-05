<script setup lang="ts">
import AppButton from '../../../components/ui/AppButton.vue'
import type { AgentSchedulerBreakdownItem, AgentSchedulerDecisionViewModel, AgentSchedulerLinkItem } from '../adapters'

const props = defineProps<{
  items: AgentSchedulerDecisionViewModel[]
  breakdownItems?: AgentSchedulerBreakdownItem[]
  reasonItems?: string[]
  skippedReasonItems?: string[]
  runLinks?: AgentSchedulerLinkItem[]
  jobLinks?: AgentSchedulerLinkItem[]
}>()

const emit = defineEmits<{
  openDecision: [decisionId: string]
  openRun: [runId: string]
  openJob: [jobId: string]
}>()
</script>

<template>
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
      Scheduler Timeline
    </div>
    <div class="mt-2 text-sm text-yd-text-secondary">
      Recent scheduler decisions for this agent, including chosen reason, cadence kind, priority, partition context, and workflow linkage.
    </div>

    <div v-if="(props.breakdownItems?.length ?? 0) > 0" class="mt-4 grid gap-3 md:grid-cols-2">
      <div
        v-for="item in props.breakdownItems"
        :key="item.id"
        class="yd-detail-grid-item rounded-sm px-4 py-3"
      >
        <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
          {{ item.label }}
        </div>
        <div class="mt-2 break-all text-yd-text-primary">
          {{ item.value }}
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-3 xl:grid-cols-2">
      <div class="yd-workbench-inset rounded-md px-4 py-4">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Reason Breakdown
        </div>
        <div v-if="(props.reasonItems?.length ?? 0) > 0" class="mt-3 space-y-2 text-xs text-yd-text-primary yd-font-mono">
          <div v-for="item in props.reasonItems" :key="item">
            {{ item }}
          </div>
        </div>
        <div v-else class="mt-3 text-sm text-yd-text-secondary">
          No recent reason breakdown available.
        </div>
      </div>

      <div class="yd-workbench-inset rounded-md px-4 py-4">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Skipped Breakdown
        </div>
        <div
          v-if="(props.skippedReasonItems?.length ?? 0) > 0"
          class="mt-3 space-y-2 text-xs text-yd-text-primary yd-font-mono"
        >
          <div v-for="item in props.skippedReasonItems" :key="item">
            {{ item }}
          </div>
        </div>
        <div v-else class="mt-3 text-sm text-yd-text-secondary">
          No skipped decisions in the sampled window.
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-3 xl:grid-cols-2">
      <div class="yd-workbench-inset rounded-md px-4 py-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
            Recent Runs
          </div>
        </div>
        <div v-if="(props.runLinks?.length ?? 0) > 0" class="mt-3 space-y-2">
          <button
            v-for="item in props.runLinks"
            :key="item.id"
            type="button"
            class="yd-list-row w-full rounded-sm px-3 py-2 text-left"
            @click="emit('openRun', item.id)"
          >
            <div class="text-sm text-yd-text-primary">
              {{ item.title }}
            </div>
            <div class="mt-1 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              {{ item.meta }}
            </div>
          </button>
        </div>
        <div v-else class="mt-3 text-sm text-yd-text-secondary">
          No related scheduler runs linked yet.
        </div>
      </div>

      <div class="yd-workbench-inset rounded-md px-4 py-4">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Recent Created Jobs
        </div>
        <div v-if="(props.jobLinks?.length ?? 0) > 0" class="mt-3 space-y-2">
          <button
            v-for="item in props.jobLinks"
            :key="item.id"
            type="button"
            class="yd-list-row w-full rounded-sm px-3 py-2 text-left"
            @click="emit('openJob', item.id)"
          >
            <div class="text-sm text-yd-text-primary">
              {{ item.title }}
            </div>
            <div class="mt-1 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              {{ item.meta }}
            </div>
          </button>
        </div>
        <div v-else class="mt-3 text-sm text-yd-text-secondary">
          No materialized workflow jobs linked from recent decisions.
        </div>
      </div>
    </div>

    <div v-if="props.items.length > 0" class="mt-4 grid gap-2.5 text-sm text-yd-text-secondary">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="yd-workbench-item yd-tone-info rounded-md px-4 py-3 text-left transition-colors"
        @click="emit('openDecision', item.id)"
      >
        <div class="break-all text-yd-text-primary">
          {{ item.title }}
        </div>
        <div class="mt-2 text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ item.meta }}
        </div>
        <div class="mt-3 text-xs leading-5 text-yd-text-secondary">
          {{ item.detail }}
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div class="text-[10px] uppercase tracking-[0.18em] text-yd-state-accent yd-font-mono">
            {{ item.outcomeLabel }}
          </div>
          <AppButton size="sm" variant="secondary" kind="toolbar">
            Open
          </AppButton>
        </div>
      </button>
    </div>

    <div v-else class="mt-4 yd-workbench-inset rounded-md px-4 py-4 text-sm text-yd-text-secondary">
      No scheduler decisions available for this agent yet.
    </div>
  </div>
</template>
