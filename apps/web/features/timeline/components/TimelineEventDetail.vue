<script setup lang="ts">
import { computed } from 'vue'

import AppButton from '../../../components/ui/AppButton.vue'
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
  <div class="yd-workbench-pane flex h-full min-h-[28rem] flex-col rounded-md">
    <WorkspaceSectionHeader
      title="Event Detail"
      :subtitle="props.event?.id ?? 'Select an event to inspect timeline context and related entities.'"
    />

    <div v-if="props.event" class="flex-1 space-y-4 px-4 py-4">
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
          class="yd-workbench-inset rounded-sm px-4 py-3"
        >
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            {{ field.label }}
          </div>
          <div class="mt-2 break-all text-sm text-yd-text-primary">
            {{ field.value }}
          </div>
        </div>
      </div>

      <div class="yd-workbench-inset rounded-md px-4 py-4 text-sm leading-6 text-yd-text-secondary">
        {{ props.event.description }}
      </div>

      <div class="grid gap-3">
        <AppButton
          v-if="props.event.sourceActionIntentId"
          class="text-left text-sm normal-case tracking-normal yd-font-sans"
          @click="emit('openWorkflow', props.event.sourceActionIntentId, props.event.id)"
        >
          Open linked workflow intent → {{ props.event.sourceActionIntentId }}
        </AppButton>
        <AppButton class="text-left text-sm normal-case tracking-normal yd-font-sans" @click="emit('openSocial', props.event)">
          Open related social context → {{ props.event.sourceActionIntentId ?? props.event.title }}
        </AppButton>
        <div class="yd-workbench-inset rounded-sm px-4 py-3 text-sm text-yd-text-secondary">
          Priority: use linked workflow intent when available; otherwise fall back to semantic keyword context.
        </div>
      </div>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="No event selected"
        description="Select a timeline event to inspect its type, tick position, linked workflow intent, and related social context."
      />
    </div>
  </div>
</template>
