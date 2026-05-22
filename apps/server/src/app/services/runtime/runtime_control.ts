import type { RuntimeSpeedSnapshot } from '../../../core/runtime_speed.js';
import type { StepStrategy } from '../../../core/step_strategy.js';
import type { AppContext, RuntimeLoopDiagnostics } from '../../context.js';
import type { PackRuntimePort } from '../pack/pack_runtime_ports.js';

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

const resolveSpeedControl = (context: AppContext, packRuntime?: PackRuntimePort) =>
  packRuntime;

const requireSpeedControl = (context: AppContext, packRuntime?: PackRuntimePort) => {
  const control = resolveSpeedControl(context, packRuntime);
  if (!control) {
    throw new Error('RUNTIME_CONTROL_NOT_READY: No active pack runtime available for speed control');
  }
  return control;
};

export const setPackStepStrategy = (context: AppContext, strategy: StepStrategy, packRuntime?: PackRuntimePort): RuntimeSpeedSnapshot => {
  const control = requireSpeedControl(context, packRuntime);
  control.setStepStrategy(strategy);
  const snapshot = control.getRuntimeSpeedSnapshot();

  context.notifications.push('info', `运行时步进策略已更新为 ${strategy.kind}`, 'RUNTIME_STRATEGY_SET', {
    strategy_kind: strategy.kind,
    range_min: strategy.range.min.toString(),
    range_max: strategy.range.max.toString(),
    override_since: snapshot.override_since
  });

  return snapshot;
};

export const resetPackStepStrategy = (context: AppContext, packRuntime?: PackRuntimePort): RuntimeSpeedSnapshot => {
  const control = requireSpeedControl(context, packRuntime);
  control.clearRuntimeSpeedOverride();
  const snapshot = control.getRuntimeSpeedSnapshot();

  context.notifications.push('info', '运行时步进策略已重置为 world pack 默认', 'RUNTIME_STRATEGY_RESET', {
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
