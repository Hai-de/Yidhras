<script setup lang="ts">
import type { WorkflowTone } from '../adapters'

const props = withDefaults(
  defineProps<{
    label: string
    tone?: WorkflowTone
  }>(),
  {
    tone: 'neutral'
  }
)

const toneClass = (tone: WorkflowTone) => {
  switch (tone) {
    case 'success':
      return 'border-yd-state-success/50 text-yd-state-success'
    case 'warning':
      return 'border-yd-state-warning/50 text-yd-state-warning'
    case 'danger':
      return 'border-yd-state-danger/50 text-yd-state-danger'
    case 'info':
      return 'border-yd-state-info/50 text-yd-state-info'
    default:
      return 'border-yd-border-muted text-yd-text-secondary'
  }
}
</script>

<template>
  <span
    class="inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] yd-font-mono"
    :class="toneClass(props.tone)"
  >
    {{ props.label }}
  </span>
</template>
