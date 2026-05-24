const hashStringToU32 = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface PRNG {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns the seed string this PRNG was created with. */
  getSeed(): string;
}

export interface DeterministicRandom extends PRNG {
  nextFloat(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  nextBoolean(probability?: number): boolean;
  nextId(prefix?: string, bytes?: number): string;
  pick<T>(items: readonly T[]): T;
}

const assertInteger = (value: number, field: string): void => {
  if (!Number.isInteger(value)) {
    throw new Error(`[determinism/prng] ${field} must be an integer`);
  }
};

const toHexByte = (value: number): string => value.toString(16).padStart(2, '0');

export const createDeterministicRandom = (seed: string): DeterministicRandom => {
  const resolvedSeed = seed.length > 0 ? seed : '<empty-seed>';
  const next = mulberry32(hashStringToU32(resolvedSeed));

  const random: DeterministicRandom = {
    next: () => next(),
    nextFloat: () => next(),
    nextInt: (minInclusive: number, maxInclusive: number): number => {
      assertInteger(minInclusive, 'minInclusive');
      assertInteger(maxInclusive, 'maxInclusive');
      if (maxInclusive < minInclusive) {
        throw new Error('[determinism/prng] maxInclusive must be greater than or equal to minInclusive');
      }
      const span = maxInclusive - minInclusive + 1;
      return minInclusive + Math.floor(next() * span);
    },
    nextBoolean: (probability = 0.5): boolean => {
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error('[determinism/prng] probability must be a finite number in [0, 1]');
      }
      return next() < probability;
    },
    nextId: (prefix = 'id', bytes = 8): string => {
      assertInteger(bytes, 'bytes');
      if (bytes <= 0) {
        throw new Error('[determinism/prng] bytes must be positive');
      }
      const hex = Array.from({ length: bytes }, () => toHexByte(Math.floor(next() * 256))).join('');
      return `${prefix}_${hex}`;
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error('[determinism/prng] cannot pick from an empty array');
      }
      const index = Math.floor(next() * items.length);
      // eslint-disable-next-line security/detect-object-injection -- index is derived from clamped random within bounds
      return items[index];
    },
    getSeed: () => resolvedSeed
  };

  return random;
};

export const createPRNG = (seed: string): PRNG => createDeterministicRandom(seed);
