<script setup lang="ts">
import { ref, watchEffect } from 'vue'

import type { GraphQuickRootViewModel } from '../adapters'

const props = defineProps<{
  view: 'mesh' | 'tree'
  depth: number
  kinds: string | null
  search: string | null
  includeInactive: boolean
  includeUnresolved: boolean
  autoRefreshMode: 'manual' | 'visible-polling'
  rootLabel?: string | null
  selectedLabel?: string | null
  resultSummary?: string
  filterSummary?: string
  quickRoots?: GraphQuickRootViewModel[]
}>()

const emit = defineEmits<{
  apply: [filters: {
    view: 'mesh' | 'tree'
    depth: number
    kinds: string | null
    search: string | null
    includeInactive: boolean
    includeUnresolved: boolean
    autoRefreshMode: 'manual' | 'visible-polling'
  }]
  refresh: []
  clearFilters: []
  focusSelected: []
  useSelectedAsRoot: []
  useQuickRoot: [rootId: string]
}>()

const view = ref<'mesh' | 'tree'>(props.view)
const depth = ref(String(props.depth))
const kinds = ref(props.kinds ?? '')
const search = ref(props.search ?? '')
const includeInactive = ref(props.includeInactive)
const includeUnresolved = ref(props.includeUnresolved)
const autoRefreshMode = ref<'manual' | 'visible-polling'>(props.autoRefreshMode)

watchEffect(() => {
  view.value = props.view
  depth.value = String(props.depth)
  kinds.value = props.kinds ?? ''
  search.value = props.search ?? ''
  includeInactive.value = props.includeInactive
  includeUnresolved.value = props.includeUnresolved
  autoRefreshMode.value = props.autoRefreshMode
})

const handleApply = () => {
  emit('apply', {
    view: view.value,
    depth: Number.parseInt(depth.value, 10) || 1,
    kinds: kinds.value.trim() || null,
    search: search.value.trim() || null,
    includeInactive: includeInactive.value,
    includeUnresolved: includeUnresolved.value,
    autoRefreshMode: autoRefreshMode.value
  })
}
</script>

<template>
  <div class="yd-panel-surface rounded-xl px-5 py-4">
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-yd-border-muted pb-4">
      <div>
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Graph Controls
        </div>
        <div class="mt-2 text-sm text-yd-text-secondary">
          {{ props.resultSummary ?? 'No result summary available.' }}
        </div>
        <div class="mt-2 text-[11px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ props.filterSummary ?? 'No filter summary available.' }}
        </div>
      </div>

      <div class="grid gap-2 text-sm text-yd-text-secondary sm:text-right">
        <div>
          Root:
          <span class="text-yd-text-primary yd-font-mono">{{ props.rootLabel ?? 'No root selected' }}</span>
        </div>
        <div>
          Focus:
          <span class="text-yd-text-primary yd-font-mono">{{ props.selectedLabel ?? 'No node selected' }}</span>
        </div>
      </div>
    </div>

    <div v-if="props.quickRoots && props.quickRoots.length > 0" class="mt-4 border-b border-yd-border-muted pb-4">
      <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
        Quick Roots
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="root in props.quickRoots"
          :key="root.id"
          type="button"
          class="rounded-lg border px-3 py-2 text-left transition-colors"
          :class="root.isActive ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary' : 'border-yd-border-muted bg-yd-app text-yd-text-secondary hover:border-yd-border-strong'"
          @click="emit('useQuickRoot', root.id)"
        >
          <div class="text-xs uppercase tracking-[0.14em] yd-font-mono">
            {{ root.label }}
          </div>
          <div class="mt-1 text-[11px] opacity-80">
            {{ root.subtitle }}
          </div>
        </button>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-end gap-3">
      <label class="min-w-[9rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          View
        </div>
        <select
          v-model="view"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
        >
          <option value="mesh">mesh</option>
          <option value="tree">tree</option>
        </select>
      </label>

      <label class="w-28">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Depth
        </div>
        <input
          v-model="depth"
          type="number"
          min="0"
          max="3"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
        >
      </label>

      <label class="min-w-[14rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Kinds
        </div>
        <input
          v-model="kinds"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="agent,relay"
        >
      </label>

      <label class="min-w-[14rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Search
        </div>
        <input
          v-model="search"
          type="text"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
          placeholder="root / label / metadata"
        >
      </label>

      <label class="flex items-center gap-2 text-xs text-yd-text-secondary">
        <input v-model="includeInactive" type="checkbox">
        <span>include inactive</span>
      </label>

      <label class="flex items-center gap-2 text-xs text-yd-text-secondary">
        <input v-model="includeUnresolved" type="checkbox">
        <span>include unresolved</span>
      </label>

      <label class="min-w-[11rem]">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Refresh Mode
        </div>
        <select
          v-model="autoRefreshMode"
          class="mt-2 w-full rounded-lg border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none"
        >
          <option value="manual">manual</option>
          <option value="visible-polling">visible-polling</option>
        </select>
      </label>

      <div class="flex flex-wrap items-center gap-2">
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
          @click="emit('clearFilters')"
        >
          Clear Filters
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-muted px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
          @click="emit('focusSelected')"
        >
          Focus Selected
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-muted px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
          @click="emit('useSelectedAsRoot')"
        >
          Use Selected as Root
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-muted px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
          @click="emit('refresh')"
        >
          Refresh
        </button>
      </div>
    </div>
  </div>
</template>
