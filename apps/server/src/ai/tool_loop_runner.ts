import type { ModelGateway, ModelGatewayExecutionInput } from './gateway.js';
import { createTokenCounter } from './token_counter.js';
import type { TokenCounter } from './token_counter.js';
import type { ToolExecutionContext, ToolRegistry } from './tool_executor.js';
import type { AiMessage, AiToolLoopTrace, ModelGatewayRequest, ModelGatewayResponse } from './types.js';

export interface ToolLoopConfig {
  max_rounds: number;
  total_timeout_ms: number;
  per_tool_timeout_ms: number;
  termination_tools: string[];
  termination_finish_reasons: string[];
  fallback_on_exhaustion: 'return_last' | 'error';
  /** 整个 loop 的 token 预算上限（默认取模型 max_context_tokens * 0.85） */
  max_total_tokens?: number;
  /** 单个 tool result 截断长度（字符数，默认 4096） */
  max_tool_result_chars?: number;
}

const DEFAULT_MAX_TOOL_RESULT_CHARS = 4096;
const TOKEN_BUDGET_RATIO = 0.85;

const DEFAULT_LOOP_CONFIG: ToolLoopConfig = {
  max_rounds: 5,
  total_timeout_ms: 60000,
  per_tool_timeout_ms: 15000,
  termination_tools: [],
  termination_finish_reasons: ['stop'],
  fallback_on_exhaustion: 'return_last'
};

export interface ToolLoopOptions {
  max_rounds?: number;
  total_timeout_ms?: number;
  per_tool_timeout_ms?: number;
  termination_tools?: string[];
  termination_finish_reasons?: string[];
  fallback_on_exhaustion?: 'return_last' | 'error';
  max_total_tokens?: number;
  max_tool_result_chars?: number;
}

export interface ToolLoopRunner {
  run(
    gateway: ModelGateway,
    input: ModelGatewayExecutionInput,
    executor: ToolRegistry,
    ctx: ToolExecutionContext,
    options?: ToolLoopOptions
  ): Promise<ModelGatewayResponse>;
}

const buildToolResultMessage = (name: string, callId: string | undefined, result: unknown, maxChars: number): AiMessage => {
  const resultStr = JSON.stringify(result);
  const truncated = resultStr.length > maxChars
    ? resultStr.slice(0, maxChars) + `...[truncated ${resultStr.length - maxChars} chars]`
    : resultStr;

  return {
    role: 'tool',
    parts: [{ type: 'text', text: truncated }],
    name,
    metadata: callId ? { call_id: callId } : undefined
  };
};

const cloneMessages = (messages: AiMessage[]): AiMessage[] => {
  return messages.map(msg => ({
    ...msg,
    parts: [...msg.parts],
    metadata: msg.metadata ? { ...msg.metadata } : undefined
  }));
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TOOL_EXECUTION_TIMEOUT')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); }
    );
  });
};

