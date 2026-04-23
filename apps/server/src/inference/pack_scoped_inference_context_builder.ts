import type { AppContext } from '../app/context.js';
import type { InferenceContext, InferencePackRuntimeContract, InferenceRequestInput } from './types.js';

export interface BuildInferenceContextForPackInput extends InferenceRequestInput {
  pack_id: string;
  mode: 'stable' | 'experimental';
}

export interface PackRuntimeContractResolver {
  resolvePackRuntimeContract(
    context: AppContext,
    input: {
      pack_id: string;
      mode: 'stable' | 'experimental';
    }
  ): Promise<InferencePackRuntimeContract>;
}

export interface PackScopedInferenceContextBuilder {
  buildForPack(context: AppContext, input: BuildInferenceContextForPackInput): Promise<InferenceContext>;
}
