import { ApiError } from '../../utils/api_error.js';
import { createOpenAiCompatibleAdapter } from './openai_compatible.js';
import { encodeMessageText, getEnv, isRecord, mapMessageRole } from './shared.js';
import type { AiProviderAdapter, AiProviderAdapterRequest, AiProviderAdapterResult } from './types.js';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// ── OpenAI 特有的认证逻辑 ──────────────────────────────────────────────

const buildOpenAiHeaders = (input: AiProviderAdapterRequest): Record<string, string> => {
  const headers: Record<string, string> = {
    ...input.provider_config.default_headers
  };

  const organization = getEnv(input.provider_config.organization_env);
  if (organization) {
    headers['OpenAI-Organization'] = organization;
  }

  const project = getEnv(input.provider_config.project_env);
  if (project) {
    headers['OpenAI-Project'] = project;
  }

  return headers;
};

// ── Responses API ──────────────────────────────────────────────────────

const buildResponsesInput = (messages: import('../types.js').AiMessage[]) => {
  return messages.map(message => ({
    role: mapMessageRole(message.role),
    content: message.parts.map(part => {
      switch (part.type) {
        case 'text':
          return { type: 'input_text' as const, text: part.text };
        case 'json':
          return { type: 'input_text' as const, text: JSON.stringify(part.json, null, 2) };
        case 'image_url':
          return { type: 'input_image' as const, image_url: part.url };
        case 'file_ref':
          return { type: 'input_file' as const, file_id: part.file_id };
        default:
          return { type: 'input_text' as const, text: '' };
      }
    })
  }));
};

const buildResponsesToolChoice = (mode: 'disabled' | 'allowed' | 'required' | undefined) => {
  if (mode === 'required') {
    return 'required';
  }
  if (mode === 'disabled') {
    return 'none';
  }
  return undefined;
};

const buildResponsesFormat = (input: AiProviderAdapterRequest) => {
  switch (input.request.response_mode) {
    case 'json_schema':
      if (!input.request.structured_output) {
        return undefined;
      }
      return {
        format: {
          type: 'json_schema' as const,
          name: input.request.structured_output.schema_name,
          schema: input.request.structured_output.json_schema,
          strict: input.request.structured_output.strict ?? false
        }
      };
    case 'json_object':
      return {
        format: {
          type: 'json_object' as const
        }
      };
    default:
      return undefined;
  }
};

const extractResponsesOutputText = (payload: Record<string, unknown>): string => {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type !== 'message') {
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
};

const extractResponsesToolCalls = (payload: Record<string, unknown>): NonNullable<import('../types.js').ModelGatewayResponse['output']['tool_calls']> => {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const calls: NonNullable<import('../types.js').ModelGatewayResponse['output']['tool_calls']> = [];

  for (const item of output) {
    if (!isRecord(item) || item.type !== 'function_call') {
      continue;
    }
    const argumentsText = typeof item.arguments === 'string' ? item.arguments : '{}';
    let parsedArguments: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(argumentsText) as unknown;
      if (isRecord(parsed)) {
        parsedArguments = parsed;
      }
    } catch {
      parsedArguments = {};
    }

    calls.push({
      name: typeof item.name === 'string' ? item.name : 'unknown_tool',
      arguments: parsedArguments,
      call_id: typeof item.call_id === 'string' ? item.call_id : undefined
    });
  }

  return calls;
};

const normalizeResponsesFinishReason = (
  finishReason: unknown,
  hasToolCalls: boolean,
  isBlocked: boolean
): AiProviderAdapterResult['finish_reason'] => {
  if (hasToolCalls) {
    return 'tool_call';
  }

  if (isBlocked) {
    return 'safety';
  }

  if (finishReason === 'length' || finishReason === 'max_output_tokens') {
    return 'length';
  }

  return 'stop';
};

