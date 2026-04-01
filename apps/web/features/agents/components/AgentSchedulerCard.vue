<script setup lang="ts">
import type { AgentSchedulerDecisionViewModel } from '../adapters'

const props = defineProps<{
  items: AgentSchedulerDecisionViewModel[]
}>()

const emit = defineEmits<{
  openDecision: [decisionId: string]
}>()
</script>

<template>
  <div class="yd-panel-surface rounded-xl px-5 py-5">
    <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
      Scheduler Timeline
    </div>
    <div class="mt-2 text-sm text-yd-text-secondary">
      Recent scheduler decisions for this agent, including chosen reason, cadence kind, and skipped outcome context.
    </div>

    <div v-if="props.items.length > 0" class="mt-4 grid gap-3 text-sm text-yd-text-secondary">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3 text-left transition-colors hover:border-yd-state-accent"
        @click="emit('openDecision', item.id)"
      >
        <div class="text-yd-text-primary break-all">
          {{ item.title }}
        </div>
        <div class="mt-2 text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ item.meta }}
        </div>
      </button>
    </div>

    <div v-else class="mt-4 rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4 text-sm text-yd-text-secondary">
      No scheduler decisions available for this agent yet.
    </div>
  </div>
</template>
