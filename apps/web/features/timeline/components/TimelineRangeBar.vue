<script setup lang="ts">
import { ref, watch } from 'vue'

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
  <div class="yd-panel-surface rounded-xl px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          From Tick
        </div>
        <input
          v-model="fromTick"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="1000"
        >
      </label>

      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          To Tick
        </div>
        <input
          v-model="toTick"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="2000"
        >
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
