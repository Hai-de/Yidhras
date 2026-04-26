import type { AppContext } from '../app/context.js';
import { ApiError } from '../utils/api_error.js';
import { recordAiInvocation } from './observability.js';
import { createMockAiProviderAdapter } from './providers/mock.js';
import { createOpenAiProviderAdapter } from './providers/openai.js';
import type { AiProviderAdapter, AiProviderAdapterResult } from './providers/types.js';
import { getAiProviderConfig } from './registry.js';
import { resolveAiRoute } from './route_resolver.js';
import type { AiAuditLevel, AiInvocationAttemptRecord, AiRegistryConfig, AiResolvedTaskConfig, AiTaskRequest, ModelGatewayRequest, ModelGatewayResponse } from './types.js';

export interface ModelGatewayExecutionInput {
  request: ModelGatewayRequest;
  task_request: AiTaskRequest;
  task_config: AiResolvedTaskConfig;
}

export interface ModelGateway {
  execute(input: ModelGatewayExecutionInput): Promise<ModelGatewayResponse>;
}

export interface CreateModelGatewayOptions {
  adapters?: AiProviderAdapter[];
  context?: AppContext;
  registryConfig?: AiRegistryConfig;
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new ApiError(504, 'AI_PROVIDER_TIMEOUT', 'AI provider request timed out', { timeout_ms: timeoutMs }));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const AUTH_ERROR_CODES = new Set([
  'AI_PROVIDER_AUTH_MISSING',
  'AI_PROVIDER_AUTH_INVALID',
  'AI_PROVIDER_AUTH_EXPIRED'
]);

const normalizeThrownError = (err: unknown): NonNullable<ModelGatewayResponse['error']> => {
  if (err instanceof ApiError) {
    const stage = err.code === 'AI_PROVIDER_TIMEOUT'
      ? 'provider'
      : err.code.startsWith('AI_ROUTE_') || err.code.startsWith('AI_PROVIDER_ADAPTER_')
        ? 'route'
        : 'provider';
    const retryable = err.status >= 500 && !AUTH_ERROR_CODES.has(err.code);

    return {
      code: err.code,
      message: err.message,
      retryable,
      stage
    };
  }

  return {
    code: 'AI_PROVIDER_FAIL',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
    stage: 'provider'
  };
};

const determineAuditLevel = (request: ModelGatewayRequest, fallback?: AiAuditLevel): AiAuditLevel => {
  return request.governance?.audit_level ?? fallback ?? 'standard';
};

const buildAttemptRecord = (
  candidate: { provider: string; model: string },
  status: AiInvocationAttemptRecord['status'],
  finishReason: AiInvocationAttemptRecord['finish_reason'],
  options?: {
    latencyMs?: number | null;
    errorCode?: string | null;
    errorStage?: AiInvocationAttemptRecord['error_stage'];
  }
): AiInvocationAttemptRecord => {
  return {
    provider: candidate.provider,
    model: candidate.model,
    status,
    finish_reason: finishReason,
    latency_ms: typeof options?.latencyMs === 'number' ? options.latencyMs : undefined,
    error_code: options?.errorCode ?? null,
    error_stage: options?.errorStage ?? null
  };
};

const buildFailureResponse = (
  input: ModelGatewayExecutionInput,
  candidate: { provider: string; model: string },
  attemptedModels: string[],
  attempts: AiInvocationAttemptRecord[],
  error: NonNullable<ModelGatewayResponse['error']>,
  auditLevel: AiAuditLevel,
  status: ModelGatewayResponse['status'] = 'failed'
): ModelGatewayResponse => {
  return {
    invocation_id: input.request.invocation_id,
    task_id: input.request.task_id,
    task_type: input.request.task_type,
    provider: candidate.provider,
    model: candidate.model,
    route_id: input.request.route_id ?? null,
    fallback_used: attemptedModels.length > 1,
    attempted_models: attemptedModels,
    status,
    finish_reason: status === 'timeout' ? 'error' : error.stage === 'safety' ? 'safety' : 'error',
    output: {
      mode: input.request.response_mode
    },
    usage: undefined,
    safety: {
      blocked: status === 'blocked',
      reason_code: status === 'blocked' ? error.code : null,
      provider_signal: null
    },
    raw_ref: undefined,
    error,
    trace: {
      task_id: input.request.task_id,
      task_type: input.request.task_type,
      route_id: input.request.route_id ?? null,
      source_inference_id:
        typeof input.task_request.metadata?.inference_id === 'string'
          ? input.task_request.metadata.inference_id
          : null,
      workflow_task_type:
        typeof input.task_request.metadata?.workflow_task_type === 'string'
          ? input.task_request.metadata.workflow_task_type
          : input.task_request.task_type,
      audit_level: auditLevel,
      attempts,
      request: auditLevel === 'full'
        ? {
            request: input.request,
            task_request: input.task_request,
            task_config: input.task_config
          }
        : {
            response_mode: input.request.response_mode,
            message_count: input.request.messages.length
          },
      response: {
        error
      }
    }
  };
};

