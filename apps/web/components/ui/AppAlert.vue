<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'danger' | 'warning' | 'info'
    title?: string
  }>(),
  {
    tone: 'danger',
    title: undefined
  }
)

const borderToneClass = computed(() => {
  switch (props.tone) {
    case 'warning':
      return 'border-l-yd-state-warning'
    case 'info':
      return 'border-l-yd-state-info'
    default:
      return 'border-l-yd-state-danger'
  }
})

const titleToneClass = computed(() => {
  switch (props.tone) {
    case 'warning':
      return 'text-yd-state-warning'
    case 'info':
      return 'text-yd-state-info'
    default:
      return 'text-yd-state-danger'
  }
})
</script>

<template>
  <div class="rounded-sm border border-yd-border-muted border-l-2 bg-yd-panel px-4 py-3" :class="borderToneClass">
    <div v-if="props.title" class="text-[10px] uppercase tracking-[0.12em] yd-font-mono" :class="titleToneClass">
      {{ props.title }}
    </div>
    <div class="text-sm leading-6 text-yd-text-secondary" :class="props.title ? 'mt-2' : ''">
      <slot />
    </div>
  </div>
</template>
