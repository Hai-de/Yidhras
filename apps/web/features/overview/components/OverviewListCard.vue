<script setup lang="ts">
import type { OverviewListItemViewModel } from '../adapters'

const props = defineProps<{
  title: string
  subtitle: string
  items: OverviewListItemViewModel[]
  emptyMessage?: string
}>()

const toneClass = (tone: OverviewListItemViewModel['tone']) => {
  switch (tone) {
    case 'success':
      return 'border-yd-state-success/40'
    case 'warning':
      return 'border-yd-state-warning/40'
    case 'danger':
      return 'border-yd-state-danger/40'
    case 'info':
      return 'border-yd-state-info/40'
    default:
      return 'border-yd-border-muted'
  }
}
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[18rem] flex-col rounded-xl px-5 py-5">
    <div>
      <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        {{ title }}
      </div>
      <div class="mt-2 text-sm text-yd-text-secondary">
        {{ subtitle }}
      </div>
    </div>

    <div v-if="props.items.length > 0" class="mt-4 flex-1 space-y-3 overflow-y-auto no-scrollbar">
      <div
        v-for="item in props.items"
        :key="item.id"
        class="rounded-lg border bg-yd-app px-4 py-3"
        :class="toneClass(item.tone)"
      >
        <div class="text-sm font-medium text-yd-text-primary">
          {{ item.title }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ item.meta }}
        </div>
      </div>
    </div>

    <div v-else class="mt-4 rounded-lg border border-dashed border-yd-border-muted bg-yd-app px-4 py-6 text-sm text-yd-text-secondary">
      {{ props.emptyMessage ?? 'No items available.' }}
    </div>
  </div>
</template>
