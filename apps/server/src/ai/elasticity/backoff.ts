import type { BackoffConfig, BackoffStrategy } from './types.js';
import { DEFAULT_BACKOFF_CONFIG } from './types.js';

export const createExponentialBackoff = (config?: Partial<BackoffConfig>): BackoffStrategy => {
  const resolved: BackoffConfig = {
    ...DEFAULT_BACKOFF_CONFIG,
    ...config,
  };

  const getDelay = (attempt: number): number => {
    if (attempt < 1) {
      return 0;
    }

    const exponential = Math.min(
      resolved.baseDelayMs * Math.pow(2, attempt - 1),
      resolved.maxDelayMs,
    );

    const jitter = exponential * resolved.jitterRatio * (Math.random() * 2 - 1);
    return Math.round(exponential + jitter);
  };

  const wait = (attempt: number): Promise<void> => {
    const delay = getDelay(attempt);
    return new Promise(resolve => {
      setTimeout(resolve, delay);
    });
  };

  return { getDelay, wait };
};
