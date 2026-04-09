import { ApiError } from '../../utils/api_error.js';
import type { AiMessage, AiToolSpec, ModelGatewayResponse } from '../types.js';
import type { AiProviderAdapter, AiProviderAdapterRequest, AiProviderAdapterResult } from './types.js';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const getEnv = (name: string | null | undefined): string | null => {
  if (!name) {
    return null;
  }

  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value.trim();
};

const resolveBaseUrl = (input: AiProviderAdapterRequest): string => {
  return input.model_entry.base_url ?? input.provider_config.base_url ?? OPENAI_BASE_URL;
};

const resolveApiKey = (input: AiProviderAdapterRequest): string => {
  const apiKey = getEnv(input.provider_config.api_key_env);
  if (!apiKey) {
    throw new ApiError(500, 'AI_PROVIDER_AUTH_MISSING', 'OpenAI API key is not configured', {
      provider: input.provider_config.provider,
      api_key_env: input.provider_config.api_key_env ?? null
    });
  }

  return apiKey;
};

const mapMessageRole = (role: AiMessage['role']): 'system' | 'user' | 'assistant' | 'tool' => {
  if (role === 'developer') {
    return 'system';
  }

  if (role === 'system' || role === 'assistant' || role === 'tool') {
    return role;
  }

  return 'user';
};

const encodeMessageText = (message: AiMessage): string => {
  return message.parts
    .map(part => {
      switch (part.type) {
        case 'text':
          return part.text;
        case 'json':
          return JSON.stringify(part.json, null, 2);
        case 'image_url':
          return `[image] ${part.url}`;
        case 'file_ref':
          return `[file:${part.file_id}]`;
        default:
          return '';
      }
    })
    .filter(text => text.trim().length > 0)
    .join('\n\n');
};

const buildResponsesInput = (messages: AiMessage[]) => {
  return messages.map(message => ({
    role: mapMessageRole(message.role),
    content: message.parts.map(part => {
      switch (part.type) {
        case 'text':
          return { type: 'input_text', text: part.text };
        case 'json':
          return { type: 'input_text', text: JSON.stringify(part.json, null, 2) };
        case 'image_url':
          return { type: 'input_image', image_url: part.url };
        case 'file_ref':
          return { type: 'input_file', file_id: part.file_id };
        default:
          return { type: 'input_text', text: '' };
      }
    })
  }));
};

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
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      strict: tool.strict ?? false
    }
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

const buildResponseFormat = (input: AiProviderAdapterRequest) => {
  switch (input.request.response_mode) {
    case 'json_schema':
      if (!input.request.structured_output) {
        return undefined;
      }
      return {
        type: 'json_schema',
        json_schema: {
          name: input.request.structured_output.schema_name,
          schema: input.request.structured_output.json_schema,
          strict: input.request.structured_output.strict ?? false
        }
      };
    case 'json_object':
      return {
        type: 'json_object'
      };
    default:
      return undefined;
  }
};

