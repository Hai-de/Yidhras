import { ApiError } from '../../utils/api_error.js';
import type { RateLimiter, RateLimiterConfig, RateLimiterSnapshot,RateLimitHints } from './types.js';
import { DEFAULT_RL_CONFIG } from './types.js';

interface QueueEntry {
  resolve: () => void;
  reject: (err: ApiError) => void;
  timer: NodeJS.Timeout;
}

const RAMP_STEP_INTERVAL_MS = 60_000; // 每次升压间隔
const RAMP_STEP_SIZE = 1;              // 每次升压 +1

export const createRateLimiter = (
  provider: string,
  config?: Partial<RateLimiterConfig>,
): RateLimiter => {
  const resolved: RateLimiterConfig = {
    ...DEFAULT_RL_CONFIG,
    ...config,
  };

  const originalMax = resolved.maxConcurrent;
  let active = 0;
  const queue: QueueEntry[] = [];
  let rampTimer: NodeJS.Timeout | null = null;
  let targetMax = originalMax;

  const clearRampTimer = () => {
    if (rampTimer) {
      clearInterval(rampTimer);
      rampTimer = null;
    }
  };

  const scheduleRampUp = () => {
    clearRampTimer();
    rampTimer = setInterval(() => {
      if (resolved.maxConcurrent >= targetMax) {
        clearRampTimer();
        rampTimer = null;
        return;
      }
      resolved.maxConcurrent = Math.min(resolved.maxConcurrent + RAMP_STEP_SIZE, targetMax);
    }, RAMP_STEP_INTERVAL_MS);
    rampTimer.unref(); // 不阻止进程退出
  };

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

  const adjustFromHints = (hints: RateLimitHints): void => {
    const retryAfter = hints.retryAfterSeconds ?? 30;

    // 立即降级：maxConcurrent 降到 max(1, active)
    resolved.maxConcurrent = Math.max(1, active);

    // 冷却后恢复到原值 50%，再逐步升压
    targetMax = Math.max(1, Math.ceil(originalMax / 2));

    clearRampTimer();

    // 冷却期后开始升压
    rampTimer = setTimeout(() => {
      resolved.maxConcurrent = targetMax;
      targetMax = originalMax;
      scheduleRampUp();
    }, retryAfter * 1000);
    rampTimer.unref();
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
    adjustFromHints,
    snapshot,
  };
};
