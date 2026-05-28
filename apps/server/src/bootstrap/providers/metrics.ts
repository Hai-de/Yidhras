 
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const metricsInitProvider: ServiceProvider = {
  provide: TOKENS.metricsInit,
  useFactory: () => {
    return { initialized: true };
  }
};
