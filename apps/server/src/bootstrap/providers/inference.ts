/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import { createInferenceProviders } from '../../app/composition/inference.js';
import type { AppContext } from '../../app/context.js';
import type { InferenceProvider } from '../../inference/provider.js';
import { createInferenceService } from '../../inference/service.js';
import { createPrismaInferenceTraceSink } from '../../inference/sinks/prisma.js';
import type { InferenceTraceSink } from '../../inference/trace_sink.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const inferenceProvidersProvider: ServiceProvider = {
  provide: TOKENS.inferenceProviders,
  deps: [TOKENS.appContext],
  useFactory: (deps) => {
    const { appContext } = deps as unknown as { appContext: AppContext };
    return createInferenceProviders({ context: appContext });
  }
};

export const inferenceTraceSinkProvider: ServiceProvider = {
  provide: TOKENS.inferenceTraceSink,
  deps: [TOKENS.appContext],
  useFactory: (deps) => {
    const { appContext } = deps as unknown as { appContext: AppContext };
    return createPrismaInferenceTraceSink(appContext);
  }
};

export const inferenceServiceProvider: ServiceProvider = {
  provide: TOKENS.inferenceService,
  deps: [TOKENS.appContext, TOKENS.inferenceProviders, TOKENS.inferenceTraceSink],
  useFactory: (deps) => {
    const { appContext, inferenceProviders, inferenceTraceSink } = deps as unknown as {
      appContext: AppContext;
      inferenceProviders: InferenceProvider[];
      inferenceTraceSink: InferenceTraceSink;
    };
    return createInferenceService({
      context: appContext,
      providers: inferenceProviders,
      traceSink: inferenceTraceSink
    });
  }
};
