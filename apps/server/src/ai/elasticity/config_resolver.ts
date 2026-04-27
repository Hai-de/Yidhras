import type { AiRouteDefaults } from '../types.js';
import type { BackoffConfig, CircuitBreakerConfig, RateLimiterConfig } from './types.js';

/**
 * 将 AiRouteDefaults 中 snake_case 的 circuit_breaker 字段
 * 映射为内部 camelCase 的 CircuitBreakerConfig 偏量。
 * 未提供的字段返回空对象，由调用方与 DEFAULT_CB_CONFIG 合并。
 */
export function resolveCircuitBreakerConfig(
  defaults?: AiRouteDefaults,
): Partial<CircuitBreakerConfig> {
  const cb = defaults?.circuit_breaker;
  if (!cb) return {};

  const result: Partial<CircuitBreakerConfig> = {};
  if (cb.failure_threshold !== undefined) {
    result.failureThreshold = cb.failure_threshold;
  }
  if (cb.recovery_timeout_ms !== undefined) {
    result.recoveryTimeoutMs = cb.recovery_timeout_ms;
  }
  return result;
}

/**
 * 将 AiRouteDefaults 中 snake_case 的 rate_limit 字段
 * 映射为内部 camelCase 的 RateLimiterConfig 偏量。
 */
export function resolveRateLimiterConfig(
  defaults?: AiRouteDefaults,
): Partial<RateLimiterConfig> {
  const rl = defaults?.rate_limit;
  if (!rl) return {};

  const result: Partial<RateLimiterConfig> = {};
  if (rl.max_concurrent !== undefined) {
    result.maxConcurrent = rl.max_concurrent;
  }
  return result;
}

/**
 * 将 AiRouteDefaults 中 snake_case 的 backoff 字段
 * 映射为内部 camelCase 的 BackoffConfig 偏量。
 */
export function resolveBackoffConfig(
  defaults?: AiRouteDefaults,
): Partial<BackoffConfig> {
  const bo = defaults?.backoff;
  if (!bo) return {};

  const result: Partial<BackoffConfig> = {};
  if (bo.base_delay_ms !== undefined) {
    result.baseDelayMs = bo.base_delay_ms;
  }
  if (bo.max_delay_ms !== undefined) {
    result.maxDelayMs = bo.max_delay_ms;
  }
  return result;
}
