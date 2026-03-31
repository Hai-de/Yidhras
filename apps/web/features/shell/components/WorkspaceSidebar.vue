<script setup lang="ts">
const props = defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <aside class="flex h-full w-72 shrink-0 flex-col border-r border-yd-border-muted bg-yd-panel">
    <header class="border-b border-yd-border-muted px-5 py-4">
      <div class="text-xs uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        Workspace
      </div>
      <div class="mt-2 text-sm font-semibold text-yd-text-primary">
        {{ props.title }}
      </div>
      <div v-if="props.subtitle" class="mt-1 text-xs text-yd-text-secondary">
        {{ props.subtitle }}
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-4">
      <slot>
        <div class="yd-panel-surface rounded-lg px-4 py-4 text-sm text-yd-text-secondary">
          Sidebar content placeholder
        </div>
      </slot>
    </div>
  </aside>
</template>
