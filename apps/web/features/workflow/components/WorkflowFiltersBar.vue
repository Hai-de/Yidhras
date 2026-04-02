<script setup lang="ts">
import { ref, watch } from 'vue'

import AppButton from '../../../components/ui/AppButton.vue'
import AppInput from '../../../components/ui/AppInput.vue'
import AppSelect from '../../../components/ui/AppSelect.vue'

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
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-[10rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Status
        </div>
        <AppSelect v-model="status">
          <option value="">All</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
        </AppSelect>
      </label>

      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Agent ID
        </div>
        <AppInput v-model="agentId" placeholder="agent_..." />
      </label>

      <label class="min-w-[10rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Strategy
        </div>
        <AppSelect v-model="strategy">
          <option value="">All</option>
          <option value="mock">mock</option>
          <option value="rule_based">rule_based</option>
        </AppSelect>
      </label>

      <div class="flex items-center gap-2">
        <AppButton @click="handleApply">
          Apply
        </AppButton>
        <AppButton variant="secondary" @click="handleReset">
          Reset
        </AppButton>
      </div>
    </div>
  </div>
</template>
