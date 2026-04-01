<script setup lang="ts">
const props = defineProps<{
  tone?: 'danger' | 'warning' | 'info'
  title?: string
  message: string
}>()

const toneClass = (() => {
  switch (props.tone ?? 'danger') {
    case 'warning':
      return 'border-yd-state-warning/40 text-yd-state-warning'
    case 'info':
      return 'border-yd-state-info/40 text-yd-state-info'
    default:
      return 'border-yd-state-danger/40 text-yd-state-danger'
  }
})()
</script>

<template>
  <div class="rounded-lg border bg-yd-app px-4 py-3" :class="toneClass">
    <div v-if="title" class="text-[10px] uppercase tracking-[0.18em] yd-font-mono">
      {{ title }}
    </div>
    <div class="text-sm" :class="title ? 'mt-2' : ''">
      {{ message }}
    </div>
  </div>
</template>
