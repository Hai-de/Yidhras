/**
 * IPC latency profiler for Node.js ↔ Rust sidecar (stdio + JSON-RPC 2.0).
 *
 * Measures raw transport overhead by benchmarking health.get (small payload,
 * minimal Rust processing) and prepareStep/commitPreparedStep (realistic payload).
 *
 * Usage:
 *   pnpm --filter yidhras-server exec tsx scripts/profile_ipc.ts [--iterations N] [--json] [--skip-pack]
 */

import { WorldEngineSidecarClient } from '../src/app/runtime/sidecar/world_engine_sidecar_client.js';

const DEATH_NOTE_PACK_ID = 'world-death-note';
const DEATH_NOTE_PACK_REF = 'death_note';
const DEFAULT_ITERATIONS = 100;

// ── stats helpers ──────────────────────────────────────────────

interface TimingSample {
  method: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

interface MethodStats {
  method: string;
  count: number;
  failures: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
};

const computeStats = (samples: TimingSample[], method: string): MethodStats => {
  const methodSamples = samples.filter((s) => s.method === method && s.success);
  const failures = samples.filter((s) => s.method === method && !s.success).length;
  const durations = methodSamples.map((s) => s.durationMs).sort((a, b) => a - b);

  if (durations.length === 0) {
    return { method, count: 0, failures, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }

  const sum = durations.reduce((a, b) => a + b, 0);
  return {
    method,
    count: durations.length,
    failures,
    minMs: durations[0],
    maxMs: durations[durations.length - 1],
    avgMs: Math.round((sum / durations.length) * 1000) / 1000,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99)
  };
};

const timeCall = async <T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> => {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
};

const printTable = (stats: MethodStats[]): void => {
  const h = `${'Method'.padEnd(32)} ${'Count'.padStart(6)} ${'Avg'.padStart(8)} ${'Min'.padStart(8)} ${'Max'.padStart(8)} ${'P50'.padStart(8)} ${'P95'.padStart(8)} ${'P99'.padStart(8)} ${'Err'.padStart(5)}`;
  console.log(h);
  console.log('-'.repeat(h.length));

  for (const s of stats) {
    const ms = (v: number) => v.toFixed(3).padStart(8);
    console.log(
      `${s.method.padEnd(32)} ${String(s.count).padStart(6)} ${ms(s.avgMs)} ${ms(s.minMs)} ${ms(s.maxMs)} ${ms(s.p50Ms)} ${ms(s.p95Ms)} ${ms(s.p99Ms)} ${String(s.failures).padStart(5)}`
    );
  }
};

// ── main ───────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const iterations = (() => {
    const idx = args.indexOf('--iterations');
    if (idx >= 0 && idx + 1 < args.length) {
      const v = parseInt(args[idx + 1], 10);
      if (v > 0) return v;
    }
    return DEFAULT_ITERATIONS;
  })();
  const jsonOutput = args.includes('--json');
  const skipPack = args.includes('--skip-pack');

  console.error(`\n=== IPC Profiling (${iterations} iterations per method) ===`);
  console.error(`Transport: stdio pipe + JSON-RPC 2.0 (newline-delimited)`);
  console.error(`Rust binary: debug build`);
  console.error('');

  const samples: TimingSample[] = [];
  const record = async (method: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      const { durationMs } = await timeCall(fn);
      samples.push({ method, durationMs, success: true });
    } catch (err) {
      samples.push({
        method,
        durationMs: 0,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };

  // ── Phase 1: Raw transport latency (health.get, no pack needed) ──

  console.error('--- Phase 1: Raw transport latency (health.get, small payload) ---');
  const sidecar = new WorldEngineSidecarClient();

  // Warmup
  console.error('Starting sidecar + handshake...');
  await sidecar.start();
  console.error('Warmup (5 iterations)...');
  for (let i = 0; i < 5; i++) {
    await sidecar.getHealth();
  }

  // Benchmark health.get
  console.error(`Benchmarking world.health.get (${iterations} iterations)...`);
  for (let i = 0; i < iterations; i++) {
    await record('world.health.get', () => sidecar.getHealth());
  }

  // ── Phase 2: Realistic payload (prepare + commit) ──

  if (!skipPack) {
    console.error(`\n--- Phase 2: Realistic payload (prepareStep + commitPreparedStep) ---`);

    // Load pack with minimal hydration (empty snapshot is fine for profiling)
    console.error('Loading pack (no hydrate, empty initial state)...');
    const loadResult = await timeCall(() =>
      sidecar.loadPack({
        pack_id: DEATH_NOTE_PACK_ID,
        pack_ref: DEATH_NOTE_PACK_REF,
        mode: 'active'
      })
    );
    console.error(`  pack.load: ${loadResult.durationMs.toFixed(3)}ms`);

    // Benchmark queryState
    console.error(`Benchmarking world.state.query (${iterations} iterations)...`);
    for (let i = 0; i < iterations; i++) {
      await record('world.state.query', () =>
        sidecar.queryState({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: DEATH_NOTE_PACK_ID,
          query_name: 'pack_summary',
          selector: {}
        })
      );
    }

    // Benchmark prepareStep + abort cycle (no state accumulation)
    console.error(`Benchmarking prepare+abort cycle (${iterations} iterations)...`);
    for (let i = 0; i < iterations; i++) {
      const { result: prepared, durationMs: prepMs } = await timeCall(() =>
        sidecar.prepareStep({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: DEATH_NOTE_PACK_ID,
          step_ticks: '1',
          reason: 'profiling'
        })
      );
      samples.push({ method: 'world.step.prepare', durationMs: prepMs, success: true });

      await record('world.step.abort', () =>
        sidecar.abortPreparedStep({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: DEATH_NOTE_PACK_ID,
          prepared_token: prepared.prepared_token,
          reason: 'profiling-cleanup'
        })
      );
    }

    // Benchmark commit cycle (prepare + commit, clock actually advances)
    console.error(`Benchmarking prepare+commit cycle (${iterations} iterations)...`);
    for (let i = 0; i < iterations; i++) {
      const { result: prepared, durationMs: prepMs } = await timeCall(() =>
        sidecar.prepareStep({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: DEATH_NOTE_PACK_ID,
          step_ticks: '1',
          reason: 'profiling-commit'
        })
      );
      samples.push({ method: 'world.step.prepare', durationMs: prepMs, success: true });

      await record('world.step.commit', () =>
        sidecar.commitPreparedStep({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: DEATH_NOTE_PACK_ID,
          prepared_token: prepared.prepared_token,
          persisted_revision: prepared.next_revision,
          correlation_id: 'profiling-commit'
        })
      );
    }

    await sidecar.unloadPack({ pack_id: DEATH_NOTE_PACK_ID });
  }

  await sidecar.stop();

  // ── Report ─────────────────────────────────────────────────────

  const methods = [...new Set(samples.map((s) => s.method))];
  const allStats = methods.map((m) => computeStats(samples, m));

  const totalOk = samples.filter((s) => s.success).length;
  const totalErr = samples.filter((s) => !s.success).length;
  const totalTime = samples.reduce((s, x) => s + x.durationMs, 0);

  const meta = {
    iterations,
    total_calls: totalOk + totalErr,
    total_ok: totalOk,
    total_failures: totalErr,
    total_rpc_ms: Math.round(totalTime * 1000) / 1000,
    transport: 'stdio_jsonrpc',
    protocol: 'jsonrpc_2.0_newline_delimited',
    rust_binary: 'world_engine_sidecar (debug build)'
  };

  if (jsonOutput) {
    console.log(JSON.stringify({ meta, methods: allStats }, null, 2));
  } else {
    console.log('');
    printTable(allStats);
    console.log('');

    const avgHealth = allStats.find((s) => s.method === 'world.health.get')?.avgMs ?? 0;
    const avgPrepare = allStats.find((s) => s.method === 'world.step.prepare')?.avgMs ?? 0;
    const avgCommit = allStats.find((s) => s.method === 'world.step.commit')?.avgMs ?? 0;
    const avgAbort = allStats.find((s) => s.method === 'world.step.abort')?.avgMs ?? 0;

    console.log('=== Analysis ===');
    console.log(`  Raw transport floor (health.get):      ${avgHealth.toFixed(3)}ms`);
    console.log(`  Simulation step (prepare+commit):       ${(avgPrepare + avgCommit).toFixed(3)}ms`);
    console.log(`  Abort path (prepare+abort):             ${(avgPrepare + avgAbort).toFixed(3)}ms`);

    if (avgHealth > 0) {
      const rustComputeInStep = (avgPrepare + avgCommit) - 2 * avgHealth; // subtract transport floor
      console.log(`  Estimated Rust compute in step:         ${Math.max(0, rustComputeInStep).toFixed(3)}ms (step total minus 2× transport floor)`);
    }

    console.log('');
    console.log('=== Per-tick IPC overhead at various tick rates ===');
    const perTickIpc = avgPrepare + avgCommit;
    for (const tps of [10, 20, 50, 100]) {
      const msPerSec = perTickIpc * tps;
      const pct = (msPerSec / 1000) * 100;
      console.log(`  ${String(tps).padStart(3)} ticks/s → ${msPerSec.toFixed(1)}ms IPC/s (${pct.toFixed(1)}% of wall clock)`);
    }

    console.log('');
    console.log(`Total RPC time: ${meta.total_rpc_ms.toFixed(1)}ms across ${totalOk} successful calls`);
    console.log(`Average across all methods: ${(totalTime / totalOk).toFixed(3)}ms/call`);
  }

  if (totalErr > 0) {
    const failures = samples.filter((s) => !s.success);
    console.error(`\n${totalErr} failures:`);
    for (const f of failures.slice(0, 10)) {
      console.error(`  [${f.method}] ${f.error}`);
    }
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error('Profiling failed:', err);
  process.exitCode = 2;
});
