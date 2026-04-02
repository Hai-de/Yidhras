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

const toneClass = computed(() => {
  switch (props.tone) {
    case 'warning':
      return 'border-yd-state-warning/40 text-yd-state-warning'
    case 'info':
      return 'border-yd-state-info/40 text-yd-state-info'
    default:
      return 'border-yd-state-danger/40 text-yd-state-danger'
  }
})
</script>

<template>
  <div class="rounded-sm border bg-yd-app px-4 py-3" :class="toneClass">
    <div v-if="props.title" class="text-[10px] uppercase tracking-[0.18em] yd-font-mono">
      {{ props.title }}
    </div>
    <div class="text-sm" :class="props.title ? 'mt-2' : ''">
      <slot />
    </div>
  </div>
</template>
