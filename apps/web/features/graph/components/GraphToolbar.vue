<script setup lang="ts">
import { ref, watchEffect } from 'vue'

const props = defineProps<{
  view: 'mesh' | 'tree'
  depth: number
  kinds: string | null
  search: string | null
  includeInactive: boolean
  includeUnresolved: boolean
  autoRefreshMode: 'manual' | 'visible-polling'
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
    <div class="flex flex-wrap items-end gap-3">
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
          @click="emit('refresh')"
        >
          Refresh
        </button>
      </div>
    </div>
  </div>
</template>
