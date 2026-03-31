<script setup lang="ts">
import type { GraphInspectorField, GraphInspectorViewModel } from '../adapters'

const props = defineProps<{
  inspector: GraphInspectorViewModel | null
  summaryFields: GraphInspectorField[]
}>()
</script>

<template>
  <div class="flex h-full min-h-[24rem] flex-col gap-4">
    <div class="yd-panel-surface rounded-xl px-5 py-4">
      <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        Projection Summary
      </div>
      <div class="mt-4 grid gap-3 text-sm text-yd-text-secondary">
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

    <div class="yd-panel-surface min-h-0 flex-1 rounded-xl px-5 py-4">
      <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
        Node Inspector
      </div>

      <div v-if="props.inspector" class="mt-4 min-h-0 space-y-4 overflow-auto no-scrollbar">
        <div>
          <div class="text-lg font-semibold text-yd-text-primary">
            {{ props.inspector.title }}
          </div>
          <div class="mt-2 text-sm text-yd-text-secondary">
            {{ props.inspector.subtitle }}
          </div>
        </div>

        <div class="grid gap-3">
          <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Fields
            </div>
            <div class="mt-3 grid gap-3 text-sm text-yd-text-secondary">
              <div v-for="field in props.inspector.fields" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                  {{ field.label }}
                </div>
                <div class="mt-1 text-yd-text-primary">
                  {{ field.value }}
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Refs
            </div>
            <div v-if="props.inspector.refs.length > 0" class="mt-3 grid gap-3 text-sm text-yd-text-secondary">
              <div v-for="field in props.inspector.refs" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                  {{ field.label }}
                </div>
                <div class="mt-1 text-yd-text-primary">
                  {{ field.value }}
                </div>
              </div>
            </div>
            <div v-else class="mt-3 text-sm text-yd-text-secondary">
              No refs available.
            </div>
          </div>

          <div class="rounded-xl border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
              Metadata
            </div>
            <div v-if="props.inspector.metadata.length > 0" class="mt-3 grid gap-3 text-sm text-yd-text-secondary">
              <div v-for="field in props.inspector.metadata" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                  {{ field.label }}
                </div>
                <div class="mt-1 text-yd-text-primary break-all">
                  {{ field.value }}
                </div>
              </div>
            </div>
            <div v-else class="mt-3 text-sm text-yd-text-secondary">
              No metadata available.
            </div>
          </div>
        </div>
      </div>

      <div v-else class="mt-4 rounded-xl border border-dashed border-yd-border-muted bg-yd-app px-4 py-6 text-sm text-yd-text-secondary">
        Select a node from the graph canvas to inspect refs, metadata, and graph semantics.
      </div>
    </div>
  </div>
</template>
