<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import type { GraphInspectorField, GraphInspectorViewModel } from '../adapters'

const props = defineProps<{
  inspector: GraphInspectorViewModel | null
  summaryFields: GraphInspectorField[]
}>()

const emit = defineEmits<{
  openAgent: []
  openWorkflow: []
}>()
</script>

<template>
  <div class="flex h-full min-h-[24rem] flex-col gap-4">
    <div class="yd-panel-surface rounded-xl">
      <WorkspaceSectionHeader
        title="Projection Summary"
        subtitle="Current graph read model counts, applied filters, and projection metadata."
      />
      <div class="grid gap-3 px-5 py-5 text-sm text-yd-text-secondary">
        <div
          v-for="field in props.summaryFields"
          :key="field.label"
          class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3"
        >
          <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
            {{ field.label }}
          </div>
          <div class="mt-2 text-yd-text-primary">
            {{ field.value }}
          </div>
        </div>
      </div>
    </div>

    <div class="yd-panel-surface min-h-0 flex-1 rounded-xl">
      <WorkspaceSectionHeader
        title="Node Inspector"
        subtitle="Inspect node fields, references, metadata, and continue into related workspaces."
      />

      <div v-if="props.inspector" class="min-h-0 space-y-4 overflow-auto px-5 py-5 no-scrollbar">
        <div>
          <div class="text-lg font-semibold text-yd-text-primary">
            {{ props.inspector.title }}
          </div>
          <div class="mt-2 text-sm text-yd-text-secondary">
            {{ props.inspector.subtitle }}
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <button
            v-for="action in props.inspector.actions"
            :key="action.id"
            type="button"
            class="rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
            :class="action.disabled ? 'border-yd-border-muted bg-yd-app text-yd-text-secondary' : 'border-yd-border-strong bg-yd-elevated text-yd-text-primary'"
            :disabled="action.disabled"
            @click="action.id === 'agent' ? emit('openAgent') : emit('openWorkflow')"
          >
            <div class="text-xs uppercase tracking-[0.16em] yd-font-mono">
              {{ action.label }}
            </div>
            <div class="mt-2 text-sm leading-5">
              {{ action.helper }}
            </div>
          </button>
        </div>

        <div class="grid gap-3">
          <div
            v-for="section in props.inspector.sections"
            :key="section.id"
            class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4"
          >
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              {{ section.title }}
            </div>
            <div class="mt-2 text-sm text-yd-text-secondary">
              {{ section.subtitle }}
            </div>
            <div v-if="section.fields.length > 0" class="mt-3 grid gap-3 text-sm text-yd-text-secondary">
              <div v-for="field in section.fields" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                  {{ field.label }}
                </div>
                <div class="mt-1 break-all text-yd-text-primary">
                  {{ field.value }}
                </div>
              </div>
            </div>
            <div v-else class="mt-3 text-sm text-yd-text-secondary">
              {{ section.emptyMessage }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="px-5 py-5">
        <WorkspaceEmptyState
          title="No node selected"
          description="Select a node from the graph canvas to inspect refs, metadata, and graph semantics."
        />
      </div>
    </div>
  </div>
</template>
