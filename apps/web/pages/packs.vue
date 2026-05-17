<template>
  <div class="min-h-screen bg-yd-app px-6 py-8">
    <div class="mx-auto max-w-3xl">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-yd-text-primary yd-font-mono">World Packs</h1>
          <p class="mt-1 text-xs text-yd-text-muted yd-font-mono uppercase tracking-[0.12em]">
            Select a world pack to enter
          </p>
        </div>
        <button
          type="button"
          class="rounded-sm border border-yd-border-muted px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono hover:text-yd-text-primary"
          @click="handleLogout"
        >
          Logout
        </button>
      </div>

      <div v-if="isLoading" class="mt-8 text-sm text-yd-text-muted">Loading packs...</div>

      <p v-if="errorMessage" class="mt-4 text-xs text-yd-state-danger">{{ errorMessage }}</p>

      <div v-if="!isLoading && packs.length === 0" class="mt-8 text-sm text-yd-text-secondary">
        No world packs found. Place a pack directory in the world_packs folder.
      </div>

      <div v-if="packs.length > 0" class="mt-6 grid gap-3">
        <button
          v-for="pack in packs"
          :key="pack.id"
          type="button"
          class="flex items-start gap-4 rounded-sm border border-yd-border-muted bg-yd-panel px-5 py-4 text-left transition-colors hover:border-yd-state-accent"
          @click="enterPack(pack.id)"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-yd-app text-sm font-semibold text-yd-text-muted yd-font-mono">
            {{ pack.name.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-yd-text-primary">{{ pack.name }}</div>
            <div class="mt-1 text-xs text-yd-text-secondary">{{ pack.description ?? 'No description' }}</div>
            <div class="mt-2 flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] yd-font-mono">
              <span class="text-yd-text-muted">v{{ pack.version }}</span>
              <span
                :class="pack.runtime_status === 'loaded'
                  ? 'text-yd-state-success'
                  : 'text-yd-text-muted'"
              >
                {{ pack.runtime_status === 'loaded' ? 'Loaded' : 'Not loaded' }}
              </span>
              <span v-if="pack.frontend?.type === 'custom'" class="text-yd-state-accent">Custom UI</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

import type { PackListItem } from '../composables/api/usePackListApi'
import { usePackListApi } from '../composables/api/usePackListApi'
import { useAuthStore } from '../stores/auth'

definePageMeta({
  layout: false,
  middleware: 'auth'
})

const router = useRouter()
const auth = useAuthStore()
const packListApi = usePackListApi()

const packs = ref<PackListItem[]>([])
const isLoading = ref(true)
const errorMessage = ref<string | null>(null)

const fetchPacks = async () => {
  isLoading.value = true
  errorMessage.value = null

  try {
    const result = await packListApi.listPacks()
    packs.value = result.packs
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load packs'
  } finally {
    isLoading.value = false
  }
}

const enterPack = (packId: string) => {
  router.push(`/packs/${packId}`)
}

const handleLogout = () => {
  auth.clearToken()
  router.push('/login')
}

if (!auth.isAuthenticated) {
  router.replace('/login')
} else {
  fetchPacks()
}
</script>
