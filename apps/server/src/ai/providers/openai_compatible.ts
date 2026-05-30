import { ApiError } from '../../utils/api_error.js';
import type { AiMessage, AiToolSpec } from '../types.js';
import { encodeMessageText, getEnv, isRecord, mapMessageRole } from './shared.js';
import type { AiProviderAdapter, AiProviderAdapterRequest, AiProviderAdapterResult, PartialModelEntry } from './types.js';

export interface OpenAiCompatibleCapabilityOverrides {
  /** DeepSeek: temperature 和 top_p 不允许同时设置 */
  disallowTempWithTopP?: boolean;
  /** DeepSeek/Ollama 使用 max_tokens 而非 max_completion_tokens */
  maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  /** 部分 provider 不支持 seed 参数 */
  supportsSeed?: boolean;
  /** 部分 provider 的 response_format 仅支持有限模式 */
  maxStructuredOutput?: 'json_object' | 'json_schema' | 'none';
}

export interface OpenAiCompatibleConfig {
  provider: string;
  resolveApiKey(input: AiProviderAdapterRequest): string | null;
  resolveBaseUrl(input: AiProviderAdapterRequest): string;
  buildHeaders?(input: AiProviderAdapterRequest): Record<string, string>;
  resolveUserId?(input: AiProviderAdapterRequest): string | null;
  capabilityOverrides?: OpenAiCompatibleCapabilityOverrides;
  /** 模型列表 API 路径，默认 `/models`。设 null 则跳过动态获取 */
  modelsPath?: string | null;
}

const buildChatMessages = (messages: AiMessage[]) => {
  return messages.map(message => ({
    role: mapMessageRole(message.role),
    content: encodeMessageText(message)
  }));
};

const buildOpenAiTools = (tools: AiToolSpec[] | undefined) => {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      strict: tool.strict ?? false
    }
  }));
};

const buildResponseFormat = (
  input: AiProviderAdapterRequest,
  overrides?: OpenAiCompatibleCapabilityOverrides
) => {
  const maxStructured = overrides?.maxStructuredOutput;

  switch (input.request.response_mode) {
    case 'json_schema':
      if (maxStructured === 'none') {
        return undefined;
      }
      if (maxStructured === 'json_object') {
        // 降级：不支持 json_schema，降为 json_object（不含 schema）
        return { type: 'json_object' as const };
      }
      if (!input.request.structured_output) {
        return undefined;
      }
      return {
        type: 'json_schema' as const,
        json_schema: {
          name: input.request.structured_output.schema_name,
          schema: input.request.structured_output.json_schema,
          strict: input.request.structured_output.strict ?? false
        }
      };
    case 'json_object':
      if (maxStructured === 'none') {
        return undefined;
      }
      return { type: 'json_object' as const };
    default:
      return undefined;
  }
};

const buildChatCompletionsRequestBody = (
  input: AiProviderAdapterRequest,
  config: OpenAiCompatibleConfig
) => {
  const overrides = config.capabilityOverrides;
  const body: Record<string, unknown> = {
    model: input.model_entry.model,
    messages: buildChatMessages(input.request.messages)
  };

  const sampling = input.request.sampling;
  const hasTemp = typeof sampling?.temperature === 'number';
  const hasTopP = typeof sampling?.top_p === 'number';

  if (hasTemp) {
    body['temperature'] = sampling.temperature;
  }

  if (hasTopP) {
    if (overrides?.disallowTempWithTopP && hasTemp) {
      // DeepSeek 互斥：保留 temperature，丢弃 top_p
    } else {
      body['top_p'] = sampling.top_p;
    }
  }

  if (typeof sampling?.max_output_tokens === 'number') {
    const field = overrides?.maxTokensField ?? 'max_completion_tokens';
    // eslint-disable-next-line security/detect-object-injection
    body[field] = sampling.max_output_tokens;
  }

  const hasSeed = typeof sampling?.seed === 'number';
  if (hasSeed) {
    const supportsSeed = overrides?.supportsSeed !== false;
    if (supportsSeed) {
      body['seed'] = sampling.seed;
    }
  }

  const responseFormat = buildResponseFormat(input, overrides);
  if (responseFormat) {
    body['response_format'] = responseFormat;
  }

  const tools = buildOpenAiTools(input.request.tools);
  if (tools) {
    body['tools'] = tools;
    body['tool_choice'] = input.request.tool_policy?.mode === 'required'
      ? 'required'
      : input.request.tool_policy?.mode === 'disabled'
        ? 'none'
        : 'auto';
  }

  const userId = config.resolveUserId?.(input);
  if (userId) {
    body['user_id'] = userId;
  }

  return body;
};

