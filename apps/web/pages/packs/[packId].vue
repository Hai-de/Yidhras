<template>
  <div v-if="frontendType === null" class="flex min-h-screen items-center justify-center bg-yd-app">
    <div class="text-sm text-yd-text-muted yd-font-mono">Loading...</div>
  </div>

  <div v-else-if="frontendType === 'custom'" class="min-h-screen bg-yd-app">
    <PackFrontendMount :pack-id="packId" />
  </div>

  <AppShell v-else>
    <NuxtPage />
  </AppShell>
</template>

<script setup lang="ts">
import { usePackListApi } from '../../composables/api/usePackListApi'
import AppShell from '../../features/shell/components/AppShell.vue'
import PackFrontendMount from '../../features/shell/components/PackFrontendMount.vue'

definePageMeta({
  layout: false,
  middleware: 'auth'
})

const route = useRoute()
const packId = computed(() => (route.params.packId as string) ?? '')

const frontendType = ref<'default' | 'custom' | null>(null)
const packListApi = usePackListApi()
let lastResolvedPackId = ''
let resolveRetries = 0
const MAX_RETRIES = 3

const resolveFrontendType = async () => {
  const targetPackId = packId.value
  if (!targetPackId) return

  try {
    const result = await packListApi.listPacks()
    const pack = result.packs.find(p => p.instance_id === targetPackId)
    frontendType.value = pack?.frontend?.type ?? 'default'
    lastResolvedPackId = targetPackId
    resolveRetries = 0
  } catch {
    resolveRetries++
    if (resolveRetries < MAX_RETRIES) {
      setTimeout(() => { void resolveFrontendType() }, 500 * resolveRetries)
      return
    }
    frontendType.value = 'default'
    lastResolvedPackId = targetPackId
    resolveRetries = 0
  }

  // Auto-redirect default-frontend packs to overview workspace
  if (frontendType.value !== 'custom' && !route.path.split('/').slice(3)[0]) {
    await navigateTo(`/packs/${targetPackId}/overview`, { replace: true })
  }
}

onMounted(() => {
  resolveFrontendType()
})

watch(packId, (newId, oldId) => {
  if (!newId || newId === oldId || newId === lastResolvedPackId) return
  frontendType.value = null
  resolveRetries = 0
  resolveFrontendType()
})
</script>
