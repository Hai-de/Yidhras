/**
 * Minimal PRNG for deterministic template macro expansion.
 * Uses mulberry32 for the generator and a simple string hash for seed → u32.
 */
export interface PRNG {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns the seed string this PRNG was created with. */
  getSeed(): string;
}

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const createPRNG = (seed: string): PRNG => {
  const u32 = hashString(seed);
  const next = mulberry32(u32);

  return {
    next,
    getSeed: () => seed
  };
};
