import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useRuntimeStore } from '../../stores/runtime';

describe('useRuntimeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('has idle status, zero ticks, no errors', () => {
      const runtime = useRuntimeStore();
      expect(runtime.status).toBe('idle');
      expect(runtime.absoluteTicks).toBe('0');
      expect(runtime.runtimeReady).toBe(false);
      expect(runtime.hasStartupErrors).toBe(false);
      expect(runtime.hasRuntimeError).toBe(false);
      expect(runtime.hasDegradedSignals).toBe(false);
    });
  });

  describe('applyClockSnapshot', () => {
    it('updates absolute ticks and calendars', () => {
      const runtime = useRuntimeStore();
      runtime.applyClockSnapshot({
        absolute_ticks: '42',
        calendars: [{ calendar_id: 'default', calendar_name: 'Default', display: 'Cycle 42', units: {} }]
      });
      expect(runtime.absoluteTicks).toBe('42');
      expect(runtime.formattedTicks).toBe('000000042');
      expect(runtime.primaryCalendarTime).toBe('Cycle 42');
      expect(runtime.lastClockSyncedAt).toEqual(expect.any(Number));
    });

    it('pads short tick strings to 9 digits', () => {
      const runtime = useRuntimeStore();
      runtime.applyClockSnapshot({
        absolute_ticks: '999999999',
        calendars: []
      });
      expect(runtime.formattedTicks).toBe('999999999');
    });

    it('sets label to synced after sync', () => {
      const runtime = useRuntimeStore();
      runtime.applyClockSnapshot({ absolute_ticks: '1', calendars: [] });
      expect(runtime.clockFreshnessLabel).toBe('synced');
    });
  });

  describe('applyRuntimeStatusSnapshot', () => {
    it('applies running status with world pack', () => {
      const runtime = useRuntimeStore();
      runtime.applyRuntimeStatusSnapshot({
        status: 'running', runtime_ready: true,
        runtime_speed: { mode: 'fixed', source: 'default', configured_step_ticks: '1', override_step_ticks: null, override_since: null, effective_step_ticks: '3' },
        scheduler: { worker_id: 'w1', partition_count: 4, owned_partition_ids: ['p0'], assignment_source: 'persisted', migration_in_progress_count: 0 },
        health_level: 'ok', world_pack: { id: 'pack-alpha', name: 'Pack Alpha', version: '0.1.0' },
        has_error: false, startup_errors: []
      });
      expect(runtime.status).toBe('running');
      expect(runtime.runtimeReady).toBe(true);
      expect(runtime.worldPack?.name).toBe('Pack Alpha');
      expect(runtime.runtimeSpeed?.effective_step_ticks).toBe('3');
    });

    it('sets status to error when runtime_ready is false', () => {
      const runtime = useRuntimeStore();
      runtime.applyRuntimeStatusSnapshot({
        status: 'running', runtime_ready: false,
        runtime_speed: { mode: 'fixed', source: 'default', configured_step_ticks: '1', override_step_ticks: null, override_since: null, effective_step_ticks: '1' },
        scheduler: { worker_id: 'w1', partition_count: 1, owned_partition_ids: [], assignment_source: 'persisted', migration_in_progress_count: 0 },
        health_level: 'ok', world_pack: { id: 'p', name: 'P', version: '0.1' },
        has_error: false, startup_errors: []
      });
      expect(runtime.status).toBe('error');
    });

    it('detects degraded signals with non-ok health', () => {
      const runtime = useRuntimeStore();
      runtime.applyRuntimeStatusSnapshot({
        status: 'paused', runtime_ready: true,
        runtime_speed: { mode: 'fixed', source: 'default', configured_step_ticks: '1', override_step_ticks: null, override_since: null, effective_step_ticks: '1' },
        scheduler: { worker_id: 'w1', partition_count: 1, owned_partition_ids: [], assignment_source: 'persisted', migration_in_progress_count: 0 },
        health_level: 'fail', world_pack: null,
        has_error: false, startup_errors: []
      });
      expect(runtime.healthLevel).toBe('fail');
      expect(runtime.hasRuntimeError).toBe(true);
      expect(runtime.hasDegradedSignals).toBe(true);
    });

    it('detects degraded signals with startup errors', () => {
      const runtime = useRuntimeStore();
      runtime.applyRuntimeStatusSnapshot({
        status: 'paused', runtime_ready: true,
        runtime_speed: { mode: 'fixed', source: 'default', configured_step_ticks: '1', override_step_ticks: null, override_since: null, effective_step_ticks: '1' },
        scheduler: { worker_id: 'w1', partition_count: 1, owned_partition_ids: [], assignment_source: 'persisted', migration_in_progress_count: 0 },
        health_level: 'ok', world_pack: null,
        has_error: false, startup_errors: ['late init']
      });
      expect(runtime.hasStartupErrors).toBe(true);
      expect(runtime.hasDegradedSignals).toBe(true);
    });
  });

  describe('sync state and freshness labels', () => {
    it('shows idle labels before first sync', () => {
      const runtime = useRuntimeStore();
      expect(runtime.clockFreshnessLabel).toBe('awaiting first clock sync');
      expect(runtime.statusFreshnessLabel).toBe('awaiting first status sync');
      expect(runtime.isAnySyncing).toBe(false);
    });

    it('shows syncing labels when syncing flags are on', () => {
      const runtime = useRuntimeStore();
      runtime.setClockSyncing(true);
      runtime.setStatusSyncing(true);
      expect(runtime.clockFreshnessLabel).toBe('syncing');
      expect(runtime.statusFreshnessLabel).toBe('syncing');
      expect(runtime.isAnySyncing).toBe(true);
    });

    it('isAnySyncing is true if only clock is syncing', () => {
      const runtime = useRuntimeStore();
      runtime.setClockSyncing(true);
      expect(runtime.isAnySyncing).toBe(true);
    });
  });

  describe('error flags', () => {
    it('setClockError updates clockError', () => {
      const runtime = useRuntimeStore();
      runtime.setClockError('clock failure');
      expect(runtime.clockError).toBe('clock failure');
      runtime.setClockError(null);
      expect(runtime.clockError).toBeNull();
    });

    it('setStatusError updates statusError', () => {
      const runtime = useRuntimeStore();
      runtime.setStatusError('status failure');
      expect(runtime.statusError).toBe('status failure');
      runtime.setStatusError(null);
      expect(runtime.statusError).toBeNull();
    });

    it('clockError or statusError triggers degraded signals', () => {
      const runtime = useRuntimeStore();
      runtime.setClockError('err');
      expect(runtime.hasDegradedSignals).toBe(true);
      runtime.setClockError(null);
      expect(runtime.hasDegradedSignals).toBe(false);
    });
  });
});
