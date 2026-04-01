<script setup lang="ts">
import { computed } from 'vue'

import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { TimelineEventCardViewModel } from '../adapters'
import { buildTimelineDetailFields } from '../adapters'

const props = defineProps<{
  event: TimelineEventCardViewModel | null
}>()

const emit = defineEmits<{
  openWorkflow: [actionIntentId: string, eventId: string]
  openSocial: [event: TimelineEventCardViewModel]
}>()

const detailFields = computed(() => (props.event ? buildTimelineDetailFields(props.event) : []))
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[28rem] flex-col rounded-xl">
    <WorkspaceSectionHeader
      title="Event Detail"
      :subtitle="props.event?.id ?? 'Select an event to inspect timeline context and related entities.'"
    />

    <div v-if="props.event" class="flex-1 space-y-4 px-5 py-5">
      <div>
        <div class="text-lg font-semibold text-yd-text-primary">
          {{ props.event.title }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ props.event.meta }}
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div
          v-for="field in detailFields"
          :key="field.label"
          class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3"
        >
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            {{ field.label }}
          </div>
          <div class="mt-2 break-all text-sm text-yd-text-primary">
            {{ field.value }}
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4 text-sm leading-6 text-yd-text-secondary">
        {{ props.event.description }}
      </div>

      <div class="grid gap-3">
        <button
          v-if="props.event.sourceActionIntentId"
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-3 text-left text-sm text-yd-text-primary"
          @click="emit('openWorkflow', props.event.sourceActionIntentId, props.event.id)"
        >
          Open linked workflow intent → {{ props.event.sourceActionIntentId }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-3 text-left text-sm text-yd-text-primary"
          @click="emit('openSocial', props.event)"
        >
          Open related social context → {{ props.event.sourceActionIntentId ?? props.event.title }}
        </button>
        <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3 text-sm text-yd-text-secondary">
          Priority: use linked workflow intent when available; otherwise fall back to semantic keyword context.
        </div>
      </div>
    </div>

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="No event selected"
        description="Select a timeline event to inspect its type, tick position, linked workflow intent, and related social context."
      />
    </div>
  </div>
</template>