const normalizeResponsesApiResponse = (payload: Record<string, unknown>, response: Response): AiProviderAdapterResult => {
  const toolCalls = extractResponsesToolCalls(payload);
  const text = extractResponsesOutputText(payload);
  const usageRecord = isRecord(payload.usage) ? payload.usage : null;
  const incompleteDetails = isRecord(payload.incomplete_details) ? payload.incomplete_details : null;
  const incompleteReason = typeof incompleteDetails?.reason === 'string' ? incompleteDetails.reason : null;
  const blocked = incompleteReason === 'content_filter' || incompleteReason === 'safety';
  const status = blocked ? 'blocked' : 'completed';

  return {
    status,
    finish_reason: normalizeResponsesFinishReason(incompleteReason, toolCalls.length > 0, blocked),
    output: {
      mode: toolCalls.length > 0 ? 'tool_call' : text.trim().startsWith('{') ? 'json_schema' : 'free_text',
      text: text.length > 0 ? text : undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    },
    usage: {
      input_tokens: typeof usageRecord?.input_tokens === 'number' ? usageRecord.input_tokens : undefined,
      output_tokens: typeof usageRecord?.output_tokens === 'number' ? usageRecord.output_tokens : undefined,
      total_tokens: typeof usageRecord?.total_tokens === 'number' ? usageRecord.total_tokens : undefined,
      cached_input_tokens:
        isRecord(usageRecord?.input_tokens_details) && typeof usageRecord.input_tokens_details.cached_tokens === 'number'
          ? usageRecord.input_tokens_details.cached_tokens
          : undefined
    },
    safety: {
      blocked,
      reason_code: blocked ? incompleteReason : null,
      provider_signal: incompleteDetails ?? null
    },
    raw_ref: {
      provider_request_id: response.headers.get('x-request-id'),
      provider_response_id: typeof payload.id === 'string' ? payload.id : null
    },
    error: blocked
      ? {
          code: 'AI_PROVIDER_SAFETY_BLOCK',
          message: 'OpenAI response was blocked by safety policy',
          retryable: false,
          stage: 'safety'
        }
      : null
  };
};

// ── Embeddings ─────────────────────────────────────────────────────────

const buildEmbeddingsRequestBody = (input: AiProviderAdapterRequest) => {
  const textInput = input.request.messages.map(message => encodeMessageText(message)).filter(text => text.trim().length > 0).join('\n\n');
  return {
    model: input.model_entry.model,
    input: textInput
  };
};

const normalizeEmbeddingsResponse = (payload: Record<string, unknown>, response: Response): AiProviderAdapterResult => {
  const data = Array.isArray(payload.data) ? payload.data : [];
  const first: unknown = data.find(item => isRecord(item) && Array.isArray(item.embedding));
  const embedding = first && isRecord(first) ? first.embedding : null;
  if (!Array.isArray(embedding) || !embedding.every(value => typeof value === 'number')) {
    throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'OpenAI embeddings response is missing embedding vector');
  }

  const usageRecord = isRecord(payload.usage) ? payload.usage : null;
  return {
    status: 'completed',
    finish_reason: 'stop',
    output: {
      mode: 'embedding',
      embedding
    },
    usage: {
      input_tokens: typeof usageRecord?.prompt_tokens === 'number' ? usageRecord.prompt_tokens : undefined,
      total_tokens: typeof usageRecord?.total_tokens === 'number' ? usageRecord.total_tokens : undefined
    },
    safety: {
      blocked: false,
      reason_code: null,
      provider_signal: null
    },
    raw_ref: {
      provider_request_id: response.headers.get('x-request-id'),
      provider_response_id: typeof payload.id === 'string' ? payload.id : null
    },
    error: null
  };
};

// ── OpenAI 特有的 endpoint 调度 ────────────────────────────────────────

const buildResponsesRequestBody = (input: AiProviderAdapterRequest) => {
  const body: Record<string, unknown> = {
    model: input.model_entry.model,
    input: buildResponsesInput(input.request.messages)
  };

  if (typeof input.request.sampling?.temperature === 'number') {
    body.temperature = input.request.sampling.temperature;
  }
  if (typeof input.request.sampling?.top_p === 'number') {
    body.top_p = input.request.sampling.top_p;
  }
  if (typeof input.request.sampling?.max_output_tokens === 'number') {
    body.max_output_tokens = input.request.sampling.max_output_tokens;
  }
  if (typeof input.request.sampling?.seed === 'number') {
    body.seed = input.request.sampling.seed;
  }

  const text = buildResponsesFormat(input);
  if (text) {
    body.text = text;
  }

  const tools = buildResponsesTools(input.request.tools);
  if (tools) {
    body.tools = tools;
    const toolChoice = buildResponsesToolChoice(input.request.tool_policy?.mode);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  return body;
};

const buildResponsesTools = (tools: import('../types.js').AiToolSpec[] | undefined) => {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  return tools.map(tool => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: tool.strict ?? false
  }));
};

const parseErrorPayload = async (response: Response): Promise<{ code: string; message: string }> => {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && isRecord(payload.error)) {
      const code = typeof payload.error.code === 'string' ? payload.error.code : 'AI_PROVIDER_FAIL';
      const message = typeof payload.error.message === 'string' ? payload.error.message : `OpenAI request failed with ${String(response.status)}`;
      return { code, message };
    }
  } catch {
    // ignore parse failure
  }

  return {
    code: 'AI_PROVIDER_FAIL',
    message: `OpenAI request failed with HTTP ${String(response.status)}`
  };
};

