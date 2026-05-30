#!/usr/bin/env node
/**
 * sim replay CLI — deterministic replay harness.
 *
 * Usage:
 *   pnpm --filter yidhras-server sim:replay <packId> --seed <seed> --ticks <n> [--runs <n>]
 *
 * Connects to a running Yidhras server to run replay verification.
 * Requires the server to be running with determinism configured for the target pack.
 */

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TICKS = 5;
const DEFAULT_RUNS = 2;

interface ReplayArgs {
  packId?: string;
  seed?: string;
  ticks: number;
  runs: number;
  baseUrl: string;
  help?: boolean;
}

const parseArgs = (argv: string[]): ReplayArgs => {
  const parsed: ReplayArgs = {
    ticks: DEFAULT_TICKS,
    runs: DEFAULT_RUNS,
    baseUrl: process.env['YIDHRAS_BASE_URL'] ?? DEFAULT_BASE_URL
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--seed':
        parsed.seed = argv[++i]!;
        break;
      case '--ticks':
        parsed.ticks = Number(argv[++i]!);
        break;
      case '--runs':
        parsed.runs = Number(argv[++i]!);
        break;
      case '--base-url':
        parsed.baseUrl = argv[++i]!;
        break;
      default:
        if (!arg.startsWith('-') && !parsed.packId) {
          parsed.packId = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`sim replay — Deterministic replay harness

Usage:
  pnpm --filter yidhras-server sim:replay <packId> --seed <seed> [--ticks <n>] [--runs <n>]

Options:
  --seed <s>     Deterministic seed (required)
  --ticks <n>    Number of ticks to run (default: ${DEFAULT_TICKS})
  --runs <n>     Number of repeat runs (default: ${DEFAULT_RUNS})
  --base-url     Server base URL (default: ${DEFAULT_BASE_URL})
  --help, -h     Show this help

Behavior:
  This CLI performs replay verification via the running server:
  1. Runs the simulation for --ticks iterations with the given --seed
  2. Captures state digest after each run
  3. Repeats --runs times
  4. Compares digests — exit 0 if all identical, exit 1 if divergent

Requirements:
  - Server must be running with determinism enabled for the target pack
  - AI provider must be mock/fixed for strict deterministic replay
`);
};

const runReplay = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.packId || !args.seed) {
    printHelp();
    process.exitCode = args.help && !args.packId ? 0 : 1;
    return;
  }

  if (!Number.isInteger(args.ticks) || args.ticks < 1) {
    console.error('--ticks must be a positive integer');
    process.exitCode = 1;
    return;
  }

  if (!Number.isInteger(args.runs) || args.runs < 2) {
    console.error('--runs must be an integer >= 2');
    process.exitCode = 1;
    return;
  }

  console.error(`Replay config: packId=${args.packId} seed=${args.seed} ticks=${args.ticks} runs=${args.runs}`);
  console.error(`Server: ${args.baseUrl}`);

  const digests: string[] = [];

  for (let run = 0; run < args.runs; run++) {
    console.error(`Run ${run + 1}/${args.runs}...`);

    try {
      const response = await fetch(
        `${args.baseUrl}/api/packs/${args.packId}/replay`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seed: args.seed,
            ticks: args.ticks,
            run: run + 1
          })
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Server returned ${response.status}: ${body}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- from-any: fetch boundary
      const data = await response.json() as { digest?: { sha256: string } };
      if (!data.digest?.sha256) {
        throw new Error('Server response missing digest.sha256');
      }

      digests.push(data.digest.sha256);
      console.log(`  digest: ${data.digest.sha256}`);
    } catch (err) {
      console.error(`Run ${run + 1} failed:`, err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
  }

  const baseline = digests[0];
  let allMatch = true;

  for (let i = 1; i < digests.length; i++) {
    if (digests[i] !== baseline) {
      allMatch = false;
      console.error(`DIVERGENCE: run ${i + 1} digest differs from run 1`);
    }
  }

  if (allMatch) {
    console.error(`OK: all ${args.runs} runs produced identical digest ${baseline}`);
  } else {
    console.error('FAIL: digests diverge across runs');
    process.exitCode = 1;
  }
};

runReplay().catch((err: unknown) => {
  console.error('Replay failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
