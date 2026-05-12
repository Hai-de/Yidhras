import type { ChronosEngine } from '../../src/clock/engine.js';

export const advanceTicks = (clock: ChronosEngine, n: bigint | number): void => {
  const ticks = typeof n === 'number' ? BigInt(n) : n;
  clock.tick(ticks);
};

export const advanceTicksAndGet = (clock: ChronosEngine, n: bigint | number): bigint => {
  advanceTicks(clock, n);
  return clock.getTicks();
};

export const createMockClock = (initialTicks: bigint = 0n): ChronosEngine => {
  let current = initialTicks;

  return {
    tick(ticks: bigint): bigint {
      current += ticks;
      return current;
    },
    getTicks(): bigint {
      return current;
    },
    setTicks(ticks: bigint): void {
      current = ticks;
    },
    getAllTimes(): Array<{ system_name: string; value: string }> {
      return [{ system_name: 'default', value: current.toString() }];
    },
    getCurrentTick(): bigint {
      return current;
    }
  } as ChronosEngine;
};
