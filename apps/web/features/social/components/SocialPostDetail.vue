<script setup lang="ts">
import type { SocialPostCardViewModel } from '../adapters'

const props = defineProps<{
  post: SocialPostCardViewModel | null
}>()

const emit = defineEmits<{
  openAgent: [agentId: string]
  openWorkflow: [actionIntentId: string]
}>()
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[28rem] flex-col rounded-xl px-5 py-4">
    <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
      Post Detail
    </div>

    <div v-if="props.post" class="mt-4 flex-1 space-y-4">
      <div>
        <div class="text-lg font-semibold text-yd-text-primary">
          {{ props.post.title }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ props.post.meta }}
        </div>
      </div>

      <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4 text-sm leading-6 text-yd-text-secondary">
        {{ props.post.body }}
      </div>

      <div class="grid gap-3">
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-3 text-left text-sm text-yd-text-primary"
          @click="emit('openAgent', props.post.authorId)"
        >
          Open author detail → {{ props.post.authorId }}
        </button>
        <button
          v-if="props.post.sourceActionIntentId"
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-3 text-left text-sm text-yd-text-primary"
          @click="emit('openWorkflow', props.post.sourceActionIntentId)"
        >
          Open linked workflow trace → {{ props.post.sourceActionIntentId }}
        </button>
      </div>
    </div>

    <div v-else class="mt-4 rounded-xl border border-dashed border-yd-border-muted bg-yd-app px-4 py-6 text-sm text-yd-text-secondary">
      Select a post to inspect its author and source action intent.
    </div>
  </div>
</template>