const buildResponsesFormat = (input: AiProviderAdapterRequest) => {
  switch (input.request.response_mode) {
    case 'json_schema':
      if (!input.request.structured_output) {
        return undefined;
      }
      return {
        format: {
          type: 'json_schema',
          name: input.request.structured_output.schema_name,
          schema: input.request.structured_output.json_schema,
          strict: input.request.structured_output.strict ?? false
        }
      };
    case 'json_object':
      return {
        format: {
          type: 'json_object'
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

const extractResponsesToolCalls = (payload: Record<string, unknown>): NonNullable<ModelGatewayResponse['output']['tool_calls']> => {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const calls: NonNullable<ModelGatewayResponse['output']['tool_calls']> = [];

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

const normalizeFinishReason = (
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

const buildEmbeddingsRequestBody = (input: AiProviderAdapterRequest) => {
  const textInput = input.request.messages.map(message => encodeMessageText(message)).filter(text => text.trim().length > 0).join('\n\n');
  return {
    model: input.model_entry.model,
    input: textInput
  };
};

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

  const tools = buildOpenAiTools(input.request.tools);
  if (tools) {
    body.tools = tools.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: tool.function.strict
    }));
    const toolChoice = buildResponsesToolChoice(input.request.tool_policy?.mode);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  return body;
};

const buildChatCompletionsRequestBody = (input: AiProviderAdapterRequest) => {
  const body: Record<string, unknown> = {
    model: input.model_entry.model,
    messages: buildChatMessages(input.request.messages)
  };

  if (typeof input.request.sampling?.temperature === 'number') {
    body.temperature = input.request.sampling.temperature;
  }
  if (typeof input.request.sampling?.top_p === 'number') {
    body.top_p = input.request.sampling.top_p;
  }
  if (typeof input.request.sampling?.max_output_tokens === 'number') {
    body.max_completion_tokens = input.request.sampling.max_output_tokens;
  }

  const responseFormat = buildResponseFormat(input);
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const tools = buildOpenAiTools(input.request.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = input.request.tool_policy?.mode === 'required'
      ? 'required'
      : input.request.tool_policy?.mode === 'disabled'
        ? 'none'
        : 'auto';
  }

  return body;
};

const buildHeaders = (input: AiProviderAdapterRequest): HeadersInit => {
  const apiKey = resolveApiKey(input);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
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

const parseErrorPayload = async (response: Response): Promise<{ code: string; message: string }> => {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && isRecord(payload.error)) {
      const code = typeof payload.error.code === 'string' ? payload.error.code : 'AI_PROVIDER_FAIL';
      const message = typeof payload.error.message === 'string' ? payload.error.message : `OpenAI request failed with ${response.status}`;
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

const performRequest = async (input: AiProviderAdapterRequest): Promise<Response> => {
  const baseUrl = resolveBaseUrl(input);
  const endpoint = input.model_entry.endpoint_kind === 'embeddings'
    ? '/embeddings'
    : input.model_entry.endpoint_kind === 'chat_completions'
      ? '/chat/completions'
      : '/responses';

  const body = input.model_entry.endpoint_kind === 'embeddings'
    ? buildEmbeddingsRequestBody(input)
    : input.model_entry.endpoint_kind === 'chat_completions'
      ? buildChatCompletionsRequestBody(input)
      : buildResponsesRequestBody(input);

  return fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: buildHeaders(input),
    body: JSON.stringify(body)
  });
};

const normalizeEmbeddingsResponse = (payload: Record<string, unknown>, response: Response): AiProviderAdapterResult => {
  const data = Array.isArray(payload.data) ? payload.data : [];
  const first = data.find(item => isRecord(item) && Array.isArray(item.embedding));
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

const normalizeChatCompletionsResponse = (payload: Record<string, unknown>, response: Response): AiProviderAdapterResult => {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices.find(choice => isRecord(choice)) as Record<string, unknown> | undefined;
  if (!firstChoice || !isRecord(firstChoice.message)) {
    throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'OpenAI chat completion response is missing choices[0].message');
  }

  const message = firstChoice.message;
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.flatMap(call => {
        if (!isRecord(call) || !isRecord(call.function)) {
          return [];
        }
        const argumentsText = typeof call.function.arguments === 'string' ? call.function.arguments : '{}';
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
          name: typeof call.function.name === 'string' ? call.function.name : 'unknown_tool',
          arguments: parsedArguments,
          call_id: typeof call.id === 'string' ? call.id : undefined
        }];
      })
    : [];
  const usageRecord = isRecord(payload.usage) ? payload.usage : null;
  const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null;

  return {
    status: 'completed',
    finish_reason: normalizeFinishReason(finishReason, toolCalls.length > 0, false),
    output: {
      mode: toolCalls.length > 0 ? 'tool_call' : 'free_text',
      text: content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    },
    usage: {
      input_tokens: typeof usageRecord?.prompt_tokens === 'number' ? usageRecord.prompt_tokens : undefined,
      output_tokens: typeof usageRecord?.completion_tokens === 'number' ? usageRecord.completion_tokens : undefined,
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
    finish_reason: normalizeFinishReason(incompleteReason, toolCalls.length > 0, blocked),
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

export const createOpenAiProviderAdapter = (): AiProviderAdapter => {
  return {
    provider: 'openai',
    async execute(input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
      const response = await performRequest(input);
      if (!response.ok) {
        const { code, message } = await parseErrorPayload(response);
        return {
          status: 'failed',
          finish_reason: 'error',
          output: {
            mode: input.request.response_mode
          },
          usage: undefined,
          safety: {
            blocked: false,
            reason_code: null,
            provider_signal: null
          },
          raw_ref: {
            provider_request_id: response.headers.get('x-request-id'),
            provider_response_id: null
          },
          error: {
            code,
            message,
            retryable: response.status >= 500 || response.status === 429,
            stage: response.status === 429 ? 'provider' : 'provider'
          }
        };
      }

      const payload = (await response.json()) as unknown;
      if (!isRecord(payload)) {
        throw new ApiError(500, 'AI_PROVIDER_DECODE_FAIL', 'OpenAI response payload is not an object');
      }

      if (input.model_entry.endpoint_kind === 'embeddings') {
        return normalizeEmbeddingsResponse(payload, response);
      }

      if (input.model_entry.endpoint_kind === 'chat_completions') {
        return normalizeChatCompletionsResponse(payload, response);
      }

      return normalizeResponsesApiResponse(payload, response);
    }
  };
};
