<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  description: string
  freshness?: string | null
}>()
</script>

<template>
  <div class="yd-workbench-pane rounded-sm">
    <div class="yd-workbench-pane-header flex flex-wrap items-start justify-between gap-4 px-5 py-4">
      <div class="max-w-3xl">
        <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
          {{ eyebrow }}
        </div>
        <h1 class="mt-3 text-[1.875rem] font-semibold tracking-[-0.02em] text-yd-text-primary">
          {{ title }}
        </h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-yd-text-secondary">
          {{ description }}
        </p>
      </div>

      <div class="flex min-w-[12rem] flex-col items-start gap-3 sm:items-end">
        <div
          v-if="freshness"
          class="yd-status-pill rounded-sm text-[10px] uppercase tracking-[0.12em] text-yd-text-secondary yd-font-mono"
        >
          {{ freshness }}
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </div>
</template>
