import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { SystemMessage } from '../../utils/notifications.js';
import type { AppContext } from '../context.js';

export interface RuntimeStatusSnapshot {
  status: 'paused' | 'running';
  runtime_ready: boolean;
  runtime_speed: RuntimeSpeedSnapshot;
  health_level: AppContext['startupHealth']['level'];
  world_pack:
    | {
        id: string;
        name: string;
        version: string;
      }
    | null;
  has_error: boolean;
  startup_errors: string[];
}

export interface StartupHealthSnapshot {
  success: boolean;
  level: AppContext['startupHealth']['level'];
  runtime_ready: boolean;
  checks: AppContext['startupHealth']['checks'];
  available_world_packs: string[];
  errors: string[];
}

export const listSystemNotifications = (context: AppContext): SystemMessage[] => {
  return context.notifications.getMessages();
};

export const clearSystemNotifications = (context: AppContext): { success: true } => {
  context.notifications.clear();
  return { success: true };
};

export const getRuntimeStatusSnapshot = (context: AppContext): RuntimeStatusSnapshot => {
  const pack = context.sim.getActivePack();

  return {
    status: context.getPaused() ? 'paused' : 'running',
    runtime_ready: context.getRuntimeReady(),
    runtime_speed: context.sim.getRuntimeSpeedSnapshot(),
    health_level: context.startupHealth.level,
    world_pack: pack
      ? {
          id: pack.metadata.id,
          name: pack.metadata.name,
          version: pack.metadata.version
        }
      : null,
    has_error: context.notifications.getMessages().some(message => message.level === 'error'),
    startup_errors: context.startupHealth.errors
  };
};

export const getStartupHealthSnapshot = (
  context: AppContext
): { statusCode: number; body: StartupHealthSnapshot } => {
  const statusCode = context.startupHealth.level === 'fail' ? 503 : 200;

  return {
    statusCode,
    body: {
      success: context.startupHealth.level !== 'fail',
      level: context.startupHealth.level,
      runtime_ready: context.getRuntimeReady(),
      checks: context.startupHealth.checks,
      available_world_packs: context.startupHealth.available_world_packs,
      errors: context.startupHealth.errors
    }
  };
};
