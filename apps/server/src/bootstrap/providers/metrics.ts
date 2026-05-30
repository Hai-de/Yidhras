import { TOKENS } from '../tokens.js';

export const metricsInitProvider = {
  provide: TOKENS.metricsInit,
  useFactory: () => {
    return { initialized: true };
  }
} as const satisfies import('../provider.js').ServiceProvider;
