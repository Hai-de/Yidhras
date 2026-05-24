import { expect } from 'vitest';

export function expectDefined<T>(value: T | null | undefined, label: string): T {
  expect(value, label).not.toBeNull();
  expect(value, label).not.toBeUndefined();
  if (value === null || value === undefined) {
    throw new Error(`${label} should be defined`);
  }
  return value;
}

export const expectArrayElement = <T>(items: readonly T[], index: number, label: string): T => {
  expect(items.length, `${label} length`).toBeGreaterThan(index);
  return expectDefined(items[index], `${label}[${String(index)}]`);
};
