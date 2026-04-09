import { Prisma } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import type { AiInvocationTrace, ModelGatewayResponse } from './types.js';

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const toRequestJson = (trace: AiInvocationTrace | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull => {
  if (!trace?.request) {
    return Prisma.JsonNull;
  }

  return toJsonValue(trace.request);
};

const toResponseJson = (trace: AiInvocationTrace | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull => {
  if (!trace?.response) {
    return Prisma.JsonNull;
  }

  return toJsonValue(trace.response);
};

const toOptionalJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull => {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }

  return toJsonValue(value);
};

export const recordAiInvocation = async (
  context: AppContext,
  response: ModelGatewayResponse,
  options?: {
    sourceInferenceId?: string | null;
  }
): Promise<void> => {
  const trace = response.trace;
  const attemptLatencies = Array.isArray(trace?.attempts)
    ? trace.attempts
        .map(attempt => (typeof attempt.latency_ms === 'number' && Number.isFinite(attempt.latency_ms) ? attempt.latency_ms : null))
        .filter((value): value is number => value !== null)
    : [];

  const latencyMs = typeof response.usage?.latency_ms === 'number'
    ? response.usage.latency_ms
    : attemptLatencies.length > 0
      ? attemptLatencies.reduce((sum, value) => sum + value, 0)
      : null;

  await context.prisma.aiInvocationRecord.upsert({
    where: {
      id: response.invocation_id
    },
    update: {
      task_id: response.task_id,
      task_type: response.task_type,
      source_inference_id: options?.sourceInferenceId ?? trace?.source_inference_id ?? null,
      provider: response.provider,
      model: response.model,
      route_id: response.route_id,
      status: response.status,
      finish_reason: response.finish_reason,
      attempted_models_json: toJsonValue(response.attempted_models),
      fallback_used: response.fallback_used,
      latency_ms: latencyMs,
      usage_json: toOptionalJson(response.usage ?? null),
      safety_json: toOptionalJson(response.safety ?? null),
      request_json: toRequestJson(trace),
      response_json: toResponseJson(trace),
      error_code: response.error?.code ?? null,
      error_message: response.error?.message ?? null,
      error_stage: response.error?.stage ?? null,
      audit_level: trace?.audit_level ?? 'standard',
      completed_at: context.sim.getCurrentTick()
    },
    create: {
      id: response.invocation_id,
      task_id: response.task_id,
      task_type: response.task_type,
      source_inference_id: options?.sourceInferenceId ?? trace?.source_inference_id ?? null,
      provider: response.provider,
      model: response.model,
      route_id: response.route_id,
      status: response.status,
      finish_reason: response.finish_reason,
      attempted_models_json: toJsonValue(response.attempted_models),
      fallback_used: response.fallback_used,
      latency_ms: latencyMs,
      usage_json: toOptionalJson(response.usage ?? null),
      safety_json: toOptionalJson(response.safety ?? null),
      request_json: toRequestJson(trace),
      response_json: toResponseJson(trace),
      error_code: response.error?.code ?? null,
      error_message: response.error?.message ?? null,
      error_stage: response.error?.stage ?? null,
      audit_level: trace?.audit_level ?? 'standard',
      created_at: context.sim.getCurrentTick(),
      completed_at: context.sim.getCurrentTick()
    }
  });
};
