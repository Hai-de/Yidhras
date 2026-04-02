<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  description: string
  freshness?: string | null
}>()
</script>

<template>
  <div class="yd-workbench-pane rounded-md">
    <div class="yd-workbench-pane-header flex flex-wrap items-start justify-between gap-4 px-5 py-4">
      <div class="max-w-3xl">
        <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
          {{ eyebrow }}
        </div>
        <h1 class="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-yd-text-primary">
          {{ title }}
        </h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-yd-text-secondary">
          {{ description }}
        </p>
      </div>

      <div class="flex min-w-[12rem] flex-col items-start gap-3 sm:items-end">
        <div
          v-if="freshness"
          class="yd-workbench-inset rounded-sm px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono"
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
