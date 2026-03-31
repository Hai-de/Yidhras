<script setup lang="ts">
import type { TimelineEventCardViewModel } from '../adapters'

const props = defineProps<{
  items: TimelineEventCardViewModel[]
  selectedEventId: string | null
  isLoading: boolean
}>()

const emit = defineEmits<{
  selectEvent: [event: TimelineEventCardViewModel]
  openWorkflow: [actionIntentId: string]
}>()
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[28rem] flex-col rounded-xl">
    <div class="border-b border-yd-border-muted px-5 py-4">
      <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        Timeline Events
      </div>
      <div class="mt-2 text-sm text-yd-text-secondary">
        {{ props.isLoading ? 'Refreshing timeline…' : `${props.items.length} event(s) in current view.` }}
      </div>
    </div>

    <div v-if="props.items.length > 0" class="min-h-0 flex-1 overflow-auto px-5 py-4 no-scrollbar">
      <div class="space-y-3">
        <div
          v-for="item in props.items"
          :key="item.id"
          class="rounded-xl border px-4 py-4"
          :class="item.id === props.selectedEventId ? 'border-yd-state-accent bg-yd-app/80' : 'border-yd-border-muted bg-yd-app'"
        >
          <button type="button" class="w-full text-left" @click="emit('selectEvent', item)">
            <div class="text-sm font-medium text-yd-text-primary">
              {{ item.title }}
            </div>
            <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
              {{ item.meta }}
            </div>
            <div class="mt-4 text-sm leading-6 text-yd-text-secondary">
              {{ item.description }}
            </div>
          </button>

          <button
            v-if="item.sourceActionIntentId"
            type="button"
            class="mt-4 rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
            @click="emit('openWorkflow', item.sourceActionIntentId)"
          >
            Open workflow link
          </button>
        </div>
      </div>
    </div>

    <div v-else class="px-5 py-8 text-sm text-yd-text-secondary">
      No timeline events available for the selected range.
    </div>
  </div>
</template>
