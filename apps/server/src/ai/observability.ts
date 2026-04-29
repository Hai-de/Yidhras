import { Prisma } from '@prisma/client';

import type { AppInfrastructure } from '../app/context.js';
import { getErrorMessage } from '../app/http/errors.js';
import { createLogger } from '../utils/logger.js';
import type { AiInvocationTrace, ModelGatewayResponse } from './types.js';

const logger = createLogger('ai-observability');

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

const isForeignKeyViolation = (error: unknown): boolean => {
  return error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2003';
};

const buildUpsertPayload = (
  response: ModelGatewayResponse,
  trace: AiInvocationTrace | undefined,
  options: { sourceInferenceId?: string | null } | undefined,
  latencyMs: number | null,
  currentTick: bigint,
  sourceInferenceIdOverride: string | null | undefined = undefined
) => {
  const sourceInferenceId = sourceInferenceIdOverride !== undefined
    ? sourceInferenceIdOverride
    : options?.sourceInferenceId ?? trace?.source_inference_id ?? null;

  const common = {
    task_id: response.task_id,
    task_type: response.task_type,
    source_inference_id: sourceInferenceId,
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
    audit_level: trace?.audit_level ?? 'standard'
  };

  return {
    where: { id: response.invocation_id },
    update: { ...common, completed_at: currentTick },
    create: { ...common, id: response.invocation_id, created_at: currentTick, completed_at: currentTick }
  };
};

export const recordAiInvocation = async (
  context: AppInfrastructure | null | undefined,
  response: ModelGatewayResponse,
  options?: {
    sourceInferenceId?: string | null;
  }
): Promise<void> => {
  if (!context) {
    logger.warn('recordAiInvocation called without context, invocation not persisted', {
      invocation_id: response.invocation_id,
      task_type: response.task_type,
      status: response.status
    });
    return;
  }

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

  const currentTick = context.clock.getCurrentTick();

  try {
    await context.repos.inference.getPrisma().aiInvocationRecord.upsert(
      buildUpsertPayload(response, trace, options, latencyMs, currentTick)
    );
  } catch (error: unknown) {
    if (isForeignKeyViolation(error)) {
      try {
        await context.repos.inference.getPrisma().aiInvocationRecord.upsert(
          buildUpsertPayload(response, trace, options, latencyMs, currentTick, null)
        );
      } catch (innerError: unknown) {
        logger.error('Failed to persist AI invocation record (FK fallback)', {
          error: getErrorMessage(innerError),
          invocation_id: response.invocation_id
        });
      }
    } else {
      logger.error('Failed to persist AI invocation record', {
        error: getErrorMessage(error),
        invocation_id: response.invocation_id
      });
    }
  }
};
