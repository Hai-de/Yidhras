<template>
  <div class="h-screen overflow-y-auto bg-yd-app px-6 py-8">
    <div class="mx-auto max-w-6xl">
      <header class="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-yd-text-primary yd-font-mono">{{ $t('packs.title') }}</h1>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="yd-industrial-button rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-text-secondary yd-font-mono hover:text-yd-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="isLoading"
            @click="fetchPacks"
          >
            {{ isLoading ? $t('common.refreshing') : $t('common.refresh') }}
          </button>
          <button
            type="button"
            class="yd-industrial-button rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-text-secondary yd-font-mono hover:text-yd-text-primary"
            @click="handleLogout"
          >
            {{ $t('common.logout') }}
          </button>
        </div>
      </header>

      <div class="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-yd-text-secondary">
        <span><span class="text-yd-text-muted">{{ $t('packs.summary_total') }}</span> <span class="font-semibold text-yd-text-primary">{{ packSummary.total }}</span></span>
        <span class="text-yd-border-muted">|</span>
        <span><span class="text-yd-text-muted">{{ $t('packs.summary_loaded') }}</span> <span class="font-semibold text-yd-state-success">{{ packSummary.loaded }}</span></span>
        <span class="text-yd-border-muted">|</span>
        <span><span class="text-yd-text-muted">{{ $t('packs.summary_not_loaded') }}</span> <span class="font-semibold text-yd-text-primary">{{ packSummary.notLoaded }}</span></span>
        <span class="text-yd-border-muted">|</span>
        <span><span class="text-yd-text-muted">{{ $t('packs.summary_issues') }}</span> <span class="font-semibold text-yd-state-warning">{{ packSummary.issues }}</span></span>
      </div>

      <AppAlert v-if="errorMessage" class="mt-5" tone="danger" :title="$t('packs.error_list')">
        {{ errorMessage }}
      </AppAlert>

      <AppAlert v-if="operationError" class="mt-5" tone="danger" :title="$t('packs.error_operation')">
        {{ operationError }}
      </AppAlert>

      <div v-if="isLoading && packs.length === 0" class="mt-8 text-sm text-yd-text-muted">{{ $t('packs.loading_packs') }}</div>

      <div v-if="!isLoading && packs.length === 0" class="mt-8 text-sm text-yd-text-secondary">
        {{ $t('packs.empty') }}
      </div>

      <div v-if="packs.length > 0" class="mt-6 grid gap-4">
        <article
          v-for="pack in packs"
          :key="pack.instance_id"
          class="yd-panel-surface rounded-sm border border-yd-border-muted bg-yd-panel px-5 py-5"
        >
          <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-3">
                <h2 class="text-base font-semibold text-yd-text-primary">{{ pack.name }}</h2>
                <span class="yd-status-pill text-[10px] uppercase tracking-[0.12em] yd-font-mono" :class="statusToneClass(pack)">
                  {{ statusLabel(pack.runtime_status) }}
                </span>
                <span v-if="pack.frontend?.type === 'custom'" class="yd-status-pill text-[10px] uppercase tracking-[0.12em] text-yd-state-accent yd-font-mono">
                  {{ $t('packs.custom_ui') }}
                </span>
              </div>

              <p class="mt-2 max-w-3xl text-sm leading-6 text-yd-text-secondary">
                {{ pack.description ?? $t('common.no_description') }}
              </p>

              <div class="mt-4 grid gap-3 text-[10px] uppercase tracking-[0.12em] yd-font-mono sm:grid-cols-2 lg:grid-cols-4">
                <div class="yd-panel-inset rounded-sm px-3 py-2">
                  <div class="text-yd-text-muted">{{ $t('packs.field_instance') }}</div>
                  <div class="mt-1 truncate text-yd-text-primary">{{ pack.instance_id }}</div>
                </div>
                <div class="yd-panel-inset rounded-sm px-3 py-2">
                  <div class="text-yd-text-muted">{{ $t('packs.field_type') }}</div>
                  <div class="mt-1 truncate text-yd-text-primary">{{ pack.metadata_id }}</div>
                </div>
                <div class="yd-panel-inset rounded-sm px-3 py-2">
                  <div class="text-yd-text-muted">{{ $t('packs.field_folder') }}</div>
                  <div class="mt-1 truncate text-yd-text-primary">{{ pack.folder_name }}</div>
                </div>
                <div class="yd-panel-inset rounded-sm px-3 py-2">
                  <div class="text-yd-text-muted">{{ $t('packs.field_version') }}</div>
                  <div class="mt-1 truncate text-yd-text-primary">v{{ pack.version }}</div>
                </div>
              </div>

            </div>

            <div class="flex flex-wrap justify-start gap-2 lg:justify-end">
              <button
                type="button"
                class="yd-industrial-button rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-text-primary yd-font-mono hover:border-yd-state-accent/60"
                :disabled="isPackPending(pack.instance_id)"
                @click="enterPack(pack.instance_id)"
              >
                {{ $t('packs.enter') }}
              </button>
              <button
                v-if="pack.runtime_status === 'not_loaded'"
                type="button"
                class="yd-industrial-button rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-state-success yd-font-mono hover:border-yd-state-success/60 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="isPackPending(pack.instance_id)"
                @click="handleLoadPack(pack)"
              >
                {{ pendingByInstanceId[pack.instance_id] === 'load' ? $t('common.loading') : $t('packs.load') }}
              </button>
              <button
                v-if="pack.runtime_status === 'loaded'"
                type="button"
                class="yd-industrial-button rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-state-warning yd-font-mono hover:border-yd-state-warning/60 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="isPackPending(pack.instance_id)"
                @click="handleUnloadPack(pack)"
              >
                {{ pendingByInstanceId[pack.instance_id] === 'unload' ? $t('common.loading') : $t('packs.unload') }}
              </button>
              <button
                type="button"
                class="rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-text-muted yd-font-mono opacity-50"
                disabled
                title="Reload is not implemented in this MVP"
              >
                {{ $t('packs.reload_soon') }}
              </button>
              <button
                type="button"
                class="rounded-sm border border-yd-border-muted px-3 py-2 text-[10px] tracking-[0.12em] text-yd-state-danger yd-font-mono opacity-50"
                disabled
                title="Delete is not implemented in this MVP"
              >
                {{ $t('packs.delete') }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

import AppAlert from '../../components/ui/AppAlert.vue'
import type { PackListItem } from '../../composables/api/usePackListApi'
import { usePackListApi } from '../../composables/api/usePackListApi'
import { usePackOperationsApi } from '../../composables/api/usePackOperationsApi'
import { useAuthStore } from '../../stores/auth'

definePageMeta({
  layout: false,
  middleware: 'auth'
})

type PackOperation = 'load' | 'unload'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const packListApi = usePackListApi()
const packOperationsApi = usePackOperationsApi()

const packs = ref<PackListItem[]>([])
const isLoading = ref(true)
const errorMessage = ref<string | null>(null)
const operationError = ref<string | null>(null)
const pendingByInstanceId = ref<Record<string, PackOperation | null>>({})

const packSummary = computed(() => {
  const loaded = packs.value.filter(pack => pack.runtime_status === 'loaded').length
  const notLoaded = packs.value.filter(pack => pack.runtime_status === 'not_loaded').length
  const issues = packs.value.filter(pack => {
    const health = pack.health_status?.toLowerCase()
    return Boolean(health && health !== 'loaded' && health !== 'ok')
  }).length

  return {
    total: packs.value.length,
    loaded,
    notLoaded,
    issues
  }
})

const statusLabel = (status: PackListItem['runtime_status']): string => {
  return t(`packs.status_${status}`)
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  return error instanceof Error ? error.message : fallback
}

const statusToneClass = (pack: PackListItem): string => {
  if (pack.runtime_status === 'loaded') {
    return 'yd-tone-success text-yd-state-success'
  }

  return 'text-yd-text-muted'
}

const setPending = (instanceId: string, operation: PackOperation | null) => {
  pendingByInstanceId.value = {
    ...pendingByInstanceId.value,
    [instanceId]: operation
  }
}

const isPackPending = (instanceId: string): boolean => Boolean(pendingByInstanceId.value[instanceId])

const fetchPacks = async () => {
  isLoading.value = true
  errorMessage.value = null

  try {
    const result = await packListApi.listPacks()
    packs.value = result.packs
  } catch (error) {
    errorMessage.value = getErrorMessage(error, t('packs.error_list'))
  } finally {
    isLoading.value = false
  }
}

const enterPack = (instanceId: string) => {
  router.push(`/packs/${instanceId}`)
}

const handleLoadPack = async (pack: PackListItem) => {
  operationError.value = null
  setPending(pack.instance_id, 'load')

  try {
    await packOperationsApi.loadPack(pack.instance_id)
    await fetchPacks()
  } catch (error) {
    operationError.value = getErrorMessage(error, t('packs.error_operation'))
  } finally {
    setPending(pack.instance_id, null)
  }
}

const handleUnloadPack = async (pack: PackListItem) => {
  const confirmed = window.confirm(
    t('packs.confirm_unload', { name: pack.name })
  )
  if (!confirmed) return

  operationError.value = null
  setPending(pack.instance_id, 'unload')

  try {
    await packOperationsApi.unloadPack(pack.instance_id)
    await fetchPacks()
  } catch (error) {
    operationError.value = getErrorMessage(error, t('packs.error_operation'))
  } finally {
    setPending(pack.instance_id, null)
  }
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
