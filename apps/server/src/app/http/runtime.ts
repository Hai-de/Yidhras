import type { StepStrategy } from '../../core/step_strategy.js';
import { ApiError } from '../../utils/api_error.js';

const parseBigInt = (value: unknown): bigint => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new ApiError(400, 'STRATEGY_INVALID', 'range value must be a safe integer');
    }
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new ApiError(400, 'STRATEGY_INVALID', 'range value must be greater than 0');
    }
    return parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ApiError(400, 'STRATEGY_INVALID', 'range value must not be empty');
    }
    try {
      const parsed = BigInt(trimmed);
      if (parsed <= 0n) {
        throw new ApiError(400, 'STRATEGY_INVALID', 'range value must be greater than 0');
      }
      return parsed;
    } catch {
      throw new ApiError(400, 'STRATEGY_INVALID', 'range value must be a valid integer string');
    }
  }

  throw new ApiError(400, 'STRATEGY_INVALID', 'range value must be a number or string');
};

export const parseStepStrategy = (body: Record<string, unknown>): StepStrategy => {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'STRATEGY_INVALID', 'strategy must be an object');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime-guarded object access
  const strategy = body['strategy'] as Record<string, unknown> | undefined;
  if (!strategy || typeof strategy !== 'object') {
    throw new ApiError(400, 'STRATEGY_INVALID', 'strategy field is required');
  }

  const kind = strategy['kind'];
  if (kind !== 'variable' && kind !== 'adaptive') {
    throw new ApiError(400, 'STRATEGY_INVALID', 'strategy.kind must be variable or adaptive');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime-guarded object access
  const range = strategy['range'] as Record<string, unknown> | undefined;
  if (!range || typeof range !== 'object') {
    throw new ApiError(400, 'STRATEGY_INVALID', 'strategy.range is required');
  }

  const rangeMin = parseBigInt(range['min']);
  const rangeMax = parseBigInt(range['max']);
  if (rangeMin > rangeMax) {
    throw new ApiError(400, 'STRATEGY_INVALID', 'strategy.range.min must not exceed strategy.range.max');
  }

  const loopIntervalMs = typeof strategy['loop_interval_ms'] === 'number' ? strategy['loop_interval_ms'] : 1000;

  const result: StepStrategy = {
    kind,
    range: { min: rangeMin, max: rangeMax },
    loopIntervalMs
  };

  if (kind === 'adaptive') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime-guarded object access
    const adaptive = strategy['adaptive'] as Record<string, unknown> | undefined;
    if (!adaptive || typeof adaptive !== 'object') {
      throw new ApiError(400, 'STRATEGY_INVALID', 'adaptive config is required when kind is adaptive');
    }
    const targetLoopMs = adaptive['target_loop_ms'];
    const scaleUp = adaptive['scale_up_threshold_ms'];
    const scaleDown = adaptive['scale_down_threshold_ms'];
    if (typeof targetLoopMs !== 'number' || typeof scaleUp !== 'number' || typeof scaleDown !== 'number') {
      throw new ApiError(400, 'STRATEGY_INVALID', 'adaptive.target_loop_ms, scale_up_threshold_ms, scale_down_threshold_ms must be numbers');
    }
    result.adaptive = {
      targetLoopMs,
      scaleUpThresholdMs: scaleUp,
      scaleDownThresholdMs: scaleDown
    };
  }

  return result;
};

export const parseOptionalTick = (value: unknown, fieldName: string): bigint | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be greater than 0`);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be a safe integer`);
    }

    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be greater than 0`);
    }
    return parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must not be empty`);
    }

    try {
      const parsed = BigInt(trimmed);
      if (parsed <= 0n) {
        throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be greater than 0`);
      }
      return parsed;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be a valid integer string`);
    }
  }

  throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be a number or string`);
};
