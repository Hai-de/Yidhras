<script setup lang="ts">
import type { AgentSectionField } from '../adapters'

const props = defineProps<{
  title: string
  subtitle: string
  fields: AgentSectionField[]
}>()
</script>

<template>
  <div class="yd-workbench-pane rounded-md px-5 py-4">
    <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
      {{ props.title }}
    </div>
    <div class="mt-2 text-sm text-yd-text-secondary">
      {{ props.subtitle }}
    </div>
    <div class="mt-4 grid gap-3 text-sm text-yd-text-secondary">
      <div
        v-for="field in props.fields"
        :key="field.label"
        class="yd-workbench-inset rounded-sm px-4 py-3"
      >
        <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
          {{ field.label }}
        </div>
        <div class="mt-2 text-yd-text-primary break-all">
          {{ field.value }}
        </div>
      </div>
    </div>
  </div>
</template>
