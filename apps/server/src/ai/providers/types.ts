import type {
  AiModelRegistryEntry,
  AiProviderConfig,
  AiResolvedTaskConfig,
  AiTaskRequest,
  ModelGatewayRequest,
  ModelGatewayResponse
} from '../types.js';

export type AiProviderAdapterResult = Pick<
  ModelGatewayResponse,
  'status' | 'finish_reason' | 'output' | 'usage' | 'safety' | 'raw_ref' | 'error'
>;

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
}
