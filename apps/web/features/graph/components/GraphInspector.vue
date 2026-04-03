<script setup lang="ts">
import AppButton from '../../../components/ui/AppButton.vue'
import AppPanel from '../../../components/ui/AppPanel.vue'
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
    <AppPanel surface="pane">
      <WorkspaceSectionHeader
        title="Projection Summary"
        subtitle="Current graph read model counts, applied filters, and projection metadata."
      />
      <div class="grid gap-3 px-5 py-5 text-sm text-yd-text-secondary">
        <div
          v-for="field in props.summaryFields"
          :key="field.label"
          class="yd-detail-grid-item rounded-sm px-4 py-3"
        >
          <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
            {{ field.label }}
          </div>
          <div class="mt-2 break-all text-yd-text-primary">
            {{ field.value }}
          </div>
        </div>
      </div>
    </AppPanel>

    <AppPanel surface="pane" class="min-h-0 flex-1">
      <WorkspaceSectionHeader
        title="Node Inspector"
        subtitle="Inspect node fields, references, metadata, and continue into related workspaces."
      />

      <div v-if="props.inspector" class="min-h-0 space-y-4 overflow-auto px-5 py-5 no-scrollbar">
        <div>
          <div class="text-lg font-semibold text-yd-text-primary">
            {{ props.inspector.title }}
          </div>
          <div class="mt-2 text-sm leading-6 text-yd-text-secondary">
            {{ props.inspector.subtitle }}
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <AppButton
            v-for="action in props.inspector.actions"
            :key="action.id"
            kind="plain"
            :variant="action.disabled ? 'secondary' : 'primary'"
            class="justify-start text-left"
            :class="action.disabled ? 'opacity-50' : ''"
            :disabled="action.disabled"
            @click="action.id === 'agent' ? emit('openAgent') : emit('openWorkflow')"
          >
            <span class="flex flex-col items-start gap-2">
              <span class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                {{ action.label }}
              </span>
              <span class="text-sm leading-5 text-current">
                {{ action.helper }}
              </span>
            </span>
          </AppButton>
        </div>

        <div class="grid gap-3">
          <div
            v-for="section in props.inspector.sections"
            :key="section.id"
            class="yd-inspector-section rounded-sm px-4 py-4"
          >
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
              {{ section.title }}
            </div>
            <div class="mt-2 text-sm leading-6 text-yd-text-secondary">
              {{ section.subtitle }}
            </div>
            <div v-if="section.fields.length > 0" class="mt-3 grid gap-3 text-sm text-yd-text-secondary">
              <div v-for="field in section.fields" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
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
    </AppPanel>
  </div>
</template>
