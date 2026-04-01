<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { SocialPostCardViewModel } from '../adapters'

const props = defineProps<{
  post: SocialPostCardViewModel | null
}>()

const emit = defineEmits<{
  openAgent: [agentId: string]
  openWorkflow: [actionIntentId: string]
  openTimeline: [post: SocialPostCardViewModel]
}>()

const signalClass = (signalLabel: SocialPostCardViewModel['signalLabel']) => {
  switch (signalLabel) {
    case 'high':
      return 'text-yd-state-success border-yd-state-success/40'
    case 'medium':
      return 'text-yd-state-warning border-yd-state-warning/40'
    default:
      return 'text-yd-state-danger border-yd-state-danger/40'
  }
}
</script>

<template>
  <div class="yd-panel-surface flex h-full min-h-[28rem] flex-col rounded-xl">
    <WorkspaceSectionHeader
      title="Post Detail"
      :subtitle="props.post?.id ?? 'Select a post to inspect its context and related entities.'"
    />

    <div v-if="props.post" class="flex-1 space-y-4 px-5 py-5">
      <div>
        <div class="text-lg font-semibold text-yd-text-primary">
          {{ props.post.title }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ props.post.meta }}
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3">
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            Signal
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] yd-font-mono" :class="signalClass(props.post.signalLabel)">
              {{ props.post.signalLabel }}
            </span>
            <span class="text-sm text-yd-text-primary yd-font-mono">{{ props.post.signalScore }}</span>
          </div>
        </div>

        <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3">
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            Timeline Hint
          </div>
          <div class="mt-2 text-sm text-yd-text-primary yd-font-mono">
            {{ props.post.timelineHint }}
          </div>
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
          Open linked workflow intent → {{ props.post.sourceActionIntentId }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-3 text-left text-sm text-yd-text-primary"
          @click="emit('openTimeline', props.post)"
        >
          Open timeline slice → {{ props.post.timelineHint }}
        </button>
      </div>
    </div>

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="No post selected"
        description="Select a post to inspect signal strength, author context, linked workflow, and its timeline hint."
      />
    </div>
  </div>
</template>
