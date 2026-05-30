import { createInferenceProviders } from '../../app/composition/inference.js';
import { createInferenceService } from '../../inference/service.js';
import { createPrismaInferenceTraceSink } from '../../inference/sinks/prisma.js';
import { TOKENS } from '../tokens.js';

export const inferenceProvidersProvider = {
  provide: TOKENS.inferenceProviders,
  deps: [TOKENS.appContext] as const,
  useFactory: (deps) => createInferenceProviders({ context: deps.appContext })
} as const satisfies import('../provider.js').ServiceProvider;

export const inferenceTraceSinkProvider = {
  provide: TOKENS.inferenceTraceSink,
  deps: [TOKENS.appContext] as const,
  useFactory: (deps) => createPrismaInferenceTraceSink(deps.appContext)
} as const satisfies import('../provider.js').ServiceProvider;

export const inferenceServiceProvider = {
  provide: TOKENS.inferenceService,
  deps: [TOKENS.appContext, TOKENS.inferenceProviders, TOKENS.inferenceTraceSink] as const,
  useFactory: (deps) => createInferenceService({
    context: deps.appContext,
    providers: deps.inferenceProviders,
    traceSink: deps.inferenceTraceSink
  })
} as const satisfies import('../provider.js').ServiceProvider;
