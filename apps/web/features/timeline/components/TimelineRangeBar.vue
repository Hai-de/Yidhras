<script setup lang="ts">
import { ref, watch } from 'vue'

import AppButton from '../../../components/ui/AppButton.vue'
import AppInput from '../../../components/ui/AppInput.vue'

const props = defineProps<{
  fromTick: string | null
  toTick: string | null
}>()

const emit = defineEmits<{
  apply: [range: { fromTick: string | null; toTick: string | null }]
  reset: []
}>()

const fromTick = ref(props.fromTick ?? '')
const toTick = ref(props.toTick ?? '')

watch(
  () => [props.fromTick, props.toTick],
  ([nextFromTick, nextToTick]) => {
    fromTick.value = nextFromTick ?? ''
    toTick.value = nextToTick ?? ''
  }
)

const handleApply = () => {
  emit('apply', {
    fromTick: fromTick.value.trim() || null,
    toTick: toTick.value.trim() || null
  })
}

const handleReset = () => {
  fromTick.value = ''
  toTick.value = ''
  emit('reset')
}
</script>

<template>
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          From Tick
        </div>
        <AppInput v-model="fromTick" placeholder="1000" />
      </label>

      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          To Tick
        </div>
        <AppInput v-model="toTick" placeholder="2000" />
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
