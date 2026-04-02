<script setup lang="ts">
import { watch } from 'vue'

import { useAppToast } from '../../../composables/ui/useAppToast'
import { useNotificationsStore } from '../../../stores/notifications'

const notifications = useNotificationsStore()
const toast = useAppToast()
const shownIds = new Set<string>()

watch(
  () => notifications.localItems.slice(),
  items => {
    for (const item of items) {
      if (shownIds.has(item.id)) {
        continue
      }

      shownIds.add(item.id)
      toast.show(item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : 'info', item.content, {
        duration: item.level === 'error' ? 5000 : 3000,
        keepAliveOnHover: true
      })
    }
  },
  { deep: true, immediate: true }
)
</script>

<template>
  <span class="hidden" />
</template>
