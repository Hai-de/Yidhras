import type { DataContext, PortContext, RuntimeContext } from '../../app/context.js';
import type { InferenceContext, InferenceRequestInput } from '../types.js';
import { ContextAssemblyPipeline } from './pipeline.js';
import type { PipelineOptions } from './types.js';

type Ctx = DataContext & RuntimeContext & PortContext;

export interface InferenceContextBuilder {
  buildForPack(
    context: Ctx,
    input: InferenceRequestInput & { pack_id: string; mode?: 'stable' | 'experimental' }
  ): Promise<InferenceContext>;
}

export const createInferenceContextBuilder = (
  options?: PipelineOptions
): InferenceContextBuilder => {
  const pipeline = new ContextAssemblyPipeline(options);

  return {
    async buildForPack(context, input) {
      return pipeline.execute(context, input);
    }
  };
};

/**
 * 便捷入口：创建一个 builder 并执行 context 组装。
 * 与旧 `buildInferenceContext` 签名兼容。
 */
export const buildInferenceContext = async (
  context: Ctx,
  input: InferenceRequestInput,
  packId: string
): Promise<InferenceContext> => {
  const builder = createInferenceContextBuilder();
  return builder.buildForPack(context, { ...input, pack_id: packId, mode: 'stable' });
};
