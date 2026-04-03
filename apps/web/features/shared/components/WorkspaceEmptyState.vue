<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="yd-workbench-inset rounded-sm px-4 py-5">
    <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
      Empty State
    </div>
    <div class="mt-3 text-sm font-medium text-yd-text-primary">
      {{ title }}
    </div>
    <div class="mt-2 text-sm leading-6 text-yd-text-secondary">
      {{ description }}
    </div>
  </div>
</template>
