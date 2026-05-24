import { createDeterministicRandom, type DeterministicRandom } from './prng.js';
import { createDefaultPackSeed, deriveSeed, type SeedPart } from './seed.js';

export const DETERMINISM_MODES = ['off', 'record', 'replay', 'strict'] as const;
export type DeterminismMode = (typeof DETERMINISM_MODES)[number];

export interface DeterminismContextOptions {
  packId: string;
  baseSeed: string;
  mode?: DeterminismMode;
  parts?: SeedPart[];
}

export class DeterminismContext {
  public readonly packId: string;
  public readonly baseSeed: string;
  public readonly mode: DeterminismMode;
  private readonly parts: SeedPart[];

  public constructor(options: DeterminismContextOptions) {
    this.packId = options.packId;
    this.baseSeed = options.baseSeed;
    this.mode = options.mode ?? 'off';
    this.parts = [...(options.parts ?? [])];
  }

  public derive(...parts: SeedPart[]): DeterminismContext {
    return new DeterminismContext({
      packId: this.packId,
      baseSeed: this.baseSeed,
      mode: this.mode,
      parts: [...this.parts, ...parts]
    });
  }

  public forTick(tick: string | number | bigint): DeterminismContext {
    return this.derive('tick', tick);
  }

  public forStep(step: string | number): DeterminismContext {
    return this.derive('step', step);
  }

  public forSubsystem(name: string): DeterminismContext {
    return this.derive('subsystem', name);
  }

  public forPurpose(purpose: string, stableKey?: SeedPart): DeterminismContext {
    return stableKey === undefined
      ? this.derive('purpose', purpose)
      : this.derive('purpose', purpose, 'key', stableKey);
  }

  public getSeed(): string {
    return deriveSeed(this.baseSeed, 'pack', this.packId, ...this.parts);
  }

  public random(): DeterministicRandom {
    return createDeterministicRandom(this.getSeed());
  }

  public describe(): { packId: string; baseSeed: string; mode: DeterminismMode; seed: string; parts: SeedPart[] } {
    return {
      packId: this.packId,
      baseSeed: this.baseSeed,
      mode: this.mode,
      seed: this.getSeed(),
      parts: [...this.parts]
    };
  }
}

export const createDeterminismContext = (options: DeterminismContextOptions): DeterminismContext =>
  new DeterminismContext(options);

export interface DeterminismConfig {
  enabled: boolean;
  seed: string;
  strict: boolean;
}

export const resolvePackDeterminismConfig = (
  packId: string,
  explicitSeed?: string | null,
  explicitStrict?: boolean
): DeterminismConfig => {
  const seed = explicitSeed?.trim() || createDefaultPackSeed(packId);
  const strict = explicitStrict ?? false;
  return { enabled: true, seed, strict };
};
