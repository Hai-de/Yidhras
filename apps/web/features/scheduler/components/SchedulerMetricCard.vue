<script setup lang="ts">
defineProps<{
  label: string
  value: string
  subtitle: string
}>()
</script>

<template>
  <div class="yd-workbench-pane rounded-md px-4 py-4">
    <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
      {{ label }}
    </div>
    <div class="mt-3 text-2xl font-semibold text-yd-text-primary yd-font-mono">
      {{ value }}
    </div>
    <div class="mt-2 text-xs leading-5 text-yd-text-secondary">
      {{ subtitle }}
    </div>
  </div>
</template>