const normalizeFinishReason = (
  finishReason: unknown,
  hasToolCalls: boolean
): AiProviderAdapterResult['finish_reason'] => {
  if (hasToolCalls) {
    return 'tool_call';
  }

  if (finishReason === 'length' || finishReason === 'max_output_tokens') {
    return 'length';
  }

  return 'stop';
};

const normalizeChatCompletionsResponse = (
  payload: Record<string, unknown>,
  response: Response
): AiProviderAdapterResult => {
  const choices = Array.isArray(payload['choices']) ? payload['choices'] : [];
  const firstChoice = choices.find(choice => isRecord(choice));
  if (!firstChoice || !isRecord(firstChoice['message'])) {
    throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'Chat completion response is missing choices[0].message');
  }

  const message = firstChoice['message'];
  const content = typeof message['content'] === 'string' ? message['content'] : '';
  const toolCalls = Array.isArray(message['tool_calls'])
    ? message['tool_calls'].flatMap(call => {
        if (!isRecord(call) || !isRecord(call['function'])) {
          return [];
        }
        const argumentsText = typeof call['function']['arguments'] === 'string' ? call['function']['arguments'] : '{}';
        let parsedArguments: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(argumentsText) as unknown;
          if (isRecord(parsed)) {
            parsedArguments = parsed;
          }
        } catch {
          parsedArguments = {};
        }

        return [{
          name: typeof call['function']['name'] === 'string' ? call['function']['name'] : 'unknown_tool',
          arguments: parsedArguments,
          call_id: typeof call['id'] === 'string' ? call['id'] : undefined
        }];
      })
    : [];
  const usageRecord = isRecord(payload['usage']) ? payload['usage'] : null;
  const finishReason = typeof firstChoice['finish_reason'] === 'string' ? firstChoice['finish_reason'] : null;

  return {
    status: 'completed',
    finish_reason: normalizeFinishReason(finishReason, toolCalls.length > 0),
// @ts-expect-error -- EOPT strict mode
    output: {
      mode: toolCalls.length > 0 ? 'tool_call' : 'free_text',
      text: content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    },
    usage: {
      input_tokens: typeof usageRecord?.['prompt_tokens'] === 'number' ? usageRecord['prompt_tokens'] : undefined,
      output_tokens: typeof usageRecord?.['completion_tokens'] === 'number' ? usageRecord['completion_tokens'] : undefined,
      total_tokens: typeof usageRecord?.['total_tokens'] === 'number' ? usageRecord['total_tokens'] : undefined
    },
    safety: {
      blocked: false,
      reason_code: null,
      provider_signal: null
    },
    raw_ref: {
      provider_request_id: response.headers.get('x-request-id'),
      provider_response_id: typeof payload['id'] === 'string' ? payload['id'] : null
    },
    error: null
  };
};

const extractRateLimitHints = (response: Response): import('../elasticity/types.js').RateLimitHints => {
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

const parseErrorPayload = async (response: Response): Promise<{ code: string; message: string; retryable: boolean }> => {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && isRecord(payload['error'])) {
      const code = typeof payload['error']['code'] === 'string' ? payload['error']['code'] : 'AI_PROVIDER_FAIL';
      const message = typeof payload['error']['message'] === 'string' ? payload['error']['message'] : `Provider request failed with ${String(response.status)}`;
      return {
        code,
        message,
        retryable: response.status >= 500 || response.status === 429
      };
    }
  } catch {
    // ignore parse failure
  }

  return {
    code: 'AI_PROVIDER_FAIL',
    message: `Provider request failed with HTTP ${String(response.status)}`,
    retryable: response.status >= 500 || response.status === 429
  };
};

