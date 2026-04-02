<script setup lang="ts">
import AppBadge from '../../../components/ui/AppBadge.vue'
import AppButton from '../../../components/ui/AppButton.vue'
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

const signalTone = (signalLabel: SocialPostCardViewModel['signalLabel']) => {
  switch (signalLabel) {
    case 'high':
      return 'success'
    case 'medium':
      return 'warning'
    default:
      return 'danger'
  }
}
</script>

<template>
  <div class="yd-workbench-pane flex h-full min-h-[28rem] flex-col rounded-md">
    <WorkspaceSectionHeader
      title="Post Detail"
      :subtitle="props.post?.id ?? 'Select a post to inspect its context and related entities.'"
    />

    <div v-if="props.post" class="flex-1 space-y-4 px-4 py-4">
      <div>
        <div class="text-lg font-semibold text-yd-text-primary">
          {{ props.post.title }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ props.post.meta }}
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="yd-workbench-inset rounded-sm px-4 py-3">
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            Signal
          </div>
          <div class="mt-2 flex items-center gap-2">
            <AppBadge :tone="signalTone(props.post.signalLabel)">
              {{ props.post.signalLabel }}
            </AppBadge>
            <span class="text-sm text-yd-text-primary yd-font-mono">{{ props.post.signalScore }}</span>
          </div>
        </div>

        <div class="yd-workbench-inset rounded-sm px-4 py-3">
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            Timeline Hint
          </div>
          <div class="mt-2 text-sm text-yd-text-primary yd-font-mono">
            {{ props.post.timelineHint }}
          </div>
        </div>
      </div>

      <div class="yd-workbench-inset rounded-md px-4 py-4 text-sm leading-6 text-yd-text-secondary">
        {{ props.post.body }}
      </div>

      <div class="grid gap-3">
        <AppButton class="text-left text-sm normal-case tracking-normal yd-font-sans" @click="emit('openAgent', props.post.authorId)">
          Open author detail → {{ props.post.authorId }}
        </AppButton>
        <AppButton
          v-if="props.post.sourceActionIntentId"
          class="text-left text-sm normal-case tracking-normal yd-font-sans"
          @click="emit('openWorkflow', props.post.sourceActionIntentId)"
        >
          Open linked workflow intent → {{ props.post.sourceActionIntentId }}
        </AppButton>
        <AppButton class="text-left text-sm normal-case tracking-normal yd-font-sans" @click="emit('openTimeline', props.post)">
          Open timeline slice → {{ props.post.timelineHint }}
        </AppButton>
      </div>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="No post selected"
        description="Select a post to inspect signal strength, author context, linked workflow, and its timeline hint."
      />
    </div>
  </div>
</template>
