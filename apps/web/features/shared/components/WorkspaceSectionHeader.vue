<script setup lang="ts">
defineProps<{
  title: string
  subtitle: string
}>()
</script>

<template>
  <div class="flex items-start justify-between gap-4 border-b border-yd-border-muted px-5 py-4">
    <div>
      <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        {{ title }}
      </div>
      <div class="mt-2 text-sm text-yd-text-secondary">
        {{ subtitle }}
      </div>
    </div>
    <div class="flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
