import { ApiError } from '../../utils/api_error.js';
import type { AiMessage, AiToolSpec, ModelGatewayResponse } from '../types.js';
import type { AiProviderAdapter, AiProviderAdapterRequest, AiProviderAdapterResult } from './types.js';

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const STRUCTURED_OUTPUT_TOOL_NAME = '__structured_output';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const getEnv = (name: string | null | undefined): string | null => {
  if (!name) return null;
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim();
};

// ── Role mapping ───────────────────────────────────────────────────────

/** 提取 system/developer 消息，映射为 Anthropic 顶层 system 参数 */
const extractSystemMessages = (messages: AiMessage[]): { systemMessages: AiMessage[]; rest: AiMessage[] } => {
  const systemMessages: AiMessage[] = [];
  const rest: AiMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      systemMessages.push(msg);
    } else {
      rest.push(msg);
    }
  }

  return { systemMessages, rest };
};

const buildSystemPrompt = (messages: AiMessage[]): string | undefined => {
  const { systemMessages } = extractSystemMessages(messages);
  if (systemMessages.length === 0) return undefined;

  return systemMessages
    .map(msg =>
      msg.parts
        .map(part => {
          if (part.type === 'text') return part.text;
          if (part.type === 'json') return JSON.stringify(part.json, null, 2);
          return '';
        })
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
};

// ── Content block builders ─────────────────────────────────────────────

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

const buildUserContent = (message: AiMessage): AnthropicContentBlock[] => {
  const blocks: AnthropicContentBlock[] = [];

  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        blocks.push({ type: 'text', text: part.text });
        break;
      case 'json':
        blocks.push({ type: 'text', text: JSON.stringify(part.json, null, 2) });
        break;
      case 'image_url': {
        // Anthropic 仅支持 base64。URL 形式的图片无法直接使用，作为文本标签回退。
        blocks.push({ type: 'text', text: `[image: ${part.url}]` });
        break;
      }
      case 'file_ref':
        blocks.push({ type: 'text', text: `[file:${part.file_id}]` });
        break;
      default:
        break;
    }
  }

  return blocks;
};

