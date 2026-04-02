<template>
  <div class="flex min-h-full flex-col gap-4 p-6">
    <WorkspacePageHeader
      eyebrow="Social Feed"
      title="Public signal stream"
      description="Monitor public posts, scan signal density, and pivot from social chatter into the responsible agent or linked workflow intent."
      :freshness="socialFreshness"
    >
      <template #actions>
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="refresh"
        >
          Refresh Feed
        </button>
      </template>
    </WorkspacePageHeader>

    <SourceContextBanner
      v-if="socialSourceSummary"
      :message="socialSourceSummary"
      return-label="Return to source"
      @return="returnToSource"
    />

    <WorkspaceStatusBanner
      v-if="mappingHint"
      tone="info"
      title="Social Mapping Context"
      :message="mappingHint"
    />

    <SocialFiltersBar
      :author-id="socialFilters.authorId"
      :keyword="socialFilters.keyword"
      :sort="socialFilters.sort"
      @apply="handleApplyFilters"
      @reset="handleResetFilters"
    />

    <WorkspaceStatusBanner
      v-if="errorMessage"
      title="Social feed error"
      :message="errorMessage"
    />

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.1fr,0.9fr]">
      <SocialPostList
        :items="items"
        :selected-post-id="selectedPostId"
        :is-loading="isFetching"
        @select-post="selectPost"
      />
      <SocialPostDetail
        :post="selectedPost"
        @open-agent="openAuthor"
        @open-workflow="openWorkflow"
        @open-timeline="socialPage.openTimeline"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import SourceContextBanner from '../features/shared/components/SourceContextBanner.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'
import { formatFreshnessLabel } from '../features/shared/feedback'
import SocialFiltersBar from '../features/social/components/SocialFiltersBar.vue'
import SocialPostDetail from '../features/social/components/SocialPostDetail.vue'
import SocialPostList from '../features/social/components/SocialPostList.vue'
import { useSocialPage } from '../features/social/composables/useSocialPage'

const socialPage = useSocialPage()

const items = socialPage.items
const selectedPost = socialPage.selectedPost
const selectedPostId = socialPage.selectedPostId
const socialFilters = computed(() => socialPage.filters.value)
const isFetching = socialPage.isFetching
const errorMessage = socialPage.errorMessage
const selectPost = socialPage.selectPost
const openAuthor = socialPage.openAuthor
const openWorkflow = socialPage.openWorkflow
const refresh = socialPage.refresh
const socialSourceSummary = socialPage.sourceSummary
const mappingHint = socialPage.mappingHint
const returnToSource = socialPage.returnToSource

const socialFreshness = computed(() => {
  return formatFreshnessLabel(socialPage.lastSyncedAt.value, {
    isSyncing: isFetching.value,
    syncingLabel: 'Refreshing public feed',
    idleLabel: 'Awaiting first feed sync'
  })
})

const handleApplyFilters = (nextFilters: {
  authorId: string | null
  keyword: string | null
  sort: 'latest' | 'signal'
}) => {
  socialPage.setFilters(nextFilters)
}

const handleResetFilters = () => {
  socialPage.setFilters({
    authorId: null,
    keyword: null,
    sourceActionIntentId: null,
    fromTick: null,
    toTick: null,
    sort: 'latest'
  })
}
</script>
