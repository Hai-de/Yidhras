import type { AppInfrastructure } from '../app/context.js';
import type { InferenceContext, InferencePackRuntimeContract, InferenceRequestInput } from './types.js';

export interface BuildInferenceContextForPackInput extends InferenceRequestInput {
  pack_id: string;
  mode: 'stable' | 'experimental';
}

export interface PackRuntimeContractResolver {
  resolvePackRuntimeContract(
    context: AppInfrastructure,
    input: {
      pack_id: string;
      mode: 'stable' | 'experimental';
    }
  ): Promise<InferencePackRuntimeContract>;
}

export interface PackScopedInferenceContextBuilder {
  buildForPack(context: AppInfrastructure, input: BuildInferenceContextForPackInput): Promise<InferenceContext>;
}