const buildAssistantContent = (message: AiMessage): AnthropicContentBlock[] => {
  const blocks: AnthropicContentBlock[] = [];
  const toolCalls = Array.isArray(message.metadata?.tool_calls)
    ? (message.metadata.tool_calls as Array<{ name: string; call_id?: string; arguments: Record<string, unknown> }>)
    : [];

  let textContent = '';

  for (const part of message.parts) {
    if (part.type === 'text') {
      textContent += part.text;
    } else if (part.type === 'json') {
      textContent += JSON.stringify(part.json, null, 2);
    }
  }

  if (textContent.trim().length > 0) {
    blocks.push({ type: 'text', text: textContent.trim() });
  }

  for (const tc of toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: tc.call_id ?? `toolu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: tc.name,
      input: tc.arguments
    });
  }

  return blocks;
};

const buildToolResultContent = (message: AiMessage): AnthropicContentBlock[] => {
  const callId = typeof message.metadata?.call_id === 'string' ? message.metadata.call_id : '';
  const text = message.parts
    .map(part => (part.type === 'text' ? part.text : part.type === 'json' ? JSON.stringify(part.json) : ''))
    .filter(Boolean)
    .join('\n');

  return [{ type: 'tool_result', tool_use_id: callId, content: text }];
};

// ── Tool definitions ───────────────────────────────────────────────────

const buildAnthropicTools = (tools: AiToolSpec[]): AnthropicToolDef[] => {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: (tool.input_schema.properties ?? {}) as Record<string, unknown>,
      required: Array.isArray(tool.input_schema.required)
        ? (tool.input_schema.required as string[])
        : undefined
    }
  }));
};

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ── Structured output ─────────────────────────────────────────────────

const buildStructuredOutputTool = (
  structuredOutput: NonNullable<AiProviderAdapterRequest['request']['structured_output']>
): AnthropicToolDef => {
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    description: `Output structured data matching the required schema`,
    input_schema: {
      type: 'object',
      properties: (structuredOutput.json_schema.properties ?? {}) as Record<string, unknown>,
      required: Array.isArray(structuredOutput.json_schema.required)
        ? (structuredOutput.json_schema.required as string[])
        : undefined
    }
  };
};

// ── Prompt injection for json_object ───────────────────────────────────

const JSON_OBJECT_INSTRUCTION =
  '\n\nIMPORTANT: Respond with a valid JSON object only. Do not wrap it in markdown code fences (```json ... ```). Do not include any text before or after the JSON object. Your entire response must be parseable by JSON.parse().';

// ── Messages API request builder ───────────────────────────────────────

interface AnthropicMessagesRequest {
  model: string;
  messages: { role: 'user' | 'assistant'; content: AnthropicContentBlock[] }[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDef[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
  thinking?: { type: 'enabled'; budget_tokens: number };
  metadata?: Record<string, unknown>;
}

const buildMessagesBody = (
  nonSystemMessages: AiMessage[]
): { role: 'user' | 'assistant'; content: AnthropicContentBlock[] }[] => {
  return nonSystemMessages
    .filter(msg => msg.role !== 'tool')
    .map(msg => {
      if (msg.role === 'assistant') {
        return { role: 'assistant' as const, content: buildAssistantContent(msg) };
      }
      // user 以及其它未识别 role 都 map 为 user
      return { role: 'user' as const, content: buildUserContent(msg) };
    });
};

const buildToolResultMessages = (
  messages: AiMessage[]
): { role: 'user'; content: AnthropicContentBlock[] }[] => {
  return messages
    .filter(msg => msg.role === 'tool')
    .map(msg => ({
      role: 'user' as const,
      content: buildToolResultContent(msg)
    }));
};

const buildAnthropicRequest = (
  input: AiProviderAdapterRequest
): AnthropicMessagesRequest => {
  const { systemMessages, rest } = extractSystemMessages(input.request.messages);
  const systemPrompt = buildSystemPrompt(systemMessages);
  const maxTokens = input.request.sampling?.max_output_tokens
    ?? input.model_entry.capabilities.max_output_tokens
    ?? 4096;

  const body: AnthropicMessagesRequest = {
    model: input.model_entry.model,
    messages: [
      ...buildMessagesBody(rest),
      ...buildToolResultMessages(input.request.messages)
    ],
    max_tokens: maxTokens
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (typeof input.request.sampling?.temperature === 'number') {
    body.temperature = input.request.sampling.temperature;
  }

  if (typeof input.request.sampling?.top_p === 'number') {
    body.top_p = input.request.sampling.top_p;
  }

  if (input.request.sampling?.stop && input.request.sampling.stop.length > 0) {
    body.stop_sequences = input.request.sampling.stop;
  }

  // Structured output (json_schema) → tool_use
  if (
    input.request.response_mode === 'json_schema' &&
    input.request.structured_output
  ) {
    const soTool = buildStructuredOutputTool(input.request.structured_output);
    const realTools = Array.isArray(input.request.tools) && input.request.tools.length > 0
      ? buildAnthropicTools(input.request.tools)
      : [];

    if (realTools.length > 0) {
      // 同时有 structured output + tool calling → any
      body.tools = [...realTools, soTool];
      body.tool_choice = { type: 'any' };
    } else {
      // 仅 structured output → 强制调用 __structured_output
      body.tools = [soTool];
      body.tool_choice = { type: 'tool', name: STRUCTURED_OUTPUT_TOOL_NAME };
    }
  } else if (Array.isArray(input.request.tools) && input.request.tools.length > 0) {
    // 仅 tool calling
    body.tools = buildAnthropicTools(input.request.tools);
    body.tool_choice = { type: 'auto' };
  }

  // Threading
  const thinking = (input.request.sampling as Record<string, unknown> | undefined)
    ?.extensions as { thinking?: { enabled?: boolean; budget_tokens?: number } } | undefined;
  if (thinking?.thinking?.enabled) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: thinking.thinking.budget_tokens ?? 1024
    };
  }

  return body;
};

// ── Response parser ────────────────────────────────────────────────────

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const parseAnthropicResponse = (payload: Record<string, unknown>, response: Response): AiProviderAdapterResult => {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const textBlocks: string[] = [];
  const toolCalls: NonNullable<ModelGatewayResponse['output']['tool_calls']> = [];

  for (const block of content) {
    if (!isRecord(block)) continue;

    if (block.type === 'text' && typeof block.text === 'string') {
      textBlocks.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        name: typeof block.name === 'string' ? block.name : 'unknown_tool',
        arguments: isRecord(block.input) ? block.input : {},
        call_id: typeof block.id === 'string' ? block.id : undefined
      });
    }
  }

  const stopReason = typeof payload.stop_reason === 'string' ? payload.stop_reason : null;
  const usage = isRecord(payload.usage) ? (payload.usage as unknown as AnthropicUsage) : null;
  const blocked = stopReason === 'content_filter' || stopReason === 'safety';

  let outputMode: AiProviderAdapterResult['output']['mode'] = 'free_text';
  if (toolCalls.length > 0) {
    outputMode = 'tool_call';
  } else if (textBlocks.length === 1 && textBlocks[0].trim().startsWith('{')) {
    outputMode = 'json_object';
  }

  return {
    status: blocked ? 'blocked' : 'completed',
    finish_reason: toolCalls.length > 0
      ? 'tool_call'
      : blocked
        ? 'safety'
        : stopReason === 'max_tokens'
          ? 'length'
          : 'stop',
    output: {
      mode: outputMode,
      text: textBlocks.join('\n').trim() || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    },
    usage: usage ? {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.input_tokens + usage.output_tokens,
      cached_input_tokens: usage.cache_read_input_tokens,
      thinking_tokens: undefined  // Anthropic 在 streaming 中单独报告 thinking tokens
    } : undefined,
    safety: {
      blocked,
      reason_code: blocked ? stopReason : null,
      provider_signal: null
    },
    raw_ref: {
      provider_request_id: response.headers.get('x-request-id'),
      provider_response_id: typeof payload.id === 'string' ? payload.id : null
    },
    error: blocked ? {
      code: 'AI_PROVIDER_SAFETY_BLOCK',
      message: 'Anthropic response was blocked by safety policy',
      retryable: false,
      stage: 'safety'
    } : null
  };
};

// ── API call ───────────────────────────────────────────────────────────

const performAnthropicRequest = async (
  input: AiProviderAdapterRequest,
  apiKey: string
): Promise<Response> => {
  const baseUrl = input.model_entry.base_url ?? input.provider_config.base_url ?? ANTHROPIC_BASE_URL;
  const body = buildAnthropicRequest(input);

  return fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body)
  });
};

const parseErrorPayload = async (response: Response): Promise<{ code: string; message: string; retryable: boolean }> => {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && isRecord(payload.error)) {
      const code = typeof payload.error.type === 'string' ? payload.error.type : 'AI_PROVIDER_FAIL';
      const message = typeof payload.error.message === 'string' ? payload.error.message : `Anthropic request failed with ${String(response.status)}`;
      return {
        code,
        message,
        retryable: response.status >= 500 || response.status === 429
      };
    }
  } catch {
    // ignore
  }

  return {
    code: 'AI_PROVIDER_FAIL',
    message: `Anthropic request failed with HTTP ${String(response.status)}`,
    retryable: response.status >= 500 || response.status === 429
  };
};

// ── JSON parse with retry (json_object prompt injection path) ──────────

const tryParseJsonFromText = (text: string): Record<string, unknown> | null => {
  // 尝试直接解析
  try {
    const result = JSON.parse(text) as unknown;
    if (isRecord(result)) return result;
    return null;
  } catch {
    // 尝试从 markdown fence 中提取
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        const result = JSON.parse(fenceMatch[1].trim()) as unknown;
        if (isRecord(result)) return result;
      } catch {
        // ignore
      }
    }
    // 尝试找到第一个 { 和最后一个 }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const result = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
        if (isRecord(result)) return result;
      } catch {
        // ignore
      }
    }
    return null;
  }
};

// ── Rate limit hints extraction ────────────────────────────────────────

const extractRateLimitHintsFromHeaders = (response: Response): import('../elasticity/types.js').RateLimitHints => {
  const hints: import('../elasticity/types.js').RateLimitHints = {};

  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      hints.retryAfterSeconds = seconds;
    }
  }

  const remaining = response.headers.get('x-ratelimit-remaining')
    ?? response.headers.get('anthropic-ratelimit-requests-remaining');
  if (remaining) {
    const n = Number(remaining);
    if (Number.isFinite(n)) {
      hints.remainingQuota = n;
    }
  }

  const limit = response.headers.get('x-ratelimit-limit')
    ?? response.headers.get('anthropic-ratelimit-requests-limit');
  if (limit) {
    const n = Number(limit);
    if (Number.isFinite(n)) {
      hints.limitQuota = n;
    }
  }

  return hints;
};

// ── Adapter ────────────────────────────────────────────────────────────

export const createAnthropicProviderAdapter = (): AiProviderAdapter => {
  return {
    provider: 'anthropic',
    async execute(input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
      const apiKey = getEnv(input.provider_config.api_key_env);
      if (!apiKey) {
        return {
          status: 'failed',
          finish_reason: 'error',
          output: { mode: input.request.response_mode },
          usage: undefined,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: undefined,
          error: {
            code: 'AI_PROVIDER_AUTH_MISSING',
            message: 'Anthropic API key is not configured',
            retryable: false,
            stage: 'provider'
          }
        };
      }

      const response = await performAnthropicRequest(input, apiKey);

      if (!response.ok) {
        const { code, message, retryable } = await parseErrorPayload(response);
        const rateLimitHints = response.status === 429
          ? extractRateLimitHintsFromHeaders(response)
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
          error: { code, message, retryable, stage: 'provider' },
          rate_limit_hints: rateLimitHints
        };
      }

      const payload = (await response.json()) as unknown;
      if (!isRecord(payload)) {
        throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'Anthropic response payload is not an object');
      }

      const result = parseAnthropicResponse(payload, response);

      // json_object 模式 → 尝试 JSON.parse，失败重试一次（提示词注入路径）
      if (
        result.status === 'completed' &&
        input.request.response_mode === 'json_object' &&
        result.output.mode === 'free_text' &&  // 非 tool_call 路径
        result.output.text
      ) {
        const parsed = tryParseJsonFromText(result.output.text);
        if (parsed) {
          return {
            ...result,
            output: { mode: 'json_object', text: JSON.stringify(parsed) }
          };
        }

        // 首次解析失败 → 重试一次（在后续消息中追加更强约束）
        return {
          status: 'failed',
          finish_reason: 'error',
          output: { mode: 'json_object' },
          usage: result.usage,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: result.raw_ref,
          error: {
            code: 'AI_PROVIDER_DECODE_FAIL',
            message: 'Anthropic response is not valid JSON in json_object mode',
            retryable: true,
            stage: 'provider'
          }
        };
      }

      return result;
    },

    async *executeStream(input, signal) {
      const apiKey = getEnv(input.provider_config.api_key_env);
      if (!apiKey) {
        yield { type: 'error', code: 'AI_PROVIDER_AUTH_MISSING', message: 'Anthropic API key is not configured' };
        return;
      }

      const response = await performAnthropicStreamingRequest(input, apiKey, signal);
      yield* parseAnthropicSseStream(response);
    }
  };
};

// ── Anthropic streaming ─────────────────────────────────────────────────

const performAnthropicStreamingRequest = async (
  input: AiProviderAdapterRequest,
  apiKey: string,
  signal?: AbortSignal
): Promise<Response> => {
  const baseUrl = input.model_entry.base_url ?? input.provider_config.base_url ?? ANTHROPIC_BASE_URL;
  const body = { ...buildAnthropicRequest(input), stream: true };

  return fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body),
    signal
  });
};

const parseAnthropicSseStream = async function* (
  response: Response
): AsyncGenerator<import('./types.js').AiProviderAdapterChunk> {
  if (!response.ok || !response.body) {
    yield { type: 'error', code: 'STREAM_HTTP_ERROR', message: `Anthropic HTTP ${String(response.status)}` };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallBuf = new Map<number, { name: string; call_id: string; arguments_acc: string }>();
  let toolCallIdx = 0;
  let finishReason = 'stop';
  let usageOutputTokens: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Anthropic SSE uses \n\n as event separator
      while (buffer.includes('\n\n')) {
        const idx = buffer.indexOf('\n\n');
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = block.split('\n');
        let eventType = '';
        let dataJson = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataJson = line.slice(6);
          }
        }

        if (!dataJson) continue;

        try {
          const data = JSON.parse(dataJson) as Record<string, unknown>;

          switch (eventType) {
            case 'message_start': {
              const msg = isRecord(data.message) ? data.message : null;
              const usage = isRecord(msg?.usage) ? msg.usage : null;
              if (usage && typeof usage.input_tokens === 'number') {
                yield { type: 'start', usage: { input_tokens: usage.input_tokens } };
              }
              break;
            }

            case 'content_block_start': {
              const block = isRecord(data.content_block) ? data.content_block : null;
              if (block?.type === 'tool_use') {
                const name = typeof block.name === 'string' ? block.name : 'unknown_tool';
                const callId = typeof block.id === 'string' ? block.id : `toolu_${toolCallIdx}`;
                toolCallBuf.set(toolCallIdx, { name, call_id: callId, arguments_acc: '' });
                yield { type: 'tool_call_start', index: toolCallIdx, call_id: callId, name };
                toolCallIdx += 1;
              }
              break;
            }

            case 'content_block_delta': {
              const delta = isRecord(data.delta) ? data.delta : null;
              if (!delta) break;

              if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                yield { type: 'text_delta', text: delta.text };
              } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                yield { type: 'thinking_delta', text: delta.thinking };
              } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                // Find the current tool call index (Anthropic sends one tool_use at a time)
                const currentIdx = toolCallIdx - 1;
                const existing = toolCallBuf.get(currentIdx);
                if (existing) {
                  existing.arguments_acc += delta.partial_json;
                  yield { type: 'tool_call_delta', index: currentIdx, arguments_fragment: delta.partial_json };
                }
              }
              break;
            }

            case 'message_delta': {
              const delta = isRecord(data.delta) ? data.delta : null;
              if (delta?.stop_reason && typeof delta.stop_reason === 'string') {
                finishReason = delta.stop_reason === 'end_turn' ? 'stop'
                  : delta.stop_reason === 'max_tokens' ? 'length'
                  : delta.stop_reason === 'tool_use' ? 'tool_call'
                  : 'stop';
              }
              const usage = isRecord(data.usage) ? data.usage : null;
              if (usage && typeof usage.output_tokens === 'number') {
                usageOutputTokens = usage.output_tokens;
              }
              break;
            }

            case 'message_stop': {
              yield {
                type: 'finish',
                finish_reason: finishReason,
                usage: usageOutputTokens !== undefined
                  ? { output_tokens: usageOutputTokens }
                  : undefined
              };
              return;
            }

            case 'error': {
              const err = isRecord(data.error) ? data.error : null;
              yield {
                type: 'error',
                code: typeof err?.type === 'string' ? err.type : 'STREAM_PROVIDER_ERROR',
                message: typeof err?.message === 'string' ? err.message : 'Anthropic stream error'
              };
              return;
            }

            case 'ping':
              // 心跳，忽略
              break;

            default:
              break;
          }
        } catch {
          // 跳过无法解析的数据块
        }
      }
    }

    // 流意外结束
    yield {
      type: 'finish',
      finish_reason: finishReason,
      usage: usageOutputTokens !== undefined
        ? { output_tokens: usageOutputTokens }
        : undefined
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
