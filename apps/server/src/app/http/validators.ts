import { ApiError } from '../../utils/api_error.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const validatePolicyConditions = (conditions: unknown): Record<string, unknown> => {
  if (conditions === undefined || conditions === null) {
    return {};
  }

  if (!isPlainObject(conditions)) {
    throw new ApiError(400, 'POLICY_CONDITIONS_INVALID', 'conditions must be an object');
  }

  const isScalarValue = (candidate: unknown): candidate is string | number | boolean | null => {
    return (
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean' ||
      candidate === null
    );
  };

  for (const [key, value] of Object.entries(conditions)) {
    if (key.trim().length === 0) {
      throw new ApiError(400, 'POLICY_CONDITIONS_INVALID', 'conditions key must not be empty');
    }

    const isScalar = isScalarValue(value);
    const isScalarArray = Array.isArray(value) && value.every(isScalarValue);
    if (!isScalar && !isScalarArray) {
      throw new ApiError(400, 'POLICY_CONDITIONS_INVALID', 'conditions value must be scalar or scalar[]');
    }
  }

  return conditions;
};
