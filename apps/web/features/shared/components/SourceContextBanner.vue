<script setup lang="ts">
defineProps<{
  message: string
  returnLabel: string
}>()

const emit = defineEmits<{
  return: []
}>()
</script>

<template>
  <div class="rounded-md border border-yd-state-info/40 bg-yd-panel px-4 py-3 text-yd-state-info">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-[10px] uppercase tracking-[0.18em] yd-font-mono">
          Source Context
        </div>
        <div class="mt-2 text-sm">
          {{ message }}
        </div>
      </div>

      <button
        type="button"
        class="rounded-sm border border-yd-state-info/40 bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono transition-colors hover:border-yd-state-info"
        @click="emit('return')"
      >
        {{ returnLabel }}
      </button>
    </div>
  </div>
</template>
