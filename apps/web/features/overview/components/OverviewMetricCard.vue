<script setup lang="ts">
defineProps<{
  label: string
  value: string
  subtitle: string
}>()
</script>

<template>
  <div class="yd-panel-surface rounded-xl px-5 py-5">
    <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
      {{ label }}
    </div>
    <div class="mt-3 text-3xl font-semibold text-yd-text-primary yd-font-mono">
      {{ value }}
    </div>
    <div class="mt-2 text-xs leading-5 text-yd-text-secondary">
      {{ subtitle }}
    </div>
  </div>
</template>
