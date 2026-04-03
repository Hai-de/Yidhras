<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
    shape?: 'pill' | 'tag'
    emphasis?: 'subtle' | 'strong'
  }>(),
  {
    tone: 'neutral',
    shape: 'pill',
    emphasis: 'subtle'
  }
)

const toneClass = computed(() => {
  if (props.emphasis === 'strong') {
    switch (props.tone) {
      case 'accent':
        return 'border-yd-state-accent/40 bg-yd-elevated text-yd-text-primary'
      case 'success':
        return 'border-yd-state-success/40 bg-yd-elevated text-yd-state-success'
      case 'warning':
        return 'border-yd-state-warning/40 bg-yd-elevated text-yd-state-warning'
      case 'danger':
        return 'border-yd-state-danger/40 bg-yd-elevated text-yd-state-danger'
      case 'info':
        return 'border-yd-state-info/40 bg-yd-elevated text-yd-state-info'
      default:
        return 'border-yd-border-strong bg-yd-elevated text-yd-text-primary'
    }
  }

  switch (props.tone) {
    case 'accent':
      return 'border-yd-state-accent/25 bg-yd-panel text-yd-text-primary'
    case 'success':
      return 'border-yd-state-success/25 bg-yd-panel text-yd-state-success'
    case 'warning':
      return 'border-yd-state-warning/25 bg-yd-panel text-yd-state-warning'
    case 'danger':
      return 'border-yd-state-danger/25 bg-yd-panel text-yd-state-danger'
    case 'info':
      return 'border-yd-state-info/25 bg-yd-panel text-yd-state-info'
    default:
      return 'border-yd-border-muted bg-yd-panel text-yd-text-secondary'
  }
})

const shapeClass = computed(() => {
  return props.shape === 'tag'
    ? 'rounded-sm px-2 py-0.5 text-[10px] tracking-[0.12em]'
    : 'rounded-sm px-2.5 py-1 text-[10px] tracking-[0.12em]'
})
</script>

<template>
  <span class="inline-flex items-center border uppercase yd-font-mono" :class="[toneClass, shapeClass]">
    <slot />
  </span>
</template>
