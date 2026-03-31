<script setup lang="ts">
import { computed } from 'vue'

import type {
  WorkflowIntentDetail,
  WorkflowJobDetail,
  WorkflowSnapshotDetail,
  WorkflowTraceDetail
} from '../../../composables/api/useWorkflowApi'
import { resolveJobStatusTone, resolveWorkflowStateTone, stringifyDebugValue } from '../adapters'

const props = defineProps<{
  job: WorkflowJobDetail | null
  trace: WorkflowTraceDetail | null
  intent: WorkflowIntentDetail | null
  workflow: WorkflowSnapshotDetail | null
  isLoading: boolean
  errorMessage: string | null
  isRetrying: boolean
}>()

const emit = defineEmits<{
  retry: []
}>()

const traceTick = computed(() => {
  const rawTick = props.trace?.trace_metadata?.tick
  return typeof rawTick === 'string' ? rawTick : '—'
})
</script>

<template>
  <div class="flex h-full min-h-[28rem] flex-col gap-4">
    <div class="yd-panel-surface rounded-xl px-5 py-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">
            Selected Workflow
          </div>
          <div class="mt-2 text-sm text-yd-text-secondary">
            {{ props.job?.id ?? props.trace?.id ?? 'Select a job or trace from the URL or list.' }}
          </div>
        </div>
        <button
          type="button"
          class="rounded-lg border border-yd-state-warning/50 bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!props.job || props.job.status !== 'failed' || props.isRetrying"
          @click="emit('retry')"
        >
          {{ props.isRetrying ? 'Retrying…' : 'Retry Job' }}
        </button>
      </div>
      <div v-if="props.errorMessage" class="mt-4 rounded-lg border border-yd-state-danger/40 bg-yd-app px-4 py-3 text-sm text-yd-state-danger">
        {{ props.errorMessage }}
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
      <div class="yd-panel-surface min-h-[18rem] rounded-xl px-5 py-4">
        <div class="flex items-center gap-2">
          <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">Job</div>
          <WorkflowStatusBadge
            v-if="props.job"
            :label="props.job.status"
            :tone="resolveJobStatusTone(props.job.status)"
          />
        </div>
        <div v-if="props.job" class="mt-4 space-y-3 text-sm text-yd-text-secondary">
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Attempts</div>
            <div class="mt-1 text-yd-text-primary">{{ props.job.attempt_count }} / {{ props.job.max_attempts }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Last Error</div>
            <div class="mt-1 text-yd-text-primary">{{ props.job.last_error ?? '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Request Input</div>
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3 text-[11px] text-yd-text-secondary no-scrollbar">{{ stringifyDebugValue(props.job.request_input) }}</pre>
          </div>
        </div>
        <div v-else class="mt-4 text-sm text-yd-text-secondary">No job selected.</div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl px-5 py-4">
        <div class="flex items-center gap-2">
          <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">Workflow Derived</div>
          <WorkflowStatusBadge
            v-if="props.workflow"
            :label="props.workflow.derived.workflow_state"
            :tone="resolveWorkflowStateTone(props.workflow.derived.workflow_state)"
          />
        </div>
        <div v-if="props.workflow" class="mt-4 space-y-3 text-sm text-yd-text-secondary">
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Decision Stage</div>
            <div class="mt-1 text-yd-text-primary">{{ props.workflow.derived.decision_stage }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Dispatch Stage</div>
            <div class="mt-1 text-yd-text-primary">{{ props.workflow.derived.dispatch_stage }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Failure</div>
            <div class="mt-1 text-yd-text-primary">
              {{ props.workflow.derived.failure_code ?? props.workflow.derived.failure_reason ?? '—' }}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Outcome</div>
            <div class="mt-1 text-yd-text-primary">
              {{ props.workflow.derived.outcome_summary.kind }} · {{ props.workflow.derived.outcome_summary.message }}
            </div>
          </div>
        </div>
        <div v-else class="mt-4 text-sm text-yd-text-secondary">No workflow snapshot loaded.</div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl px-5 py-4">
        <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">Trace</div>
        <div v-if="props.trace" class="mt-4 space-y-3 text-sm text-yd-text-secondary">
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Strategy / Provider</div>
            <div class="mt-1 text-yd-text-primary">{{ props.trace.strategy }} · {{ props.trace.provider }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Trace Tick</div>
            <div class="mt-1 text-yd-text-primary yd-font-mono">{{ traceTick }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Decision</div>
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3 text-[11px] text-yd-text-secondary no-scrollbar">{{ stringifyDebugValue(props.trace.decision) }}</pre>
          </div>
        </div>
        <div v-else class="mt-4 text-sm text-yd-text-secondary">No trace loaded.</div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl px-5 py-4">
        <div class="text-[10px] uppercase tracking-[0.22em] text-yd-text-muted yd-font-mono">Intent</div>
        <div v-if="props.intent" class="mt-4 space-y-3 text-sm text-yd-text-secondary">
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Intent Type</div>
            <div class="mt-1 text-yd-text-primary">{{ props.intent.intent_type }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Transmission</div>
            <div class="mt-1 text-yd-text-primary">
              {{ props.intent.transmission_policy }} · drop {{ props.intent.transmission_drop_chance }}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Payload</div>
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3 text-[11px] text-yd-text-secondary no-scrollbar">{{ stringifyDebugValue(props.intent.payload) }}</pre>
          </div>
        </div>
        <div v-else class="mt-4 text-sm text-yd-text-secondary">No intent loaded.</div>
      </div>
    </div>
  </div>
</template>
