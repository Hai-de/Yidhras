export interface StableJsonOptions {
  ignoredKeys?: readonly string[];
}

type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish };

const normalizeValue = (value: unknown, ignoredKeys: Set<string>): Jsonish => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return String(value);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, ignoredKeys));
  }

  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- YAML config boundary
    const record = value as Record<string, unknown>;
    const normalized: Record<string, Jsonish> = {};
    for (const key of Object.keys(record).sort()) {
      if (ignoredKeys.has(key)) {
        continue;
      }
      // eslint-disable-next-line security/detect-object-injection -- key iteration is from Object.keys, RHS key access is controlled
      normalized[key] = normalizeValue(record[key], ignoredKeys);
    }
    return normalized;
  }

  return `[unstable:${typeof value}]`;
};

export const normalizeForStableJson = (value: unknown, options: StableJsonOptions = {}): Jsonish => {
  return normalizeValue(value, new Set(options.ignoredKeys ?? []));
};

export const stableJsonStringify = (value: unknown, options: StableJsonOptions = {}): string => {
  return JSON.stringify(normalizeForStableJson(value, options));
};
