import { randomUUID } from 'node:crypto';

import type { AppContext } from '../app/context.js';
import { ApiError } from '../utils/api_error.js';
import { adaptPromptBundleToAiMessages } from './adapters/prompt_bundle_adapter.js';
import { createModelGateway, type ModelGateway } from './gateway.js';
import { decodeAiTaskOutput } from './task_decoder.js';
import { resolveAiTaskConfig } from './task_definitions.js';
import type {
  AiPackConfig,
  AiResolvedTaskConfig,
  AiTaskOverride,
  AiTaskRequest,
  AiTaskResult,
  ModelGatewayRequest
} from './types.js';

export interface AiTaskExecutionOptions {
  packAiConfig?: AiPackConfig | null;
  inlineOverride?: AiTaskOverride | null;
}

export interface AiTaskService {
  runTask<TOutput = unknown>(request: AiTaskRequest, options?: AiTaskExecutionOptions): Promise<AiTaskResult<TOutput>>;
}

export interface CreateAiTaskServiceOptions {
  gateway?: ModelGateway;
  context?: AppContext;
}

const buildInlineOverrideFromRequest = (request: AiTaskRequest): AiTaskOverride | null => {
  const hasOutputOverride = request.output_contract?.mode !== undefined || request.output_contract?.json_schema !== undefined;
  if (!hasOutputOverride) {
    return null;
  }

  return {
    output: {
      mode: request.output_contract?.mode,
      schema: request.output_contract?.json_schema
    }
  };
};

const buildGatewayRequest = (
  request: AiTaskRequest,
  messages: ModelGatewayRequest['messages'],
  taskConfig: AiResolvedTaskConfig
): ModelGatewayRequest => {
  return {
    invocation_id: randomUUID(),
    task_id: request.task_id,
    task_type: request.task_type,
    provider_hint: taskConfig.route.provider ?? request.route_hints?.provider ?? null,
    model_hint: taskConfig.route.model ?? request.route_hints?.model ?? null,
    route_id: taskConfig.route.route_id ?? request.route_hints?.route_id ?? null,
    messages,
    response_mode: taskConfig.output.mode,
    structured_output:
      taskConfig.output.mode === 'json_schema' && taskConfig.output.schema
        ? {
            schema_name: `${request.task_type}_schema`,
            json_schema: taskConfig.output.schema,
            strict: taskConfig.output.strict
          }
        : null,
    tools: [],
    tool_policy: { mode: 'disabled' },
    execution: {
      timeout_ms: 30000,
      retry_limit: 0,
      allow_fallback: true,
      idempotency_key: typeof request.metadata?.inference_id === 'string' ? request.metadata.inference_id : null
    },
    governance: {
      privacy_tier: taskConfig.route.privacy_tier,
      audit_level: 'standard',
      safety_profile: null
    },
    metadata: {
      prompt_preset: taskConfig.prompt.preset,
      decoder: taskConfig.parse.decoder,
      task_metadata: taskConfig.metadata ?? null,
      task_input: request.input,
      inference_id: typeof request.metadata?.inference_id === 'string' ? request.metadata.inference_id : null
    }
  };
};

export const createAiTaskService = ({
  gateway,
  context
}: CreateAiTaskServiceOptions = {}): AiTaskService => {
  const resolvedGateway = gateway ?? createModelGateway({ context });

  return {
    async runTask<TOutput = unknown>(request: AiTaskRequest, options?: AiTaskExecutionOptions): Promise<AiTaskResult<TOutput>> {
      const taskConfig = resolveAiTaskConfig({
        taskType: request.task_type,
        packAiConfig: options?.packAiConfig ?? null,
        inlineOverride: options?.inlineOverride ?? buildInlineOverrideFromRequest(request)
      });

      const messages = request.prompt_context.messages
        ?? (request.prompt_context.prompt_bundle
          ? adaptPromptBundleToAiMessages({
              promptBundle: request.prompt_context.prompt_bundle,
              taskConfig
            })
          : null);

      if (!messages || messages.length === 0) {
        throw new ApiError(400, 'AI_TASK_MESSAGES_EMPTY', 'AI task request does not contain messages or prompt bundle content', {
          task_type: request.task_type,
          task_id: request.task_id
        });
      }

      const gatewayRequest = buildGatewayRequest(request, messages, taskConfig);
      const invocation = await resolvedGateway.execute({
        request: gatewayRequest,
        task_request: request,
        task_config: taskConfig
      });

      if (invocation.status !== 'completed') {
        throw new ApiError(500, invocation.error?.code ?? 'AI_TASK_EXECUTION_FAILED', invocation.error?.message ?? 'AI task execution failed', {
          invocation
        });
      }

      const output = decodeAiTaskOutput<TOutput>(invocation, taskConfig);
      return {
        task_id: request.task_id,
        task_type: request.task_type,
        invocation,
        output
      };
    }
  };
};
