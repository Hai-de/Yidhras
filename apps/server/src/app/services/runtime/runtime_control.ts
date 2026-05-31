import type { RuntimeSpeedSnapshot } from '../../../core/runtime_speed.js';
import type { StepStrategy } from '../../../core/step_strategy.js';
import type { RuntimeContext } from '../../context.js';
import type { PackRuntimePort } from '../pack/pack_runtime_ports.js';

export interface RuntimeControlSnapshot {
  status: 'paused' | 'running';
}

const resolveSpeedControl = (context: RuntimeContext, packRuntime?: PackRuntimePort) =>
  packRuntime;

const requireSpeedControl = (context: RuntimeContext, packRuntime?: PackRuntimePort) => {
  const control = resolveSpeedControl(context, packRuntime);
  if (!control) {
    throw new Error('RUNTIME_CONTROL_NOT_READY: No active pack runtime available for speed control');
  }
  return control;
};

export const setPackStepStrategy = (context: RuntimeContext, strategy: StepStrategy, packRuntime?: PackRuntimePort): RuntimeSpeedSnapshot => {
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

export const resetPackStepStrategy = (context: RuntimeContext, packRuntime?: PackRuntimePort): RuntimeSpeedSnapshot => {
  const control = requireSpeedControl(context, packRuntime);
  control.clearRuntimeSpeedOverride();
  const snapshot = control.getRuntimeSpeedSnapshot();

  context.notifications.push('info', '运行时步进策略已重置为 world pack 默认', 'RUNTIME_STRATEGY_RESET', {
    override_since: null
  });

  return snapshot;
};

export const pauseRuntime = (context: RuntimeContext): RuntimeControlSnapshot => {
  context.setPaused(true);
  const diagnostics = context.getRuntimeLoopDiagnostics();
  context.setRuntimeLoopDiagnostics({
    ...diagnostics,
    status: 'paused',
    in_flight: false
  });
  context.notifications.push('info', '模拟已暂停');
  return { status: 'paused' };
};

export const resumeRuntime = (context: RuntimeContext): RuntimeControlSnapshot => {
  context.setPaused(false);
  const diagnostics = context.getRuntimeLoopDiagnostics();
  context.setRuntimeLoopDiagnostics({
    ...diagnostics,
    status: 'idle'
  });
  context.notifications.push('info', '模拟已恢复');
  return { status: 'running' };
};