const finalizeProviderResponse = (
  input: ModelGatewayExecutionInput,
  attemptedModels: string[],
  attempts: AiInvocationAttemptRecord[],
  routeId: string | null,
  candidate: { provider: string; model: string },
  result: AiProviderAdapterResult,
  auditLevel: AiAuditLevel
): ModelGatewayResponse => {
  return {
    invocation_id: input.request.invocation_id,
    task_id: input.request.task_id,
    task_type: input.request.task_type,
    provider: candidate.provider,
    model: candidate.model,
    route_id: routeId,
    fallback_used: attemptedModels.length > 1,
    attempted_models: attemptedModels,
    status: result.status,
    finish_reason: result.finish_reason,
    output: result.output,
    usage: result.usage,
    safety: result.safety,
    raw_ref: result.raw_ref,
    error: result.error ?? null,
    trace: {
      task_id: input.request.task_id,
      task_type: input.request.task_type,
      route_id: routeId,
      source_inference_id:
        typeof input.task_request.metadata?.inference_id === 'string'
          ? input.task_request.metadata.inference_id
          : null,
      workflow_task_type:
        typeof input.task_request.metadata?.workflow_task_type === 'string'
          ? input.task_request.metadata.workflow_task_type
          : input.task_request.task_type,
      audit_level: auditLevel,
      attempts,
      request: auditLevel === 'full'
        ? {
            request: input.request,
            task_request: input.task_request,
            task_config: input.task_config
          }
        : {
            response_mode: input.request.response_mode,
            message_count: input.request.messages.length
          },
      response: auditLevel === 'full'
        ? {
            output: result.output,
            usage: result.usage,
            safety: result.safety,
            raw_ref: result.raw_ref,
            error: result.error ?? null
          }
        : {
            status: result.status,
            finish_reason: result.finish_reason,
            provider: candidate.provider,
            model: candidate.model,
            error_code: result.error?.code ?? null
          }
    }
  };
};