const performChatCompletionsRequest = async (
  input: AiProviderAdapterRequest,
  config: OpenAiCompatibleConfig
): Promise<Response> => {
  const baseUrl = config.resolveBaseUrl(input);
  const body = buildChatCompletionsRequestBody(input, config);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const apiKey = config.resolveApiKey(input);
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (config.buildHeaders) {
    Object.assign(headers, config.buildHeaders(input));
  }

  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
};

// ── Streaming ──────────────────────────────────────────────────────────

const parseChatCompletionsSseChunk = async function* (
  response: Response
): AsyncGenerator<import('./types.js').AiProviderAdapterChunk> {
  if (!response.ok || !response.body) {
    yield { type: 'error', code: 'STREAM_HTTP_ERROR', message: `HTTP ${String(response.status)}` };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallBuf = new Map<number, { name: string; call_id: string; arguments_acc: string }>();
  let finishReason = 'stop';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary
          const json = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
          const choices = Array.isArray(json['choices']) ? json['choices'] : [];
          const choice = choices.find((c: unknown) => isRecord(c));

          // Usage (final chunk)
          if (isRecord(json['usage'])) {
            const u = json['usage'];
            yield {
              type: 'finish',
              finish_reason: finishReason,
              usage: {
                input_tokens: typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : undefined,
                output_tokens: typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : undefined,
                total_tokens: typeof u['total_tokens'] === 'number' ? u['total_tokens'] : undefined
              }
            };
            return;
          }

          if (!choice) continue;

          // Finish reason (without usage)
          const fr = typeof choice['finish_reason'] === 'string' && choice['finish_reason'] !== null && choice['finish_reason'] !== 'null'
            ? choice['finish_reason']
            : null;
          if (fr) {
            finishReason = fr;
          }

          const delta = isRecord(choice['delta']) ? choice['delta'] : null;
          if (!delta) continue;

          // Text delta
          if (typeof delta['content'] === 'string' && delta['content'].length > 0) {
            yield { type: 'text_delta', text: delta['content'] };
          }

          if (delta['tool_calls']) {
            break; // handled below
          }

          // Tool calls
          const toolCalls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];

          // Handle tool_calls in delta — processed outside this parser
          // Actually, OpenAI tool_calls are in delta.tool_calls array
          for (const tc of toolCalls) {
            if (!isRecord(tc)) continue;
            const idx = typeof tc['index'] === 'number' ? tc['index'] : 0;
            const fn = isRecord(tc['function']) ? tc['function'] : null;

            if (fn && typeof fn['name'] === 'string') {
              const entry = {
                name: fn['name'],
                call_id: typeof tc['id'] === 'string' ? tc['id'] : `call_${idx}`,
                arguments_acc: typeof fn['arguments'] === 'string' ? fn['arguments'] : ''
              };
              toolCallBuf.set(idx, entry);
              yield { type: 'tool_call_start', index: idx, call_id: entry.call_id, name: entry.name };
            } else if (fn && typeof fn['arguments'] === 'string') {
              const existing = toolCallBuf.get(idx);
              if (existing) {
                existing.arguments_acc += fn['arguments'];
                yield { type: 'tool_call_delta', index: idx, arguments_fragment: fn['arguments'] };
              }
            }
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    // Stream ended without explicit usage chunk
    yield {
      type: 'finish',
      finish_reason: finishReason,
      usage: undefined
    };
  } catch (err) {
    yield {
      type: 'error',
      code: 'STREAM_READ_ERROR',
      message: err instanceof Error ? err.message : String(err)
    };
  } finally {
    reader.releaseLock();
  }
};

const performStreamingRequest = async (
  input: import('./types.js').AiProviderAdapterRequest,
  config: OpenAiCompatibleConfig,
  signal?: AbortSignal
): Promise<Response> => {
  const baseUrl = config.resolveBaseUrl(input);
  const body = {
    ...buildChatCompletionsRequestBody(input, config),
    stream: true,
    stream_options: { include_usage: true }
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = config.resolveApiKey(input);
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (config.buildHeaders) {
    Object.assign(headers, config.buildHeaders(input));
  }

  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: signal ?? null
  });
};

// ── Dynamic model listing ──────────────────────────────────────────────

