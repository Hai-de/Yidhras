const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- from-any: boundary assertion
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
};

const cloneValue = <T>(value: T): T => {
  return typeof value === 'object' && value !== null ? structuredClone(value) : value;
};

export const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> => {
  const result = cloneValue(base);

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

  return result;
};

export const deepMergeAll = (
  base: Record<string, unknown>,
  ...overrides: Record<string, unknown>[]
): Record<string, unknown> => {
  return overrides.reduce<Record<string, unknown>>((acc, override) => deepMerge(acc, override), cloneValue(base));
};