export const createToolLoopRunner = (): ToolLoopRunner => {
  const tokenCounter: TokenCounter = createTokenCounter();

  return {
    async run(gateway, input, executor, ctx, options) {
      const config = { ...DEFAULT_LOOP_CONFIG, ...options };
      const startedAt = Date.now();
      const traceRounds: AiToolLoopTrace['rounds'] = [];

      const maxToolResultChars = config.max_tool_result_chars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
      const provider = input.request.provider_hint ?? 'openai';
      const model = input.request.model_hint ?? 'unknown';

      // token 预算：优先使用显式配置，否则取模型 max_context_tokens * 0.85
      const tc = input.task_config as unknown as { model_entry?: { capabilities?: { max_context_tokens?: number } } } | undefined;
      const modelMaxTokens = tc?.model_entry?.capabilities?.max_context_tokens ?? 131072;
      const maxTotalTokens = config.max_total_tokens ?? Math.floor(modelMaxTokens * TOKEN_BUDGET_RATIO);

      let currentRequest = input.request;
      let lastResponse: ModelGatewayResponse | null = null;
      let allAttemptedModels: string[] = [];
      let cumulativeTokens = tokenCounter.countMessagesTokens(
        currentRequest.messages as { role: string; parts: { type: string; text?: string; json?: Record<string, unknown> }[] }[],
        provider,
        model
      );

      for (let round = 0; round < config.max_rounds; round += 1) {
        if (Date.now() - startedAt > config.total_timeout_ms) {
          const trace: AiToolLoopTrace = { rounds: traceRounds, total_rounds: round, exhausted: false };

          if (lastResponse) {
            return {
              ...lastResponse,
              status: 'completed',
              finish_reason: 'stop',
              output: { ...lastResponse.output, mode: 'free_text', text: 'Tool loop timeout exceeded' },
              trace: attachToolLoopTrace(lastResponse.trace, currentRequest, trace)
            };
          }

          return buildLoopErrorResponse(currentRequest, allAttemptedModels, 'TOOL_LOOP_TIMEOUT', 'Tool loop timed out before any response', trace);
        }

        // token 预算检查：进入下一轮前先确认
        if (cumulativeTokens > maxTotalTokens) {
          const trace: AiToolLoopTrace = { rounds: traceRounds, total_rounds: round, exhausted: false };
          return buildLoopErrorResponse(
            currentRequest, allAttemptedModels,
            'TOOL_LOOP_TOKEN_BUDGET_EXCEEDED',
            `Token budget exceeded (${cumulativeTokens}/${maxTotalTokens})`,
            trace
          );
        }

        const roundStart = Date.now();
        const response = await gateway.execute({
          request: currentRequest,
          task_request: input.task_request,
          task_config: input.task_config
        });

        allAttemptedModels = [...new Set([...allAttemptedModels, ...response.attempted_models])];
        lastResponse = response;

        // 累计本轮 input/output tokens
        if (response.usage?.input_tokens) {
          cumulativeTokens += response.usage.input_tokens;
        }
        if (response.usage?.output_tokens) {
          cumulativeTokens += response.usage.output_tokens;
        }
        if (response.usage?.thinking_tokens) {
          cumulativeTokens += response.usage.thinking_tokens;
        }

        if (response.status !== 'completed') {
          return {
            ...response,
            trace: attachToolLoopTrace(response.trace, currentRequest, { rounds: traceRounds, total_rounds: round + 1, exhausted: false })
          };
        }

        if (response.output.mode !== 'tool_call' || !Array.isArray(response.output.tool_calls) || response.output.tool_calls.length === 0) {
          if (config.termination_finish_reasons.includes(response.finish_reason)) {
            return {
              ...response,
              trace: attachToolLoopTrace(response.trace, currentRequest, { rounds: traceRounds, total_rounds: round + 1, exhausted: false })
            };
          }

          return response;
        }

        const toolCalls = response.output.tool_calls;
        const assistantMessage: AiMessage = {
          role: 'assistant',
          parts: [],
          metadata: { tool_calls: toolCalls.map(tc => ({ name: tc.name, call_id: tc.call_id, arguments: tc.arguments })) }
        };

        const roundTraceCalls: AiToolLoopTrace['rounds'][0]['tool_calls'] = [];
        const toolResultMessages: AiMessage[] = [];
        let shouldTerminate = false;
        let terminationPayload: unknown = null;

        for (const tc of toolCalls) {
          const toolStart = Date.now();
          let execResult;

          try {
            execResult = await withTimeout(executor.execute(tc.name, tc.arguments, ctx), config.per_tool_timeout_ms);
          } catch {
            execResult = { success: false, error: { code: 'TOOL_EXECUTION_TIMEOUT', message: `Tool "${tc.name}" exceeded per-tool timeout` } };
          }

          const toolLatency = Date.now() - toolStart;
          roundTraceCalls.push({ name: tc.name, latency_ms: toolLatency, success: execResult.success === true });

          toolResultMessages.push(buildToolResultMessage(tc.name, tc.call_id, execResult, maxToolResultChars));

          if (config.termination_tools.includes(tc.name)) {
            shouldTerminate = true;
            terminationPayload = execResult.data ?? execResult.error ?? null;
          }
        }

        traceRounds.push({
          round,
          tool_calls: roundTraceCalls,
          total_latency_ms: Date.now() - roundStart
        });

        if (shouldTerminate) {
          const trace: AiToolLoopTrace = { rounds: traceRounds, total_rounds: round + 1, exhausted: false };
          return {
            ...response,
            output: { mode: 'free_text', text: JSON.stringify(terminationPayload) },
            attempted_models: allAttemptedModels,
            trace: attachToolLoopTrace(response.trace, currentRequest, trace)
          };
        }

        const newMessages = [...cloneMessages(currentRequest.messages), assistantMessage, ...toolResultMessages];
        cumulativeTokens += tokenCounter.countMessagesTokens(
          [assistantMessage, ...toolResultMessages] as { role: string; parts: { type: string; text?: string; json?: Record<string, unknown> }[] }[],
          provider,
          model
        );

        currentRequest = {
          ...currentRequest,
          messages: newMessages
        };
      }

      const exhausted = true;
      const trace: AiToolLoopTrace = { rounds: traceRounds, total_rounds: config.max_rounds, exhausted };

      if (config.fallback_on_exhaustion === 'error') {
        return buildLoopErrorResponse(currentRequest, allAttemptedModels, 'TOOL_LOOP_EXHAUSTED', 'Maximum tool loop rounds reached', trace);
      }

      if (lastResponse) {
        return {
          ...lastResponse,
          output: { mode: 'free_text', text: 'Maximum tool loop rounds reached without terminal response' },
          trace: attachToolLoopTrace(lastResponse.trace, currentRequest, trace)
        };
      }

      return buildLoopErrorResponse(currentRequest, allAttemptedModels, 'TOOL_LOOP_EXHAUSTED', 'Tool loop exhausted without receiving any response', trace);
    }
  };
};

const attachToolLoopTrace = (
  existingTrace: ModelGatewayResponse['trace'],
  request: ModelGatewayRequest,
  loopTrace: AiToolLoopTrace
): ModelGatewayResponse['trace'] => {
  return {
    ...(existingTrace ?? {
      task_id: request.task_id,
      task_type: request.task_type,
      route_id: request.route_id ?? null,
      audit_level: 'standard' as const,
      attempts: []
    }),
    tool_loop: loopTrace
  };
};

const buildLoopErrorResponse = (
  request: ModelGatewayRequest,
  allAttemptedModels: string[],
  code: string,
  message: string,
  toolLoopTrace?: AiToolLoopTrace
): ModelGatewayResponse => {
  return {
    invocation_id: request.invocation_id,
    task_id: request.task_id,
    task_type: request.task_type,
    provider: 'unknown',
    model: 'unknown',
    route_id: null,
    fallback_used: false,
    attempted_models: allAttemptedModels,
    status: 'failed',
    finish_reason: 'error',
    output: { mode: 'json_schema' },
    safety: { blocked: false },
    error: { code, message, retryable: false, stage: 'provider' },
    trace: toolLoopTrace ? {
      task_id: request.task_id,
      task_type: request.task_type,
      route_id: null,
      audit_level: 'standard' as const,
      attempts: [],
      tool_loop: toolLoopTrace
    } : undefined
  };
};
