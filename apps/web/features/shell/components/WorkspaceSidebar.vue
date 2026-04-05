<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <aside
    class="yd-separator-right flex h-full shrink-0 flex-col bg-yd-panel"
    :style="{ width: 'var(--yd-layout-shell-sidebar-width)' }"
  >
    <slot name="header">
      <header class="yd-separator-bottom shrink-0 px-4 py-3">
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          Workspace
        </div>
        <div class="mt-2 text-sm font-semibold text-yd-text-primary">
          {{ title }}
        </div>
        <div v-if="subtitle" class="mt-1 text-xs leading-5 text-yd-text-secondary">
          {{ subtitle }}
        </div>
      </header>
    </slot>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <slot>
        <div class="yd-shell-surface rounded-sm px-4 py-4 text-sm text-yd-text-secondary">
          Sidebar content placeholder
        </div>
      </slot>
    </div>
  </aside>
</template>
