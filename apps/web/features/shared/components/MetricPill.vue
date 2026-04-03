<script setup lang="ts">
defineProps<{
  label: string
  value: string
}>()
</script>

<template>
  <div class="yd-detail-grid-item rounded-sm px-3 py-3">
    <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
      {{ label }}
    </div>
    <div class="mt-2 text-sm font-medium leading-6 text-yd-text-primary yd-font-mono">
      {{ value }}
    </div>
  </div>
</template>