const performOpenAiRequest = async (input: AiProviderAdapterRequest): Promise<Response> => {
  const baseUrl = input.model_entry.base_url ?? input.provider_config.base_url ?? OPENAI_BASE_URL;
  const endpoint = input.model_entry.endpoint_kind === 'embeddings'
    ? '/embeddings'
    : input.model_entry.endpoint_kind === 'chat_completions'
      ? '/chat/completions'
      : '/responses';

  const body = input.model_entry.endpoint_kind === 'embeddings'
    ? buildEmbeddingsRequestBody(input)
    : input.model_entry.endpoint_kind === 'chat_completions'
      ? null  // Chat Completions 委托给 openai_compatible
      : buildResponsesRequestBody(input);

  // Chat Completions 路径不再通过此函数
  if (body === null) {
    throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'Chat Completions should be delegated to openai_compatible adapter');
  }

  return fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- env var required for auth
      Authorization: `Bearer ${getEnv(input.provider_config.api_key_env)!}`,
      'Content-Type': 'application/json',
      ...buildOpenAiHeaders(input)
    },
    body: JSON.stringify(body)
  });
};

// ── Rate limit hints ───────────────────────────────────────────────────

const extractOpenAiRateLimitHints = (response: Response): import('../elasticity/types.js').RateLimitHints => {
  const hints: import('../elasticity/types.js').RateLimitHints = {};

  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      hints.retryAfterSeconds = seconds;
    }
  }

  const remaining = response.headers.get('x-ratelimit-remaining');
  if (remaining) {
    const n = Number(remaining);
    if (Number.isFinite(n)) {
      hints.remainingQuota = n;
    }
  }

  const limit = response.headers.get('x-ratelimit-limit');
  if (limit) {
    const n = Number(limit);
    if (Number.isFinite(n)) {
      hints.limitQuota = n;
    }
  }

  return hints;
};

// ── Chat Completions 委托 adapter ─────────────────────────────────────

const openAiChatCompletionsAdapter = createOpenAiCompatibleAdapter({
  provider: 'openai',
  resolveApiKey(input) {
    return getEnv(input.provider_config.api_key_env);
  },
  resolveBaseUrl(input) {
    return input.model_entry.base_url ?? input.provider_config.base_url ?? OPENAI_BASE_URL;
  },
  buildHeaders: buildOpenAiHeaders
});

// ── 主 adapter ─────────────────────────────────────────────────────────

export const createOpenAiProviderAdapter = (): AiProviderAdapter => {
  return {
    provider: 'openai',
    async execute(input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
      if (!getEnv(input.provider_config.api_key_env)) {
        return {
          status: 'failed',
          finish_reason: 'error',
          output: { mode: input.request.response_mode },
          usage: undefined,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: undefined,
          error: {
            code: 'AI_PROVIDER_AUTH_MISSING',
            message: 'OpenAI API key is not configured',
            retryable: false,
            stage: 'provider'
          }
        };
      }

      // Chat Completions → 委托给通用 adapter
      if (input.model_entry.endpoint_kind === 'chat_completions') {
        return openAiChatCompletionsAdapter.execute(input);
      }

      // Responses API / Embeddings → OpenAI 特有路径
      const response = await performOpenAiRequest(input);
      if (!response.ok) {
        const { code, message } = await parseErrorPayload(response);
        const rateLimitHints = response.status === 429
          ? extractOpenAiRateLimitHints(response)
          : undefined;
        return {
          status: 'failed',
          finish_reason: 'error',
          output: { mode: input.request.response_mode },
          usage: undefined,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: {
            provider_request_id: response.headers.get('x-request-id'),
            provider_response_id: null
          },
          error: {
            code,
            message,
            retryable: response.status >= 500 || response.status === 429,
            stage: 'provider'
          },
          rate_limit_hints: rateLimitHints
        };
      }

      const payload = (await response.json()) as unknown;
      if (!isRecord(payload)) {
        throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'OpenAI response payload is not an object');
      }

      if (input.model_entry.endpoint_kind === 'embeddings') {
        return normalizeEmbeddingsResponse(payload, response);
      }

      return normalizeResponsesApiResponse(payload, response);
    },

    async *executeStream(input, signal) {
      // Chat Completions → 委托给通用 adapter 的流式实现
      if (input.model_entry.endpoint_kind === 'chat_completions') {
        if (openAiChatCompletionsAdapter.executeStream) {
          yield* openAiChatCompletionsAdapter.executeStream(input, signal);
        } else {
          yield { type: 'error', code: 'STREAM_NOT_SUPPORTED', message: 'OpenAI Chat Completions streaming not available' };
        }
        return;
      }
      // Responses API / Embeddings 暂不支持流式
      yield { type: 'error', code: 'STREAM_NOT_SUPPORTED', message: 'OpenAI Responses API and Embeddings do not support streaming' };
    }
  };
};
