<script setup lang="ts">
import { computed } from 'vue'

import type {
  WorkflowIntentDetail,
  WorkflowJobDetail,
  WorkflowSnapshotDetail,
  WorkflowTraceDetail
} from '../../../composables/api/useWorkflowApi'
import WorkspaceEmptyState from '../../shared/components/WorkspaceEmptyState.vue'
import WorkspaceSectionHeader from '../../shared/components/WorkspaceSectionHeader.vue'
import {
  buildWorkflowEntityLinks,
  buildWorkflowFailureSummary,
  buildWorkflowIntentSummaryFields,
  buildWorkflowJobSummaryFields,
  buildWorkflowTraceSummaryFields,
  resolveJobStatusTone,
  resolveWorkflowStateTone,
  stringifyDebugValue,
  toWorkflowRefField
} from '../adapters'

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
  openAgent: [agentId: string]
  openWorkflowIntent: [actionIntentId: string]
  openTrace: [traceId: string]
}>()

const traceTick = computed(() => {
  const rawTick = props.trace?.trace_metadata?.tick
  return typeof rawTick === 'string' ? rawTick : '—'
})

const jobSummaryFields = computed(() => (props.job ? buildWorkflowJobSummaryFields(props.job) : []))
const traceSummaryFields = computed(() => (props.trace ? buildWorkflowTraceSummaryFields(props.trace) : []))
const intentSummaryFields = computed(() => (props.intent ? buildWorkflowIntentSummaryFields(props.intent) : []))
const failureSummaryFields = computed(() =>
  buildWorkflowFailureSummary({
    job: props.job,
    workflowFailureCode: props.workflow?.derived.failure_code ?? null,
    workflowFailureReason: props.workflow?.derived.failure_reason ?? null
  })
)
const relatedLinks = computed(() =>
  buildWorkflowEntityLinks({
    job: props.job,
    trace: props.trace,
    intent: props.intent
  })
)
const actorRefFields = computed(() => {
  return props.intent?.actor_ref
    ? Object.entries(props.intent.actor_ref).map(([key, value]) => toWorkflowRefField(key, value))
    : props.trace?.actor_ref
      ? Object.entries(props.trace.actor_ref).map(([key, value]) => toWorkflowRefField(key, value))
      : []
})
const targetRefFields = computed(() => {
  return props.intent?.target_ref
    ? Object.entries(props.intent.target_ref).map(([key, value]) => toWorkflowRefField(key, value))
    : []
})

const handleOpenLink = (link: (typeof relatedLinks.value)[number]) => {
  if (link.kind === 'agent') {
    emit('openAgent', link.value)
    return
  }

  if (link.kind === 'trace') {
    emit('openTrace', link.value)
    return
  }

  if (link.kind === 'workflow' || link.kind === 'intent') {
    emit('openWorkflowIntent', link.value)
  }
}
</script>

