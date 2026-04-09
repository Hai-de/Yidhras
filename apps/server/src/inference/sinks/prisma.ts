import { Prisma } from '@prisma/client';

import type { AppContext } from '../../app/context.js';
import { toJsonSafe } from '../../app/http/json.js';
import type { InferenceTraceEvent, InferenceTraceSink } from '../trace_sink.js';

const DEFAULT_JOB_MAX_ATTEMPTS = 3;

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(toJsonSafe(value))) as Prisma.InputJsonValue;
};

const parseOptionalTickString = (value: string | null | undefined): bigint | null => {
  if (!value) {
    return null;
  }

  return BigInt(value);
};

const buildContextSnapshot = (event: InferenceTraceEvent): Prisma.InputJsonValue => {
  return toJsonValue({
    inference_id: event.context.inference_id,
    context_module: {
      run_id: event.context.context_run.id,
      created_at_tick: event.context.context_run.created_at_tick,
      source_adapter_names: event.context.context_run.diagnostics.source_adapter_names,
      node_count: event.context.context_run.diagnostics.node_count,
      node_counts_by_type: event.context.context_run.diagnostics.node_counts_by_type,
      selected_node_ids: event.context.context_run.selected_node_ids,
      selected_node_summaries: event.context.context_run.diagnostics.selected_node_summaries ?? [],
      policy_decisions: event.context.context_run.diagnostics.policy_decisions ?? [],
      blocked_nodes: event.context.context_run.diagnostics.blocked_nodes ?? [],
      locked_nodes: event.context.context_run.diagnostics.locked_nodes ?? [],
      visibility_denials: event.context.context_run.diagnostics.visibility_denials ?? [],
      overlay_nodes_loaded: event.context.context_run.diagnostics.overlay_nodes_loaded ?? [],
      submitted_directives: event.context.context_run.diagnostics.submitted_directives ?? [],
      approved_directives: event.context.context_run.diagnostics.approved_directives ?? [],
      denied_directives: event.context.context_run.diagnostics.denied_directives ?? [],
      dropped_nodes: event.context.context_run.diagnostics.dropped_nodes,
      orchestration: event.context.context_run.diagnostics.orchestration ?? null,
      prompt_assembly: event.context.context_run.diagnostics.prompt_assembly ?? null
    },
    context_debug: {
      selected_nodes: event.context.context_run.nodes.map(node => ({
        id: node.id,
        node_type: node.node_type,
        source_kind: node.source_kind,
        preferred_slot: node.placement_policy.preferred_slot,
        visibility_level: node.visibility.level,
        mutability_level: node.mutability.level,
        importance: node.importance,
        salience: node.salience,
        tags: node.tags,
        content_preview: node.content.text.slice(0, 240)
      })),
      policy_decisions: event.context.context_run.diagnostics.policy_decisions ?? [],
      blocked_nodes: event.context.context_run.diagnostics.blocked_nodes ?? [],
      locked_nodes: event.context.context_run.diagnostics.locked_nodes ?? [],
      visibility_denials: event.context.context_run.diagnostics.visibility_denials ?? [],
      overlay_nodes_loaded: event.context.context_run.diagnostics.overlay_nodes_loaded ?? [],
      overlay_nodes_mutated: event.context.context_run.diagnostics.overlay_nodes_mutated ?? [],
      submitted_directives: event.context.context_run.diagnostics.submitted_directives ?? [],
      approved_directives: event.context.context_run.diagnostics.approved_directives ?? [],
      denied_directives: event.context.context_run.diagnostics.denied_directives ?? [],
      dropped_nodes: event.context.context_run.diagnostics.dropped_nodes,
      prompt_assembly: event.context.context_run.diagnostics.prompt_assembly ?? null,
      processing_trace:
        event.prompt.metadata.processing_trace ??
        event.context.memory_context.diagnostics.prompt_processing_trace ??
        null
    },
    actor_ref: event.context.actor_ref,
    context_run: {
      id: event.context.context_run.id,
      created_at_tick: event.context.context_run.created_at_tick,
      selected_node_ids: event.context.context_run.selected_node_ids,
      node_count: event.context.context_run.diagnostics.node_count,
      node_counts_by_type: event.context.context_run.diagnostics.node_counts_by_type,
      source_adapter_names: event.context.context_run.diagnostics.source_adapter_names,
      dropped_nodes: event.context.context_run.diagnostics.dropped_nodes,
      policy_decisions: event.context.context_run.diagnostics.policy_decisions ?? [],
      blocked_nodes: event.context.context_run.diagnostics.blocked_nodes ?? [],
      locked_nodes: event.context.context_run.diagnostics.locked_nodes ?? [],
      visibility_denials: event.context.context_run.diagnostics.visibility_denials ?? [],
      overlay_nodes_loaded: event.context.context_run.diagnostics.overlay_nodes_loaded ?? [],
      submitted_directives: event.context.context_run.diagnostics.submitted_directives ?? [],
      approved_directives: event.context.context_run.diagnostics.approved_directives ?? [],
      denied_directives: event.context.context_run.diagnostics.denied_directives ?? [],
      nodes: event.context.context_run.nodes
    },
    actor_display_name: event.context.actor_display_name,
    identity: event.context.identity,
    binding_ref: event.context.binding_ref,
    resolved_agent_id: event.context.resolved_agent_id,
    agent_snapshot: event.context.agent_snapshot,
    tick: event.context.tick.toString(),
    strategy: event.context.strategy,
    attributes: event.context.attributes,
    world_pack: event.context.world_pack,
    world_prompts: event.context.world_prompts,
    visible_variables: event.context.visible_variables,
    policy_summary: event.context.policy_summary,
    memory_context: event.context.memory_context,
    pack_state: event.context.pack_state,
    pack_runtime: event.context.pack_runtime,
    memory_selection: event.context.memory_context.diagnostics.memory_selection ?? null,
    prompt_processing_trace:
      event.prompt.metadata.processing_trace ??
      event.context.memory_context.diagnostics.prompt_processing_trace ??
      null,
    prompt_assembly: event.context.context_run.diagnostics.prompt_assembly ?? null,
    selected_node_summaries: event.context.context_run.diagnostics.selected_node_summaries ?? [],
    policy_decisions: event.context.context_run.diagnostics.policy_decisions ?? [],
    blocked_nodes: event.context.context_run.diagnostics.blocked_nodes ?? [],
    locked_nodes: event.context.context_run.diagnostics.locked_nodes ?? [],
    visibility_denials: event.context.context_run.diagnostics.visibility_denials ?? [],
    overlay_nodes_loaded: event.context.context_run.diagnostics.overlay_nodes_loaded ?? [],
    overlay_nodes_mutated: event.context.context_run.diagnostics.overlay_nodes_mutated ?? [],
    submitted_directives: event.context.context_run.diagnostics.submitted_directives ?? [],
    approved_directives: event.context.context_run.diagnostics.approved_directives ?? [],
    denied_directives: event.context.context_run.diagnostics.denied_directives ?? [],
    dropped_nodes: event.context.context_run.diagnostics.dropped_nodes,
    semantic_intent: event.semantic_intent ?? null,
    intent_grounding: event.intent_grounding ?? null
  });
};

