<script setup lang="ts">
import type { SchedulerHighlightCardViewModel } from '../adapters'

defineProps<{
  items: SchedulerHighlightCardViewModel[]
}>()

const toneClass = (tone: SchedulerHighlightCardViewModel['tone']) => {
  switch (tone) {
    case 'success':
      return 'yd-tone-success'
    case 'warning':
      return 'yd-tone-warning'
    case 'danger':
      return 'yd-tone-danger'
    case 'info':
      return 'yd-tone-info'
    default:
      return ''
  }
}
</script>

<template>
  <div class="grid gap-3 xl:grid-cols-6">
    <div
      v-for="item in items"
      :key="item.id"
      class="yd-workbench-pane rounded-md px-4 py-4"
      :class="toneClass(item.tone)"
    >
      <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
        {{ item.label }}
      </div>
      <div class="mt-3 break-all text-sm font-semibold text-yd-text-primary yd-font-mono">
        {{ item.value }}
      </div>
    </div>
  </div>
</template>
