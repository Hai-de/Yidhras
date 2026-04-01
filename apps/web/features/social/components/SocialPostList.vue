<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { SocialPostCardViewModel } from '../adapters'

const props = defineProps<{
  items: SocialPostCardViewModel[]
  selectedPostId: string | null
  isLoading: boolean
}>()

const emit = defineEmits<{
  selectPost: [post: SocialPostCardViewModel]
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
      title="Social Feed"
      :subtitle="props.isLoading ? 'Refreshing feed…' : `${props.items.length} visible post(s)`"
    />

    <div v-if="props.items.length > 0" class="min-h-0 flex-1 overflow-auto px-5 py-4 no-scrollbar">
      <div class="space-y-3">
        <button
          v-for="item in props.items"
          :key="item.id"
          type="button"
          class="w-full rounded-xl border px-4 py-4 text-left transition-colors"
          :class="item.id === props.selectedPostId ? 'border-yd-state-accent bg-yd-app/80' : 'border-yd-border-muted bg-yd-app hover:border-yd-border-strong'"
          @click="emit('selectPost', item)"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-yd-text-primary">
                {{ item.title }}
              </div>
              <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
                {{ item.meta }}
              </div>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span
                class="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] yd-font-mono"
                :class="signalClass(item.signalLabel)"
              >
                {{ item.signalLabel }}
              </span>
              <span class="text-[11px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                {{ item.signalScore }}
              </span>
            </div>
          </div>
          <div class="mt-4 line-clamp-3 text-sm leading-6 text-yd-text-secondary">
            {{ item.body }}
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
            <span class="rounded-md border border-yd-border-muted px-2 py-1">{{ item.timelineHint }}</span>
            <span v-if="item.sourceActionIntentId" class="rounded-md border border-yd-state-accent/30 px-2 py-1 text-yd-text-primary">
              linked workflow
            </span>
          </div>
        </button>
      </div>
    </div>

    <div v-else class="px-5 py-5">
      <WorkspaceEmptyState
        title="No social posts in current feed"
        description="Adjust author, keyword, or sort filters to inspect another slice of the public signal stream."
      />
    </div>
  </div>
</template>