const resolveJobPayload = (event: InferenceTraceEvent, now: bigint) => {
  const jobStatus = event.job_status ?? 'completed';
  const jobLastError = event.job_last_error ?? null;
  const jobLastErrorCode = event.job_last_error_code ?? null;
  const jobLastErrorStage = event.job_last_error_stage ?? null;
  const completedAt = jobStatus === 'completed' ? now : null;
  const idempotencyKey =
    typeof event.input.idempotency_key === 'string' && event.input.idempotency_key.trim().length > 0
      ? event.input.idempotency_key.trim()
      : null;
  const attemptCount = event.job_attempt_count ?? 1;
  const maxAttempts = event.job_max_attempts ?? DEFAULT_JOB_MAX_ATTEMPTS;

  return {
    jobStatus,
    jobLastError,
    jobLastErrorCode,
    jobLastErrorStage,
    completedAt,
    idempotencyKey,
    attemptCount,
    maxAttempts
  };
};

export const createPrismaInferenceTraceSink = (context: AppContext): InferenceTraceSink => {
  return {
    async record(event) {
      const now = event.context.tick;
      const scheduledAfterTicks = parseOptionalTickString(event.action_intent_draft?.scheduled_after_ticks);
      const transmissionDelayTicks = parseOptionalTickString(event.action_intent_draft?.transmission_delay_ticks);
      const scheduledForTick =
        scheduledAfterTicks === null ? null : event.context.tick + scheduledAfterTicks;
      const { jobStatus, jobLastError, jobLastErrorCode, jobLastErrorStage, completedAt, idempotencyKey, attemptCount, maxAttempts } =
        resolveJobPayload(event, now);

      await context.prisma.$transaction(async prisma => {
        await prisma.inferenceTrace.upsert({
          where: {
            id: event.inference_id
          },
          update: {
            kind: event.kind,
            strategy: event.strategy,
            provider: event.provider,
            actor_ref: toJsonValue(event.actor_ref),
            input: toJsonValue(event.input),
            context_snapshot: buildContextSnapshot(event),
            prompt_bundle: toJsonValue(event.prompt),
            trace_metadata: toJsonValue({
              ai_invocation_id: event.ai_invocation_id ?? null,
              ...event.trace_metadata,
              semantic_intent: event.semantic_intent ?? null,
              intent_grounding: event.intent_grounding ?? null
            }),
            decision: event.decision ? toJsonValue(event.decision) : undefined,
            updated_at: now
          },
          create: {
            id: event.inference_id,
            kind: event.kind,
            strategy: event.strategy,
            provider: event.provider,
            actor_ref: toJsonValue(event.actor_ref),
            input: toJsonValue(event.input),
            context_snapshot: buildContextSnapshot(event),
            prompt_bundle: toJsonValue(event.prompt),
            trace_metadata: toJsonValue({
              ai_invocation_id: event.ai_invocation_id ?? null,
              ...event.trace_metadata,
              semantic_intent: event.semantic_intent ?? null,
              intent_grounding: event.intent_grounding ?? null
            }),
            decision: event.decision ? toJsonValue(event.decision) : undefined,
            created_at: now,
            updated_at: now
          }
        });

        let actionIntentId: string | null = null;

        if (event.action_intent_draft) {
          const actionIntent = await prisma.actionIntent.upsert({
            where: {
              source_inference_id: event.inference_id
            },
            update: {
              intent_type: event.action_intent_draft.intent_type,
              actor_ref: toJsonValue(event.action_intent_draft.actor_ref),
              target_ref: event.action_intent_draft.target_ref
                ? toJsonValue(event.action_intent_draft.target_ref)
                : Prisma.DbNull,
              payload: toJsonValue(event.action_intent_draft.payload),
              scheduled_after_ticks: scheduledAfterTicks,
              scheduled_for_tick: scheduledForTick,
              transmission_delay_ticks: transmissionDelayTicks,
              transmission_policy: event.action_intent_draft.transmission_policy,
              transmission_drop_chance: event.action_intent_draft.transmission_drop_chance,
              drop_reason: event.action_intent_draft.drop_reason,
              status: 'pending',
              updated_at: now
            },
            create: {
              source_inference_id: event.inference_id,
              intent_type: event.action_intent_draft.intent_type,
              actor_ref: toJsonValue(event.action_intent_draft.actor_ref),
              target_ref: event.action_intent_draft.target_ref
                ? toJsonValue(event.action_intent_draft.target_ref)
                : Prisma.DbNull,
              payload: toJsonValue(event.action_intent_draft.payload),
              scheduled_after_ticks: scheduledAfterTicks,
              scheduled_for_tick: scheduledForTick,
              transmission_delay_ticks: transmissionDelayTicks,
              transmission_policy: event.action_intent_draft.transmission_policy,
              transmission_drop_chance: event.action_intent_draft.transmission_drop_chance,
              drop_reason: event.action_intent_draft.drop_reason,
              status: 'pending',
              created_at: now,
              updated_at: now
            }
          });

          actionIntentId = actionIntent.id;
        }

        if (event.kind !== 'run') {
          return;
        }

        if (event.job_id) {
          await prisma.decisionJob.update({
            where: {
              id: event.job_id
            },
            data: {
              source_inference_id: event.inference_id,
              pending_source_key: null,
              action_intent_id: actionIntentId,
              job_type: 'inference_run',
              status: jobStatus,
              idempotency_key: idempotencyKey,
              attempt_count: attemptCount,
              max_attempts: maxAttempts,
              last_error: jobLastError,
              last_error_code: jobLastErrorCode,
              last_error_stage: jobLastErrorStage,
              updated_at: now,
              completed_at: completedAt
            }
          });
          return;
        }

        await prisma.decisionJob.upsert({
          where: {
            source_inference_id: event.inference_id
          },
          update: {
            action_intent_id: actionIntentId,
            job_type: 'inference_run',
            status: jobStatus,
            idempotency_key: idempotencyKey,
            attempt_count: attemptCount,
            max_attempts: maxAttempts,
            last_error: jobLastError,
            last_error_code: jobLastErrorCode,
            last_error_stage: jobLastErrorStage,
            updated_at: now,
            completed_at: completedAt
          },
          create: {
            source_inference_id: event.inference_id,
            pending_source_key: null,
            action_intent_id: actionIntentId,
            job_type: 'inference_run',
            status: jobStatus,
            idempotency_key: idempotencyKey,
            attempt_count: attemptCount,
            max_attempts: maxAttempts,
            last_error: jobLastError,
            last_error_code: jobLastErrorCode,
            last_error_stage: jobLastErrorStage,
            created_at: now,
            updated_at: now,
            completed_at: completedAt
          }
        });
      });
    }
  };
};
