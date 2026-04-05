<script setup lang="ts">
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'

defineProps<{
  title: string
  subtitle: string
  fields: Array<{ label: string; value: string }>
}>()
</script>

<template>
  <div class="yd-workbench-pane flex h-full min-h-[18rem] flex-col rounded-md">
    <WorkspaceSectionHeader :title="title" :subtitle="subtitle" />
    <div v-if="fields.length > 0" class="grid gap-3 px-4 py-4 md:grid-cols-2">
      <div v-for="field in fields" :key="field.label" class="yd-detail-grid-item rounded-sm px-4 py-3">
        <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
          {{ field.label }}
        </div>
        <div class="mt-2 break-all text-yd-text-primary yd-font-mono">
          {{ field.value }}
        </div>
      </div>
    </div>
    <div v-else class="px-4 py-4">
      <WorkspaceEmptyState
        title="No run selected"
        description="Select a scheduler run to inspect partition, worker, lease, and linkage detail."
      />
    </div>
  </div>
</template>
