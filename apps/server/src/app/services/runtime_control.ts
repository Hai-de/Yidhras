import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { AppContext, RuntimeLoopDiagnostics } from '../context.js';

export interface RuntimeControlSnapshot {
  status: 'paused' | 'running';
}

const DEFAULT_RUNTIME_LOOP_DIAGNOSTICS: RuntimeLoopDiagnostics = {
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
};

export const overrideRuntimeSpeed = (context: AppContext, stepTicks: bigint): RuntimeSpeedSnapshot => {
  context.sim.setRuntimeSpeedOverride(stepTicks);
  const snapshot = context.sim.getRuntimeSpeedSnapshot();

  context.notifications.push('info', `运行时步进已覆盖为 ${stepTicks.toString()}`, 'RUNTIME_SPEED_OVERRIDE', {
    step_ticks: stepTicks.toString(),
    override_since: snapshot.override_since
  });

  return snapshot;
};

export const clearRuntimeSpeedOverride = (context: AppContext): RuntimeSpeedSnapshot => {
  context.sim.clearRuntimeSpeedOverride();
  const snapshot = context.sim.getRuntimeSpeedSnapshot();

  context.notifications.push('info', '运行时步进覆盖已清除', 'RUNTIME_SPEED_OVERRIDE_CLEAR', {
    override_since: null
  });

  return snapshot;
};

export const pauseRuntime = (context: AppContext): RuntimeControlSnapshot => {
  context.setPaused(true);
  const diagnostics = context.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
  context.setRuntimeLoopDiagnostics?.({
    ...diagnostics,
    status: 'paused',
    in_flight: false
  });
  context.notifications.push('info', '模拟已暂停');
  return { status: 'paused' };
};

export const resumeRuntime = (context: AppContext): RuntimeControlSnapshot => {
  context.setPaused(false);
  const diagnostics = context.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
  context.setRuntimeLoopDiagnostics?.({
    ...diagnostics,
    status: 'idle'
  });
  context.notifications.push('info', '模拟已恢复');
  return { status: 'running' };
};
