<template>
  <div class="flex h-full flex-col gap-4 overflow-hidden p-6">
    <SocialFiltersBar
      :author-id="socialFilters.authorId"
      :keyword="socialFilters.keyword"
      :sort="socialFilters.sort"
      @apply="handleApplyFilters"
      @reset="handleResetFilters"
    />

    <div
      v-if="errorMessage"
      class="rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger"
    >
      {{ errorMessage }}
    </div>

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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

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
    sort: 'latest'
  })
}
</script>
