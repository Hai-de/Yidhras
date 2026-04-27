import type { ModelGateway, ModelGatewayExecutionInput } from './gateway.js';
import type { ToolExecutionContext, ToolRegistry } from './tool_executor.js';
import type { AiMessage, AiToolLoopTrace, ModelGatewayRequest, ModelGatewayResponse } from './types.js';

export interface ToolLoopConfig {
  max_rounds: number;
  total_timeout_ms: number;
  per_tool_timeout_ms: number;
  termination_tools: string[];
  termination_finish_reasons: string[];
  fallback_on_exhaustion: 'return_last' | 'error';
}

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

const buildToolResultMessage = (name: string, callId: string | undefined, result: unknown): AiMessage => {
  return {
    role: 'tool',
    parts: [{ type: 'text', text: JSON.stringify(result) }],
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
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
};

export const createToolLoopRunner = (): ToolLoopRunner => {
  return {
    async run(gateway, input, executor, ctx, options) {
      const config = { ...DEFAULT_LOOP_CONFIG, ...options };
      const startedAt = Date.now();
      const traceRounds: AiToolLoopTrace['rounds'] = [];

      let currentRequest = input.request;
      let lastResponse: ModelGatewayResponse | null = null;
      let allAttemptedModels: string[] = [];

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

        const roundStart = Date.now();
        const response = await gateway.execute({
          request: currentRequest,
          task_request: input.task_request,
          task_config: input.task_config
        });

        allAttemptedModels = [...new Set([...allAttemptedModels, ...response.attempted_models])];
        lastResponse = response;

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

          toolResultMessages.push(buildToolResultMessage(tc.name, tc.call_id, execResult));

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

        currentRequest = {
          ...currentRequest,
          messages: [...cloneMessages(currentRequest.messages), assistantMessage, ...toolResultMessages]
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
