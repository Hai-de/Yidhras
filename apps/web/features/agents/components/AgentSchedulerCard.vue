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
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
      Scheduler Timeline
    </div>
    <div class="mt-2 text-sm text-yd-text-secondary">
      Recent scheduler decisions for this agent, including chosen reason, cadence kind, priority, and workflow linkage.
    </div>

    <div v-if="props.items.length > 0" class="mt-4 grid gap-2.5 text-sm text-yd-text-secondary">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="yd-workbench-item rounded-md px-4 py-3 text-left transition-colors hover:border-yd-state-accent"
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
        <div class="mt-3 text-[10px] uppercase tracking-[0.18em] text-yd-state-accent yd-font-mono">
          {{ item.outcomeLabel }}
        </div>
      </button>
    </div>

    <div v-else class="mt-4 yd-workbench-inset rounded-md px-4 py-4 text-sm text-yd-text-secondary">
      No scheduler decisions available for this agent yet.
    </div>
  </div>
</template>
