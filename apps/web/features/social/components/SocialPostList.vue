<script setup lang="ts">
import AppBadge from '../../../components/ui/AppBadge.vue'
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
      title="Social Feed"
      :subtitle="props.isLoading ? 'Refreshing feed…' : `${props.items.length} visible post(s)`"
    />

    <div v-if="props.items.length > 0" class="min-h-0 flex-1 overflow-auto px-4 py-4 no-scrollbar">
      <div class="space-y-2.5">
        <button
          v-for="item in props.items"
          :key="item.id"
          type="button"
          class="yd-workbench-item w-full rounded-md px-4 py-4 text-left transition-colors"
          :class="item.id === props.selectedPostId ? 'yd-workbench-item--active' : ''"
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
              <AppBadge :tone="signalTone(item.signalLabel)">
                {{ item.signalLabel }}
              </AppBadge>
              <span class="text-[11px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                {{ item.signalScore }}
              </span>
            </div>
          </div>
          <div class="mt-4 line-clamp-3 text-sm leading-6 text-yd-text-secondary">
            {{ item.body }}
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
            <AppBadge shape="tag">
              {{ item.timelineHint }}
            </AppBadge>
            <AppBadge v-if="item.sourceActionIntentId" tone="accent" shape="tag">
              linked workflow
            </AppBadge>
          </div>
        </button>
      </div>
    </div>

    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="No social posts in current feed"
        description="Adjust author, keyword, or sort filters to inspect another slice of the public signal stream."
      />
    </div>
  </div>
</template>
