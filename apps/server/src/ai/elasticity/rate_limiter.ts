import { ApiError } from '../../utils/api_error.js';
import type { RateLimiter, RateLimiterConfig, RateLimiterSnapshot } from './types.js';
import { DEFAULT_RL_CONFIG } from './types.js';

interface QueueEntry {
  resolve: () => void;
  reject: (err: ApiError) => void;
  timer: NodeJS.Timeout;
}

export const createRateLimiter = (
  provider: string,
  config?: Partial<RateLimiterConfig>,
): RateLimiter => {
  const resolved: RateLimiterConfig = {
    ...DEFAULT_RL_CONFIG,
    ...config,
  };

  let active = 0;
  const queue: QueueEntry[] = [];

  const dequeue = (): void => {
    const entry = queue.shift();
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve();
    }
  };

  const acquire = async (): Promise<void> => {
    if (active < resolved.maxConcurrent) {
      active += 1;
      return;
    }

    if (queue.length >= resolved.queueMaxSize) {
      throw new ApiError(
        503,
        'AI_RATE_LIMIT_QUEUE_FULL',
        `AI provider ${provider} rate limit queue is full (max ${String(resolved.queueMaxSize)})`,
        { provider, active, queued: queue.length, maxConcurrent: resolved.maxConcurrent },
      );
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = queue.findIndex(entry => entry.timer === timer);
        if (index !== -1) {
          queue.splice(index, 1);
        }

        reject(
          new ApiError(
            503,
            'AI_RATE_LIMIT_QUEUE_TIMEOUT',
            `AI provider ${provider} rate limit queue wait timed out after ${String(resolved.queueTimeoutMs)}ms`,
            { provider, active, queued: queue.length, maxConcurrent: resolved.maxConcurrent },
          ),
        );
      }, resolved.queueTimeoutMs);

      queue.push({
        resolve: () => {
          active += 1;
          resolve();
        },
        reject,
        timer,
      });
    });
  };

  const release = (): void => {
    if (queue.length > 0) {
      dequeue();
    } else {
      active = Math.max(0, active - 1);
    }
  };

  const snapshot = (): RateLimiterSnapshot => ({
    provider,
    active,
    queued: queue.length,
    maxConcurrent: resolved.maxConcurrent,
  });

  return {
    get provider() {
      return provider;
    },
    acquire,
    release,
    snapshot,
  };
};
