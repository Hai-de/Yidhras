<script setup lang="ts">
import { ref, watchEffect } from 'vue'

const props = defineProps<{
  authorId: string | null
  keyword: string | null
  sort: 'latest' | 'signal'
}>()

const emit = defineEmits<{
  apply: [filters: { authorId: string | null; keyword: string | null; sort: 'latest' | 'signal' }]
  reset: []
}>()

const authorId = ref(props.authorId ?? '')
const keyword = ref(props.keyword ?? '')
const sort = ref<'latest' | 'signal'>(props.sort)

watchEffect(() => {
  authorId.value = props.authorId ?? ''
  keyword.value = props.keyword ?? ''
  sort.value = props.sort
})

const handleApply = () => {
  emit('apply', {
    authorId: authorId.value.trim() || null,
    keyword: keyword.value.trim() || null,
    sort: sort.value
  })
}

const handleReset = () => {
  authorId.value = ''
  keyword.value = ''
  sort.value = 'latest'
  emit('reset')
}
</script>

<template>
  <div class="yd-panel-surface rounded-xl px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Author ID
        </div>
        <input
          v-model="authorId"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="agent_..."
        >
      </label>

      <label class="min-w-[14rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Keyword
        </div>
        <input
          v-model="keyword"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="rumor / event / signal"
        >
      </label>

      <label class="min-w-[10rem]">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Sort
        </div>
        <select
          v-model="sort"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
        >
          <option value="latest">latest</option>
          <option value="signal">signal</option>
        </select>
      </label>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-yd-state-accent/50 bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="handleApply"
        >
          Apply
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-muted px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
          @click="handleReset"
        >
          Reset
        </button>
      </div>
    </div>
  </div>
</template>
