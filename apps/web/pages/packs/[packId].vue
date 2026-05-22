<template>
  <div v-if="frontendType === 'custom'" class="min-h-screen bg-yd-app">
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

const resolveFrontendType = async () => {
  try {
    const result = await packListApi.listPacks()
    const pack = result.packs.find(p => p.instance_id === packId.value)
    frontendType.value = pack?.frontend?.type ?? 'default'
  } catch {
    frontendType.value = 'default'
  }
}

onMounted(() => {
  resolveFrontendType()
})

watch(packId, () => {
  frontendType.value = null
  resolveFrontendType()
})
</script>
