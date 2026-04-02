<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
    shape?: 'pill' | 'tag'
  }>(),
  {
    tone: 'neutral',
    shape: 'pill'
  }
)

const toneClass = computed(() => {
  switch (props.tone) {
    case 'accent':
      return 'border-yd-state-accent/30 text-yd-text-primary'
    case 'success':
      return 'border-yd-state-success/40 text-yd-state-success'
    case 'warning':
      return 'border-yd-state-warning/40 text-yd-state-warning'
    case 'danger':
      return 'border-yd-state-danger/40 text-yd-state-danger'
    case 'info':
      return 'border-yd-state-info/40 text-yd-state-info'
    default:
      return 'border-yd-border-muted text-yd-text-muted'
  }
})

const shapeClass = computed(() => {
  return props.shape === 'tag' ? 'rounded-sm px-2 py-1 text-[11px] tracking-[0.14em]' : 'rounded-sm px-2.5 py-1 text-[10px] tracking-[0.16em]'
})
</script>

<template>
  <span class="border uppercase yd-font-mono" :class="[toneClass, shapeClass]">
    <slot />
  </span>
</template>
