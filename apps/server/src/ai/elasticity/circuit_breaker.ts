import type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerSnapshot,
  CircuitBreakerState,
} from './types.js';
import { DEFAULT_CB_CONFIG } from './types.js';

const now = (): number => Date.now();

export const createCircuitBreaker = (
  provider: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker => {
  const resolved: CircuitBreakerConfig = {
    ...DEFAULT_CB_CONFIG,
    ...config,
  };

  let state: CircuitBreakerState = 'closed';
  let failureCount = 0;
  let lastFailureAt: number | null = null;
  let openedAt: number | null = null;
  let activeProbeCount = 0;

  const transitionToOpen = (): void => {
    state = 'open';
    openedAt = now();
  };

  const transitionToHalfOpen = (): void => {
    state = 'half_open';
    failureCount = 0;
    openedAt = null;
    activeProbeCount = 0;
  };

  const transitionToClosed = (): void => {
    state = 'closed';
    failureCount = 0;
    lastFailureAt = null;
    openedAt = null;
    activeProbeCount = 0;
  };

  const resetFailureCountIfWindowExpired = (): void => {
    if (lastFailureAt === null) {
      return;
    }

    const elapsed = now() - lastFailureAt;
    if (elapsed > resolved.monitorWindowMs) {
      failureCount = 0;
      lastFailureAt = null;
    }
  };

  const allowRequest = (): boolean => {
    if (state === 'open') {
      if (openedAt !== null && now() - openedAt >= resolved.recoveryTimeoutMs) {
        transitionToHalfOpen();
        activeProbeCount += 1;
        return true;
      }

      return false;
    }

    if (state === 'half_open') {
      if (activeProbeCount >= resolved.halfOpenMaxRequests) {
        return false;
      }

      activeProbeCount += 1;
      return true;
    }

    // closed
    return true;
  };

  const recordSuccess = (): void => {
    if (state === 'half_open') {
      activeProbeCount = Math.max(0, activeProbeCount - 1);
      transitionToClosed();
      return;
    }

    // closed: reset failure counter on any success
    failureCount = 0;
    lastFailureAt = null;
  };

  const recordFailure = (): void => {
    if (state === 'half_open') {
      activeProbeCount = Math.max(0, activeProbeCount - 1);
      // 探测失败，立即回到 open
      transitionToOpen();
      return;
    }

    resetFailureCountIfWindowExpired();
    failureCount += 1;
    lastFailureAt = now();

    if (failureCount >= resolved.failureThreshold) {
      transitionToOpen();
    }
  };

  const snapshot = (): CircuitBreakerSnapshot => ({
    provider,
    state,
    failureCount,
    lastFailureAt,
    openedAt,
  });

  return {
    get provider() {
      return provider;
    },
    get state() {
      return state;
    },
    allowRequest,
    recordSuccess,
    recordFailure,
    snapshot,
  };
};
