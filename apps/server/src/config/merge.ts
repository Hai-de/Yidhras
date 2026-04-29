const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
};

const cloneValue = <T>(value: T): T => {
  return typeof value === 'object' && value !== null ? structuredClone(value) : value;
};

export const deepMerge = <T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>
): T => {
  const result = cloneValue(base) as Record<string, unknown>;

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    const currentValue = result[key];
    if (isPlainObject(currentValue) && isPlainObject(value)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      result[key] = deepMerge(currentValue, value);
      continue;
    }

// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    result[key] = cloneValue(value);
  }

  return result as T;
};

export const deepMergeAll = <T extends Record<string, unknown>>(
  base: T,
  ...overrides: Record<string, unknown>[]
): T => {
  return overrides.reduce<T>((acc, override) => deepMerge(acc, override), cloneValue(base));
};