<template>
  <div class="flex h-full min-h-[28rem] flex-col gap-4">
    <div class="yd-panel-surface rounded-xl">
      <WorkspaceSectionHeader
        title="Selected Workflow"
        :subtitle="props.job?.id ?? props.trace?.id ?? 'Select a job or trace from the list to inspect details.'"
      >
        <template #actions>
          <button
            type="button"
            class="rounded-lg border border-yd-state-warning/50 bg-yd-elevated px-4 py-2 text-xs uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!props.job || props.job.status !== 'failed' || props.isRetrying"
            @click="emit('retry')"
          >
            {{ props.isRetrying ? 'Retrying…' : 'Retry Job' }}
          </button>
        </template>
      </WorkspaceSectionHeader>

      <div v-if="props.errorMessage" class="px-5 pb-5">
        <WorkspaceEmptyState title="Workflow detail error" :description="props.errorMessage" />
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
      <div class="yd-panel-surface min-h-[18rem] rounded-xl">
        <WorkspaceSectionHeader title="Job Snapshot" subtitle="Execution status, attempts, timestamps, and failure metadata." />
        <div v-if="props.job" class="space-y-4 px-5 py-5 text-sm text-yd-text-secondary">
          <div class="flex items-center gap-2">
            <WorkflowStatusBadge :label="props.job.status" :tone="resolveJobStatusTone(props.job.status)" />
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <div
              v-for="field in jobSummaryFields"
              :key="field.label"
              class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3"
            >
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
                {{ field.label }}
              </div>
              <div class="mt-2 break-all text-yd-text-primary">
                {{ field.value }}
              </div>
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Request Input</div>
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3 text-[11px] text-yd-text-secondary no-scrollbar">{{ stringifyDebugValue(props.job.request_input) }}</pre>
          </div>
        </div>
        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            :title="props.isLoading ? 'Loading job detail…' : 'No job selected'"
            description="Choose a job from the queue table to inspect attempts, request input, and retry state."
          />
        </div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl">
        <WorkspaceSectionHeader title="Failure / Retry Context" subtitle="Failure code, reason, pending retry timing, and operator response path." />
        <div class="space-y-4 px-5 py-5 text-sm text-yd-text-secondary">
          <div class="grid gap-3 md:grid-cols-2">
            <div
              v-for="field in failureSummaryFields"
              :key="field.label"
              class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3"
            >
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
                {{ field.label }}
              </div>
              <div class="mt-2 break-all text-yd-text-primary">
                {{ field.value }}
              </div>
            </div>
          </div>
          <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4 text-sm leading-6 text-yd-text-secondary">
            {{ props.job?.status === 'failed'
              ? 'This job is currently eligible for retry. Review the failure fields above before requesting another execution attempt.'
              : 'No failed workflow is selected. Retry actions stay disabled until a failed job is focused.' }}
          </div>
        </div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl">
        <WorkspaceSectionHeader title="Workflow Derived State" subtitle="Decision, dispatch, workflow result, and final outcome summary." />
        <div v-if="props.workflow" class="space-y-4 px-5 py-5 text-sm text-yd-text-secondary">
          <div class="flex items-center gap-2">
            <WorkflowStatusBadge
              :label="props.workflow.derived.workflow_state"
              :tone="resolveWorkflowStateTone(props.workflow.derived.workflow_state)"
            />
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3">
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Decision Stage</div>
              <div class="mt-2 text-yd-text-primary">{{ props.workflow.derived.decision_stage }}</div>
            </div>
            <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3">
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Dispatch Stage</div>
              <div class="mt-2 text-yd-text-primary">{{ props.workflow.derived.dispatch_stage }}</div>
            </div>
            <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3 md:col-span-2">
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Outcome</div>
              <div class="mt-2 text-yd-text-primary">
                {{ props.workflow.derived.outcome_summary.kind }} · {{ props.workflow.derived.outcome_summary.message }}
              </div>
            </div>
          </div>
        </div>
        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            :title="props.isLoading ? 'Loading workflow snapshot…' : 'No workflow snapshot loaded'"
            description="The derived workflow state appears once a job or trace selection resolves to a workflow snapshot."
          />
        </div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl">
        <WorkspaceSectionHeader title="Related Entities" subtitle="Cross-entity drill-down for actor, target, intent, and trace records." />
        <div v-if="relatedLinks.length > 0" class="grid gap-3 px-5 py-5">
          <button
            v-for="link in relatedLinks"
            :key="link.id"
            type="button"
            class="rounded-lg border border-yd-border-strong bg-yd-app px-4 py-3 text-left text-sm text-yd-text-primary transition-colors hover:border-yd-state-accent"
            @click="handleOpenLink(link)"
          >
            {{ link.label }} → {{ link.value }}
          </button>
        </div>
        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            title="No related entity links"
            description="Actor, target, trace, or action intent references will appear here when the selected workflow exposes them."
          />
        </div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl">
        <WorkspaceSectionHeader title="Trace Decision" subtitle="Provider, strategy, actor context, and normalized decision payload." />
        <div v-if="props.trace" class="space-y-4 px-5 py-5 text-sm text-yd-text-secondary">
          <div class="grid gap-3 md:grid-cols-2">
            <div
              v-for="field in traceSummaryFields"
              :key="field.label"
              class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3"
            >
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
                {{ field.label }}
              </div>
              <div class="mt-2 break-all text-yd-text-primary">
                {{ field.value }}
              </div>
            </div>
            <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3">
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">trace_tick</div>
              <div class="mt-2 text-yd-text-primary yd-font-mono">{{ traceTick }}</div>
            </div>
          </div>
          <div v-if="actorRefFields.length > 0" class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Actor Ref</div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div v-for="field in actorRefFields" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">{{ field.label }}</div>
                <div class="mt-1 break-all text-yd-text-primary">{{ field.value }}</div>
              </div>
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Decision</div>
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3 text-[11px] text-yd-text-secondary no-scrollbar">{{ stringifyDebugValue(props.trace.decision) }}</pre>
          </div>
        </div>
        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            :title="props.isLoading ? 'Loading trace detail…' : 'No trace loaded'"
            description="Select a job with a resolved inference trace to inspect model strategy, provider, and decision payload."
          />
        </div>
      </div>

      <div class="yd-panel-surface min-h-[18rem] rounded-xl">
        <WorkspaceSectionHeader title="Intent Dispatch" subtitle="Intent scheduling, transmission policy, actor/target refs, and payload." />
        <div v-if="props.intent" class="space-y-4 px-5 py-5 text-sm text-yd-text-secondary">
          <div class="grid gap-3 md:grid-cols-2">
            <div
              v-for="field in intentSummaryFields"
              :key="field.label"
              class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3"
            >
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">
                {{ field.label }}
              </div>
              <div class="mt-2 break-all text-yd-text-primary">
                {{ field.value }}
              </div>
            </div>
            <div class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-3 md:col-span-2">
              <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Transmission</div>
              <div class="mt-2 text-yd-text-primary">
                {{ props.intent.transmission_policy }} · drop {{ props.intent.transmission_drop_chance }}
              </div>
            </div>
          </div>
          <div v-if="actorRefFields.length > 0" class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Actor Ref</div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div v-for="field in actorRefFields" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">{{ field.label }}</div>
                <div class="mt-1 break-all text-yd-text-primary">{{ field.value }}</div>
              </div>
            </div>
          </div>
          <div v-if="targetRefFields.length > 0" class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Target Ref</div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div v-for="field in targetRefFields" :key="field.label">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">{{ field.label }}</div>
                <div class="mt-1 break-all text-yd-text-primary">{{ field.value }}</div>
              </div>
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono">Payload</div>
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-yd-border-muted bg-yd-app px-3 py-3 text-[11px] text-yd-text-secondary no-scrollbar">{{ stringifyDebugValue(props.intent.payload) }}</pre>
          </div>
        </div>
        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            :title="props.isLoading ? 'Loading intent detail…' : 'No intent loaded'"
            description="Intent details appear after a trace resolves to a dispatchable action intent in the workflow projection."
          />
        </div>
      </div>
    </div>
  </div>
</template>
