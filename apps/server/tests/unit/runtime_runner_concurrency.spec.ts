import { describe, expect, it, vi } from 'vitest';

import { runWithConcurrency } from '../../src/app/runtime/runner_concurrency.js';

describe('runWithConcurrency', () => {
  it('processes all items and preserves result order under concurrency', async () => {
    const started: number[] = [];
    const completed: number[] = [];

    const results = await runWithConcurrency([1, 2, 3, 4], 2, async value => {
      started.push(value);
      await new Promise(resolve => setTimeout(resolve, value % 2 === 0 ? 5 : 1));
      completed.push(value);
      return value * 10;
    });

    expect(started.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(results).toEqual([10, 20, 30, 40]);
  });

  it('falls back to single worker when concurrency is invalid or too small', async () => {
    const worker = vi.fn(async (value: number) => value + 1);

    const results = await runWithConcurrency([1, 2, 3], 0, worker);

    expect(results).toEqual([2, 3, 4]);
    expect(worker).toHaveBeenCalledTimes(3);
  });
});
