<script setup lang="ts">
import { ref, watchEffect } from 'vue'

import AppButton from '../../../components/ui/AppButton.vue'
import AppInput from '../../../components/ui/AppInput.vue'
import AppSelect from '../../../components/ui/AppSelect.vue'

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
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-[12rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Author ID
        </div>
        <AppInput v-model="authorId" placeholder="agent_..." />
      </label>

      <label class="min-w-[14rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Keyword
        </div>
        <AppInput v-model="keyword" placeholder="rumor / event / signal" />
      </label>

      <label class="min-w-[10rem]">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Sort
        </div>
        <AppSelect v-model="sort">
          <option value="latest">latest</option>
          <option value="signal">signal</option>
        </AppSelect>
      </label>

      <div class="flex items-center gap-2">
        <AppButton @click="handleApply">
          Apply
        </AppButton>
        <AppButton variant="secondary" @click="handleReset">
          Reset
        </AppButton>
      </div>
    </div>
  </div>
</template>