export const createModelGateway = ({
  adapters = [createMockAiProviderAdapter(), createOpenAiProviderAdapter()],
  context,
  registryConfig
}: CreateModelGatewayOptions = {}): ModelGateway => {
  const adapterByProvider = new Map(adapters.map(adapter => [adapter.provider, adapter]));
  const resolvedRegistry = registryConfig ?? null;
  const resolveProviderConfig = (provider: string) => {
    if (resolvedRegistry) {
      return resolvedRegistry.providers.find(entry => entry.provider === provider) ?? null;
    }
    return getAiProviderConfig(provider);
  };

  return {
    async execute(input) {
      const routeSelection = resolveAiRoute({
        task_type: input.task_request.task_type,
        pack_id: input.task_request.pack_id,
        response_mode: input.request.response_mode,
        route_hint: input.task_config.route,
        task_override: input.task_config.override
      }, resolvedRegistry ?? undefined);

      const route = routeSelection.route;
      const allowFallback = input.request.execution?.allow_fallback ?? route.defaults?.allow_fallback ?? true;
      const timeoutMs = input.request.execution?.timeout_ms ?? route.defaults?.timeout_ms ?? 30000;
      const retryLimit = input.request.execution?.retry_limit ?? route.defaults?.retry_limit ?? 0;
      const auditLevel = determineAuditLevel(input.request, route.defaults?.audit_level);
      const candidates = [
        ...routeSelection.primary_model_candidates,
        ...(allowFallback ? routeSelection.fallback_model_candidates : [])
      ];

      let lastFailure: ModelGatewayResponse | null = null;
      const attemptedModels: string[] = [];
      const attempts: AiInvocationAttemptRecord[] = [];

      for (const candidate of candidates) {
        attemptedModels.push(`${candidate.provider}:${candidate.model}`);
        const providerConfig = resolveProviderConfig(candidate.provider);
        if (!providerConfig || !providerConfig.enabled) {
          attempts.push(buildAttemptRecord(candidate, 'failed', 'error', {
            errorCode: 'AI_PROVIDER_NOT_CONFIGURED',
            errorStage: 'route'
          }));
          lastFailure = buildFailureResponse(
            input,
            candidate,
            [...attemptedModels],
            [...attempts],
            {
              code: 'AI_PROVIDER_NOT_CONFIGURED',
              message: `AI provider ${candidate.provider} is not configured or disabled`,
              retryable: false,
              stage: 'route'
            },
            auditLevel
          );
          continue;
        }

        const adapter = adapterByProvider.get(candidate.provider);
        if (!adapter) {
          attempts.push(buildAttemptRecord(candidate, 'failed', 'error', {
            errorCode: 'AI_PROVIDER_ADAPTER_MISSING',
            errorStage: 'route'
          }));
          lastFailure = buildFailureResponse(
            input,
            candidate,
            [...attemptedModels],
            [...attempts],
            {
              code: 'AI_PROVIDER_ADAPTER_MISSING',
              message: `No AI provider adapter registered for ${candidate.provider}`,
              retryable: false,
              stage: 'route'
            },
            auditLevel
          );
          continue;
        }

        for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
          try {
            const startedAt = Date.now();
            const result = await withTimeout(
              adapter.execute({
                request: input.request,
                task_request: input.task_request,
                task_config: input.task_config,
                model_entry: candidate,
                provider_config: providerConfig
              }),
              timeoutMs
            );
            const latencyMs = typeof result.usage?.latency_ms === 'number' ? result.usage.latency_ms : Date.now() - startedAt;
            attempts.push(buildAttemptRecord(candidate, result.status, result.finish_reason, {
              latencyMs,
              errorCode: result.error?.code ?? null,
              errorStage: result.error?.stage ?? null
            }));

            const finalized = finalizeProviderResponse(
              input,
              [...attemptedModels],
              [...attempts],
              route.route_id,
              candidate,
              result,
              auditLevel
            );

            await recordAiInvocation(context, finalized, {
              sourceInferenceId: finalized.trace?.source_inference_id ?? null
            });

            if (finalized.status === 'completed') {
              return finalized;
            }

            lastFailure = finalized;
            if (!finalized.error?.retryable || finalized.status === 'blocked') {
              break;
            }
          } catch (err) {
            const normalizedError = normalizeThrownError(err);
            const status = err instanceof ApiError && err.code === 'AI_PROVIDER_TIMEOUT' ? 'timeout' : 'failed';
            attempts.push(buildAttemptRecord(candidate, status, 'error', {
              errorCode: normalizedError.code,
              errorStage: normalizedError.stage
            }));
            lastFailure = buildFailureResponse(
              input,
              candidate,
              [...attemptedModels],
              [...attempts],
              normalizedError,
              auditLevel,
              status
            );

            await recordAiInvocation(context, lastFailure, {
              sourceInferenceId: lastFailure.trace?.source_inference_id ?? null
            });

            if (!lastFailure.error?.retryable) {
              break;
            }
          }
        }

        if (lastFailure?.status === 'blocked') {
          return lastFailure;
        }
      }

      const finalFailure =
        lastFailure
        ?? buildFailureResponse(
          input,
          {
            provider: input.request.provider_hint ?? 'unknown',
            model: input.request.model_hint ?? 'unknown'
          },
          attemptedModels,
          attempts,
          {
            code: 'AI_ROUTE_NO_CANDIDATE',
            message: 'No AI model candidate could be executed',
            retryable: false,
            stage: 'route'
          },
          auditLevel
        );

      await recordAiInvocation(context, finalFailure, {
        sourceInferenceId: finalFailure.trace?.source_inference_id ?? null
      });

      return finalFailure;
    }
  };
};
