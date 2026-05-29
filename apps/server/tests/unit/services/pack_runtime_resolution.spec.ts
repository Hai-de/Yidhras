import { describe, expect, it } from 'vitest';

import { resolvePackTick } from '../../../src/app/services/pack/pack_runtime_resolution.js';

describe('resolvePackTick', () => {
  it('returns tick from packRuntime when provided', () => {
    const packRuntime = { getCurrentTick: () => 42n };
    expect(resolvePackTick({}, packRuntime)).toBe(42n);
  });

  it('falls back to context.packRuntime when packRuntime not provided', () => {
    const context = { packRuntime: { getCurrentTick: () => 99n } };
    expect(resolvePackTick(context, undefined)).toBe(99n);
  });

  it('falls back to context.packRuntime when packRuntime is null', () => {
    const context = { packRuntime: { getCurrentTick: () => 7n } };
    expect(resolvePackTick(context, null)).toBe(7n);
  });

  it('returns 0n when packRuntime is undefined and context has no packRuntime', () => {
    expect(resolvePackTick({}, undefined)).toBe(0n);
  });

  it('returns 0n when packRuntime is null and context has no packRuntime', () => {
    expect(resolvePackTick({}, null)).toBe(0n);
  });

  it('returns 0n when both are empty/null', () => {
    expect(resolvePackTick({}, null)).toBe(0n);
  });

  it('prefers explicit packRuntime over context', () => {
    const context = { packRuntime: { getCurrentTick: () => 1n } };
    const packRuntime = { getCurrentTick: () => 2n };
    expect(resolvePackTick(context, packRuntime)).toBe(2n);
  });
});
