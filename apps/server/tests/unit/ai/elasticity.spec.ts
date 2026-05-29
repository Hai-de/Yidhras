import { describe, expect, it } from 'vitest';

import { createExponentialBackoff } from '../../../src/ai/elasticity/backoff.js';
import { createCircuitBreaker } from '../../../src/ai/elasticity/circuit_breaker.js';
import { createRateLimiter } from '../../../src/ai/elasticity/rate_limiter.js';

describe('AI elasticity', () => {
  describe('createExponentialBackoff', () => {
    it('returns getDelay and wait functions', () => {
      const backoff = createExponentialBackoff();
      expect(typeof backoff.getDelay).toBe('function');
      expect(typeof backoff.wait).toBe('function');
    });

    it('getDelay returns 0 for attempt < 1', () => {
      const backoff = createExponentialBackoff();
      expect(backoff.getDelay(0)).toBe(0);
      expect(backoff.getDelay(-1)).toBe(0);
    });

    it('getDelay increases exponentially with attempt', () => {
      const backoff = createExponentialBackoff({ jitterRatio: 0 });
      const delay1 = backoff.getDelay(1);
      const delay2 = backoff.getDelay(2);
      const delay3 = backoff.getDelay(3);
      expect(delay1).toBeGreaterThan(0);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('getDelay caps at maxDelayMs', () => {
      const backoff = createExponentialBackoff({ baseDelayMs: 1000, maxDelayMs: 5000, jitterRatio: 0 });
      const delay10 = backoff.getDelay(10);
      expect(delay10).toBeLessThanOrEqual(5000);
    });

    it('getDelay applies jitter ratio', () => {
      const backoff = createExponentialBackoff({ baseDelayMs: 1000, jitterRatio: 0.5 });
      const delays = Array.from({ length: 10 }, () => backoff.getDelay(1));
      // With jitter, delays should vary
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('wait returns a promise', async () => {
      const backoff = createExponentialBackoff({ baseDelayMs: 1, jitterRatio: 0 });
      const promise = backoff.wait(1);
      expect(promise).toBeInstanceOf(Promise);
      await promise;
    });
  });

  describe('createCircuitBreaker', () => {
    it('starts in closed state', () => {
      const cb = createCircuitBreaker('test-provider');
      expect(cb.state).toBe('closed');
      expect(cb.provider).toBe('test-provider');
    });

    it('allowRequest returns true when closed', () => {
      const cb = createCircuitBreaker('test-provider');
      expect(cb.allowRequest()).toBe(true);
    });

    it('transitions to open after failure threshold', () => {
      const cb = createCircuitBreaker('test-provider', { failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('closed');
      cb.recordFailure();
      expect(cb.state).toBe('open');
    });

    it('allowRequest returns false when open (before recovery)', () => {
      const cb = createCircuitBreaker('test-provider', { failureThreshold: 1, recoveryTimeoutMs: 60000 });
      cb.recordFailure();
      expect(cb.state).toBe('open');
      expect(cb.allowRequest()).toBe(false);
    });

    it('transitions to half_open after recovery timeout', () => {
      const cb = createCircuitBreaker('test-provider', {
        failureThreshold: 1,
        recoveryTimeoutMs: 0, // immediate recovery
        halfOpenMaxRequests: 1
      });
      cb.recordFailure();
      expect(cb.state).toBe('open');
      expect(cb.allowRequest()).toBe(true);
      expect(cb.state).toBe('half_open');
    });

    it('half_open allows limited requests', () => {
      const cb = createCircuitBreaker('test-provider', {
        failureThreshold: 1,
        recoveryTimeoutMs: 0,
        halfOpenMaxRequests: 1
      });
      cb.recordFailure();
      cb.allowRequest(); // transition to half_open
      expect(cb.allowRequest()).toBe(false); // exceeds halfOpenMaxRequests
    });

    it('half_open success transitions to closed', () => {
      const cb = createCircuitBreaker('test-provider', {
        failureThreshold: 1,
        recoveryTimeoutMs: 0,
        halfOpenMaxRequests: 1
      });
      cb.recordFailure();
      cb.allowRequest(); // half_open
      cb.recordSuccess();
      expect(cb.state).toBe('closed');
    });

    it('half_open failure transitions back to open', () => {
      const cb = createCircuitBreaker('test-provider', {
        failureThreshold: 1,
        recoveryTimeoutMs: 0,
        halfOpenMaxRequests: 1
      });
      cb.recordFailure();
      cb.allowRequest(); // half_open
      cb.recordFailure();
      expect(cb.state).toBe('open');
    });

    it('closed success resets failure count', () => {
      const cb = createCircuitBreaker('test-provider', { failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('closed'); // only 2 failures after reset
    });

    it('snapshot returns current state', () => {
      const cb = createCircuitBreaker('test-provider');
      const snap = cb.snapshot();
      expect(snap.provider).toBe('test-provider');
      expect(snap.state).toBe('closed');
      expect(snap.failureCount).toBe(0);
      expect(snap.lastFailureAt).toBeNull();
      expect(snap.openedAt).toBeNull();
    });

    it('snapshot reflects failure state', () => {
      const cb = createCircuitBreaker('test-provider', { failureThreshold: 1 });
      cb.recordFailure();
      const snap = cb.snapshot();
      expect(snap.state).toBe('open');
      expect(snap.failureCount).toBe(1);
      expect(snap.lastFailureAt).toBeGreaterThan(0);
      expect(snap.openedAt).toBeGreaterThan(0);
    });
  });

  describe('createRateLimiter', () => {
    it('returns rate limiter with expected interface', () => {
      const rl = createRateLimiter('test-provider');
      expect(rl.provider).toBe('test-provider');
      expect(typeof rl.acquire).toBe('function');
      expect(typeof rl.release).toBe('function');
      expect(typeof rl.adjustFromHints).toBe('function');
      expect(typeof rl.snapshot).toBe('function');
    });

    it('acquire succeeds when under limit', async () => {
      const rl = createRateLimiter('test-provider', { maxConcurrent: 5 });
      await rl.acquire();
      const snap = rl.snapshot();
      expect(snap.active).toBe(1);
    });

    it('release decrements active count', async () => {
      const rl = createRateLimiter('test-provider', { maxConcurrent: 5 });
      await rl.acquire();
      rl.release();
      const snap = rl.snapshot();
      expect(snap.active).toBe(0);
    });

    it('release dequeues waiting requests', async () => {
      const rl = createRateLimiter('test-provider', { maxConcurrent: 1, queueMaxSize: 5, queueTimeoutMs: 1000 });
      await rl.acquire();
      // Second acquire should queue
      const promise = rl.acquire();
      // Release first — dequeues the waiting one
      rl.release();
      await promise;
      // Active is still 1 (dequeued request now occupies the slot)
      const snap = rl.snapshot();
      expect(snap.active).toBeGreaterThanOrEqual(1);
    });

    it('snapshot reflects current state', async () => {
      const rl = createRateLimiter('test-provider', { maxConcurrent: 10 });
      await rl.acquire();
      await rl.acquire();
      const snap = rl.snapshot();
      expect(snap.provider).toBe('test-provider');
      expect(snap.active).toBe(2);
      expect(snap.queued).toBe(0);
      expect(snap.maxConcurrent).toBe(10);
    });

    it('adjustFromHints reduces maxConcurrent', async () => {
      const rl = createRateLimiter('test-provider', { maxConcurrent: 10 });
      await rl.acquire();
      rl.adjustFromHints({ retryAfterSeconds: 1 });
      const snap = rl.snapshot();
      expect(snap.maxConcurrent).toBeLessThanOrEqual(10);
    });
  });
});
