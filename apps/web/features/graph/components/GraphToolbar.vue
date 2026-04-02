<script setup lang="ts">
import { ref, watchEffect } from 'vue'

import AppButton from '../../../components/ui/AppButton.vue'
import AppInput from '../../../components/ui/AppInput.vue'
import AppSelect from '../../../components/ui/AppSelect.vue'
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
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="yd-workbench-pane-header -mx-5 flex flex-wrap items-start justify-between gap-4 px-5 pb-4">
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
          class="yd-workbench-item rounded-sm px-3 py-2 text-left transition-colors"
          :class="root.isActive ? 'yd-workbench-item--active text-yd-text-primary' : 'text-yd-text-secondary'"
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
        <AppSelect v-model="view">
          <option value="mesh">mesh</option>
          <option value="tree">tree</option>
        </AppSelect>
      </label>

      <label class="w-28">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Depth
        </div>
        <AppInput v-model="depth" type="number" placeholder="1" />
      </label>

      <label class="min-w-[14rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Kinds
        </div>
        <AppInput v-model="kinds" placeholder="agent,relay" />
      </label>

      <label class="min-w-[14rem] flex-1">
        <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
          Search
        </div>
        <AppInput v-model="search" placeholder="root / label / metadata" />
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
        <AppSelect v-model="autoRefreshMode">
          <option value="manual">manual</option>
          <option value="visible-polling">visible-polling</option>
        </AppSelect>
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <AppButton @click="handleApply">
          Apply
        </AppButton>
        <AppButton variant="secondary" @click="emit('clearFilters')">
          Clear Filters
        </AppButton>
        <AppButton variant="secondary" @click="emit('focusSelected')">
          Focus Selected
        </AppButton>
        <AppButton variant="secondary" @click="emit('useSelectedAsRoot')">
          Use Selected as Root
        </AppButton>
        <AppButton variant="secondary" @click="emit('refresh')">
          Refresh
        </AppButton>
      </div>
    </div>
  </div>
</template>
