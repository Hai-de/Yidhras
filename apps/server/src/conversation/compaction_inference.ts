/**
 * Dedicated compaction inference path.
 * Bypasses the normal inference pipeline (no conversation_history track, no templates,
 * no slots, no personas, no tool loop). Constructs a minimal summarize prompt and calls
 * the AI Gateway directly.
 *
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.6
 */

import crypto from 'node:crypto';

import type { ModelGateway } from '../ai/gateway.js';
import { buildPromptBundleFromAiMessages } from '../ai/prompt_bundle_from_messages.js';
import type { AiMessage, AiResolvedTaskConfig, AiTaskRequest, ModelGatewayRequest } from '../ai/types.js';
import type { ConversationEntry } from './types.js';

// ── Types ───────────────────────────────────────────────────

export interface CompactionInferenceInput {
  entries: ConversationEntry[];
  agentId: string;
  conversationId: string;
  gateway: ModelGateway;
  taskConfig: AiResolvedTaskConfig;
  model?: string;
}

export interface CompactionInferenceOutput {
  summaryText: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

// ── Prompt Construction ────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a conversation summarizer. Summarize the following conversation turns concisely. ' +
  'Preserve key facts, decisions, and the logical flow. Do not add information not present ' +
  'in the original conversation.';

function buildCompactionMessages(entries: ConversationEntry[]): AiMessage[] {
  const transcript = entries
    .sort((a, b) => a.turn_number - b.turn_number)
    .map((e) => `[${e.speaker_agent_id}]: ${e.current_content}`)
    .join('\n');

  return [
    { role: 'system', parts: [{ type: 'text', text: SYSTEM_PROMPT }] },
    { role: 'user', parts: [{ type: 'text', text: `Summarize the following conversation:\n\n${transcript}` }] }
  ];
}

function buildCompactionRequest(input: {
  entries: ConversationEntry[];
  agentId: string;
  conversationId: string;
  model?: string;
  taskConfig: AiResolvedTaskConfig;
}): ModelGatewayRequest {
  const taskId = `compaction-${input.conversationId}-${Date.now()}`;
  const invocationId = crypto.randomUUID();

  return {
    invocation_id: invocationId,
    task_id: taskId,
    task_type: input.taskConfig.definition.task_type,
    model_hint: input.model ?? null,
    messages: buildCompactionMessages(input.entries),
    response_mode: 'free_text',
    execution: {
      timeout_ms: 60_000,
      retry_limit: 1,
      allow_fallback: true
    },
    metadata: {
      compaction_agent_id: input.agentId,
      compaction_conversation_id: input.conversationId,
      compaction_entry_count: input.entries.length
    }
  };
}

// ── Inference ──────────────────────────────────────────────

export async function runCompactionInference(
  input: CompactionInferenceInput
): Promise<CompactionInferenceOutput> {
  const { entries, agentId, conversationId, gateway, taskConfig, model } = input;

  const request = buildCompactionRequest({ entries, agentId, conversationId, model, taskConfig });

  // Build a minimal AiTaskRequest for the gateway call
  const taskRequest: AiTaskRequest = {
    task_id: request.task_id,
    task_type: request.task_type,
    input: {},
    prompt_context: {
      current_agent_id: agentId,
      prompt_bundle_v2: buildPromptBundleFromAiMessages({
        taskId: request.task_id,
        taskType: request.task_type,
        messages: request.messages
      })
    },
    metadata: {
      prompt_version: null,
      source_prompt_keys: ['compaction']
    }
  };

  const startedAt = Date.now();
  const response = await gateway.execute({ request, task_request: taskRequest, task_config: taskConfig });
  const durationMs = Date.now() - startedAt;

  if (response.status !== 'completed' || !response.output.text) {
    throw new Error(
      `Compaction inference failed: status=${response.status}, error=${response.error?.message ?? 'no output text'}`
    );
  }

  return {
    summaryText: response.output.text,
    model: response.model,
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    durationMs
  };
}
