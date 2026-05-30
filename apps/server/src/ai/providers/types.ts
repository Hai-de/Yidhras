import type { RateLimitHints } from '../elasticity/types.js';
import type {
  AiModelRegistryEntry,
  AiProviderConfig,
  AiResolvedTaskConfig,
  AiTaskRequest,
  ModelGatewayRequest,
  ModelGatewayResponse
} from '../types.js';

/** listModels() 返回的部分模型条目，由 registry 层补全缺失字段 */
export type PartialModelEntry = Pick<AiModelRegistryEntry, 'provider' | 'model'> &
  Partial<Omit<AiModelRegistryEntry, 'provider' | 'model'>>;

export type AiProviderAdapterResult = Pick<
  ModelGatewayResponse,
  'status' | 'finish_reason' | 'output' | 'usage' | 'safety' | 'raw_ref' | 'error'
> & {
  /** Provider 返回的 rate limit 提示，用于动态校准限流器 */
  rate_limit_hints?: RateLimitHints | undefined;
};

export type AiProviderAdapterChunk =
  | { type: 'start'; usage?: { input_tokens?: number | undefined } }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; index: number; call_id?: string; name: string } | undefined
  | { type: 'tool_call_delta'; index: number; arguments_fragment: string }
  | { type: 'finish'; finish_reason: string; usage?: { input_tokens?: number | undefined; output_tokens?: number | undefined; total_tokens?: number | undefined } | undefined }
  | { type: 'error'; code: string; message: string };

export interface AiProviderAdapterRequest {
  request: ModelGatewayRequest;
  task_request: AiTaskRequest;
  task_config: AiResolvedTaskConfig;
  model_entry: AiModelRegistryEntry;
  provider_config: AiProviderConfig;
}

export interface AiProviderAdapter {
  readonly provider: string;
  execute(input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult>;
  /** 流式推理。不支持的 adapter 可不实现，gateway 将退化到 execute() */
  executeStream?(input: AiProviderAdapterRequest, signal?: AbortSignal): AsyncIterable<AiProviderAdapterChunk> | undefined;
  /** 从 provider API 动态拉取可用模型列表。不支持的 adapter 可不实现 */
  listModels?(providerConfig: AiProviderConfig): Promise<PartialModelEntry[]>;
}
