<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  status: string | null
  agentId: string | null
  strategy: string | null
}>()

const emit = defineEmits<{
  apply: [filters: { status: string | null; agentId: string | null; strategy: string | null }]
  reset: []
}>()

const status = ref(props.status ?? '')
const agentId = ref(props.agentId ?? '')
const strategy = ref(props.strategy ?? '')

watch(
  () => [props.status, props.agentId, props.strategy],
  ([nextStatus, nextAgentId, nextStrategy]) => {
    status.value = nextStatus ?? ''
    agentId.value = nextAgentId ?? ''
    strategy.value = nextStrategy ?? ''
  }
)

const handleApply = () => {
  emit('apply', {
    status: status.value.trim() || null,
    agentId: agentId.value.trim() || null,
    strategy: strategy.value.trim() || null
  })
}

const handleReset = () => {
  status.value = ''
  agentId.value = ''
  strategy.value = ''
  emit('reset')
}
</script>

<template>
  <div class="yd-panel-surface rounded-xl px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-[10rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Status
        </div>
        <select
          v-model="status"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
        >
          <option value="">All</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
        </select>
      </label>

      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Agent ID
        </div>
        <input
          v-model="agentId"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="agent_..."
        >
      </label>

      <label class="min-w-[10rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Strategy
        </div>
        <select
          v-model="strategy"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
        >
          <option value="">All</option>
          <option value="mock">mock</option>
          <option value="rule_based">rule_based</option>
        </select>
      </label>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-yd-state-accent/50 bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="handleApply"
        >
          Apply
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-muted px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
          @click="handleReset"
        >
          Reset
        </button>
      </div>
    </div>
  </div>
</template>