const deriveCapabilities = (
  overrides?: OpenAiCompatibleCapabilityOverrides
): PartialModelEntry['capabilities'] => {
  const maxStructured = overrides?.maxStructuredOutput;
  return {
    text_generation: true,
    structured_output: maxStructured === 'json_schema' ? 'json_schema'
      : maxStructured === 'json_object' ? 'json_object'
      : 'none',
    tool_calling: true,
    vision_input: false,
    embeddings: false,
    rerank: false
  };
};

const fetchModelsList = async (
  config: OpenAiCompatibleConfig,
  providerConfig: import('../types.js').AiProviderConfig
): Promise<PartialModelEntry[]> => {
  const modelsPath = config.modelsPath ?? '/models';
  // resolveBaseUrl requires an AiProviderAdapterRequest — for model listing
  // we construct a minimal stub with only provider_config populated
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional stub
  const stubInput = { provider_config: providerConfig } as unknown as AiProviderAdapterRequest;
  const resolvedBaseUrl = config.resolveBaseUrl(stubInput);
  const url = `${resolvedBaseUrl}${modelsPath}`;

  const headers: Record<string, string> = {};
  const apiKey = config.resolveApiKey(stubInput);
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    return [];
  }

  const models: PartialModelEntry[] = [];
  const data = payload['data'] as unknown[];
  for (const item of data) {
    if (!isRecord(item) || !item['id'] || typeof item['id'] !== 'string') continue;
// @ts-expect-error -- EOPT strict mode
    models.push({
      provider: config.provider,
      model: item['id'],
      endpoint_kind: 'chat_completions',
      capabilities: deriveCapabilities(config.capabilityOverrides),
      tags: ['dynamic'],
      availability: 'active'
    });
  }

  return models;
};

// ── Adapter factory ────────────────────────────────────────────────────

export const createOpenAiCompatibleAdapter = (
  config: OpenAiCompatibleConfig
): AiProviderAdapter => {
  return {
    provider: config.provider,
    async execute(input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
      if (!config.resolveApiKey(input) && config.provider !== 'ollama') {
// @ts-expect-error -- EOPT strict mode
        return {
          status: 'failed',
          finish_reason: 'error',
          output: { mode: input.request.response_mode },
          usage: undefined,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: undefined,
          error: {
            code: 'AI_PROVIDER_AUTH_MISSING',
            message: `${config.provider} API key is not configured`,
            retryable: false,
            stage: 'provider'
          }
        };
      }

      const response = await performChatCompletionsRequest(input, config);

      if (!response.ok) {
        const { code, message, retryable } = await parseErrorPayload(response);
        const rateLimitHints = response.status === 429
          ? extractRateLimitHints(response)
          : undefined;
// @ts-expect-error -- EOPT strict mode
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
            retryable,
            stage: 'provider'
          },
          rate_limit_hints: rateLimitHints
        };
      }

      const payload = (await response.json()) as unknown;
      if (!isRecord(payload)) {
        throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', `${config.provider} response payload is not an object`);
      }

      return normalizeChatCompletionsResponse(payload, response);
    },

    async *executeStream(input, signal) {
      const response = await performStreamingRequest(input, config, signal);
      yield* parseChatCompletionsSseChunk(response);
    },

    async listModels(providerConfig) {
      if (config.modelsPath === null) return [];
      try {
        return await fetchModelsList(config, providerConfig);
      } catch {
        return [];
      }
    }
  };
};

// ── Template-based factory ─────────────────────────────────────────────

export const createOpenAiCompatibleAdapterFromTemplate = (
  template: import('../types.js').AiProviderTemplate
): import('./types.js').AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: template.name,
    resolveApiKey(input) {
      const envName = input.provider_config.api_key_env ?? template.api_key_env;
      return getEnv(envName);
    },
    resolveBaseUrl(input) {
      return input.model_entry.base_url
        ?? input.provider_config.base_url
        ?? template.base_url
        ?? 'https://api.openai.com/v1';
    },
    buildHeaders(input) {
      return {
        ...(template.default_headers ?? {}),
        ...(input.provider_config.default_headers ?? {})
      };
    },
// @ts-expect-error -- EOPT strict mode
    capabilityOverrides: template.capability_overrides
  });
};
