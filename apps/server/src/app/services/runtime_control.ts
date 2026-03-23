import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { AppContext } from '../context.js';

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

export const pauseRuntime = (context: AppContext): { success: true; status: 'paused' } => {
  context.setPaused(true);
  context.notifications.push('info', '模拟已暂停');
  return { success: true, status: 'paused' };
};

export const resumeRuntime = (context: AppContext): { success: true; status: 'running' } => {
  context.setPaused(false);
  context.notifications.push('info', '模拟已恢复');
  return { success: true, status: 'running' };
};
