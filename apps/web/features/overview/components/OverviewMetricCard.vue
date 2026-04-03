<script setup lang="ts">
defineProps<{
  label: string
  value: string
  subtitle: string
}>()
</script>

<template>
  <div class="yd-workbench-pane rounded-sm px-5 py-4">
    <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
      {{ label }}
    </div>
    <div class="mt-3 text-[1.875rem] font-semibold leading-none text-yd-text-primary yd-font-mono">
      {{ value }}
    </div>
    <div class="mt-3 text-xs leading-5 text-yd-text-secondary">
      {{ subtitle }}
    </div>
  </div>
</template>
