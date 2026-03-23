import { ApiError } from '../../utils/api_error.js';

export const parsePositiveStepTicks = (value: unknown): bigint => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be a safe integer');
    }

    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be greater than 0');
    }
    return parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must not be empty');
    }

    try {
      const parsed = BigInt(trimmed);
      if (parsed <= 0n) {
        throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be greater than 0');
      }
      return parsed;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be a valid integer string');
    }
  }

  throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be a number or string');
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
