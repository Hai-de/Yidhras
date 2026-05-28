<template>
  <div v-if="status === 'loading'" class="flex min-h-screen items-center justify-center bg-yd-app">
    <div class="text-sm text-yd-text-muted yd-font-mono">Loading pack frontend...</div>
  </div>

  <div v-if="status === 'error'" class="flex min-h-screen items-center justify-center bg-yd-app px-4">
    <div class="max-w-md rounded-sm border border-yd-state-danger bg-yd-panel p-6">
      <h2 class="text-sm font-semibold text-yd-state-danger yd-font-mono">Frontend Load Error</h2>
      <p class="mt-2 text-xs text-yd-text-secondary">{{ errorMessage }}</p>
      <button
        type="button"
        class="mt-4 rounded-sm border border-yd-border-muted px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono hover:text-yd-text-primary"
        @click="goToPacks"
      >
        Back to Packs
      </button>
    </div>
  </div>

  <div v-show="status !== 'loading' && status !== 'error'" ref="mountContainer" class="min-h-screen" />
</template>

<script setup lang="ts">
import type { App } from 'vue'

import type { PackListItem } from '../../../composables/api/usePackListApi'
import { usePackListApi } from '../../../composables/api/usePackListApi'
import { buildShellContext } from '../../../composables/app/useShellContext'
import { useShellNavigation } from '../../../composables/app/useShellNavigation'
import { resolveApiBaseUrl } from '../../../lib/http/client'

const props = defineProps<{
  packId: string
}>()

const packListApi = usePackListApi()
const { goToPacks } = useShellNavigation()

const mountContainer = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'loaded' | 'error'>('loading')
const errorMessage = ref<string | null>(null)

let appInstance: App | null = null
let packFrontendUnmount: ((app: App) => void) | null = null
let unmounted = false

const resolveEntryUrl = (pack: PackListItem): string => {
  if (pack.frontend?.type !== 'custom' || !pack.frontend.entry) {
    throw new Error('Pack does not have a custom frontend entry')
  }

  const entry = pack.frontend.entry

  if (entry.startsWith('http://') || entry.startsWith('https://')) {
    return entry
  }

  const apiBase = resolveApiBaseUrl()
  const normalizedEntry = entry.replace(/^\.?\/?/, '')

  if (apiBase) {
    return `${apiBase}/api/packs/${pack.instance_id}/frontend/${normalizedEntry}`
  }

  return `/api/packs/${pack.instance_id}/frontend/${normalizedEntry}`
}

const loadPackFrontend = async () => {
  try {
    const shellContext = buildShellContext(props.packId)

    const result = await packListApi.listPacks()
    const pack = result.packs.find(p => p.instance_id === props.packId)

    if (!pack) {
      throw new Error(`Pack ${props.packId} not found`)
    }

    if (pack.frontend?.type !== 'custom' || !pack.frontend.entry) {
      throw new Error(`Pack ${props.packId} does not have a custom frontend configured`)
    }

    const entryUrl = resolveEntryUrl(pack)
    // eslint-disable-next-line no-unsanitized/method
    const module = await import(/* @vite-ignore */ entryUrl)

    if (typeof module.mount !== 'function') {
      throw new Error('Pack frontend module must export a mount function')
    }

    if (typeof module.unmount === 'function') {
      packFrontendUnmount = module.unmount
    }

    if (mountContainer.value && !unmounted) {
      try {
        appInstance = module.mount(mountContainer.value, shellContext)
        status.value = 'loaded'
      } catch (mountError) {
        if (!unmounted) {
          status.value = 'error'
          errorMessage.value = mountError instanceof Error ? mountError.message : 'Failed to mount pack frontend'
        }
      }
    } else if (!unmounted) {
      status.value = 'error'
      errorMessage.value = 'Mount container is not available'
    }
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load pack frontend'
  }
}

onMounted(() => {
  loadPackFrontend()
})

onBeforeUnmount(() => {
  unmounted = true
  if (appInstance) {
    if (packFrontendUnmount) {
      packFrontendUnmount(appInstance)
    } else {
      appInstance.unmount()
    }
    appInstance = null
    packFrontendUnmount = null
  }
})
</script>
