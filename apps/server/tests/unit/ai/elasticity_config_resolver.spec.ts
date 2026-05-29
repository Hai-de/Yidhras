import { describe, expect, it } from 'vitest';

import { resolveCircuitBreakerConfig, resolveRateLimiterConfig, resolveBackoffConfig } from '../../../src/ai/elasticity/config_resolver.js';

describe('elasticity/config_resolver', () => {
  describe('resolveCircuitBreakerConfig', () => {
    it('returns empty object when defaults is undefined', () => {
      expect(resolveCircuitBreakerConfig(undefined)).toEqual({});
    });

    it('returns empty object when circuit_breaker is absent', () => {
      expect(resolveCircuitBreakerConfig({} as any)).toEqual({});
    });

    it('maps failure_threshold', () => {
      const result = resolveCircuitBreakerConfig({
        circuit_breaker: { failure_threshold: 10 }
      } as any);
      expect(result.failureThreshold).toBe(10);
    });

    it('maps recovery_timeout_ms', () => {
      const result = resolveCircuitBreakerConfig({
        circuit_breaker: { recovery_timeout_ms: 5000 }
      } as any);
      expect(result.recoveryTimeoutMs).toBe(5000);
    });

    it('maps both fields together', () => {
      const result = resolveCircuitBreakerConfig({
        circuit_breaker: { failure_threshold: 3, recovery_timeout_ms: 10000 }
      } as any);
      expect(result.failureThreshold).toBe(3);
      expect(result.recoveryTimeoutMs).toBe(10000);
    });

    it('returns empty when circuit_breaker has no fields', () => {
      const result = resolveCircuitBreakerConfig({
        circuit_breaker: {}
      } as any);
      expect(result).toEqual({});
    });
  });

  describe('resolveRateLimiterConfig', () => {
    it('returns empty object when defaults is undefined', () => {
      expect(resolveRateLimiterConfig(undefined)).toEqual({});
    });

    it('returns empty object when rate_limit is absent', () => {
      expect(resolveRateLimiterConfig({} as any)).toEqual({});
    });

    it('maps max_concurrent', () => {
      const result = resolveRateLimiterConfig({
        rate_limit: { max_concurrent: 5 }
      } as any);
      expect(result.maxConcurrent).toBe(5);
    });

    it('returns empty when rate_limit has no fields', () => {
      const result = resolveRateLimiterConfig({
        rate_limit: {}
      } as any);
      expect(result).toEqual({});
    });
  });

  describe('resolveBackoffConfig', () => {
    it('returns empty object when defaults is undefined', () => {
      expect(resolveBackoffConfig(undefined)).toEqual({});
    });

    it('returns empty object when backoff is absent', () => {
      expect(resolveBackoffConfig({} as any)).toEqual({});
    });

    it('maps base_delay_ms', () => {
      const result = resolveBackoffConfig({
        backoff: { base_delay_ms: 200 }
      } as any);
      expect(result.baseDelayMs).toBe(200);
    });

    it('maps max_delay_ms', () => {
      const result = resolveBackoffConfig({
        backoff: { max_delay_ms: 10000 }
      } as any);
      expect(result.maxDelayMs).toBe(10000);
    });

    it('maps both fields together', () => {
      const result = resolveBackoffConfig({
        backoff: { base_delay_ms: 100, max_delay_ms: 5000 }
      } as any);
      expect(result.baseDelayMs).toBe(100);
      expect(result.maxDelayMs).toBe(5000);
    });

    it('returns empty when backoff has no fields', () => {
      const result = resolveBackoffConfig({
        backoff: {}
      } as any);
      expect(result).toEqual({});
    });
  });
});
