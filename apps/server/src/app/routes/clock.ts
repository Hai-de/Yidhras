import type { Express } from 'express';

import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { jsonOk } from '../http/json.js';
import {
  clearRuntimeSpeedOverride,
  overrideRuntimeSpeed,
  pauseRuntime,
  resumeRuntime
} from '../services/runtime_control.js';

export interface ClockRouteDependencies {
  parsePositiveStepTicks(value: unknown): bigint;
  toJsonSafe(value: unknown): unknown;
  getErrorMessage(err: unknown): string;
}

export const registerClockRoutes = (
  app: Express,
  context: AppContext,
  deps: ClockRouteDependencies
): void => {
  app.post('/api/runtime/speed', (req, res) => {
    context.assertRuntimeReady('runtime speed control');
    const { action, step_ticks } = req.body as { action?: unknown; step_ticks?: unknown };

    if (action === 'override') {
      const parsed = deps.parsePositiveStepTicks(step_ticks);
      const runtimeSpeed = overrideRuntimeSpeed(context, parsed);
      jsonOk(res, {
        runtime_speed: deps.toJsonSafe(runtimeSpeed)
      });
      return;
    }

    if (action === 'clear') {
      const runtimeSpeed = clearRuntimeSpeedOverride(context);
      jsonOk(res, {
        runtime_speed: deps.toJsonSafe(runtimeSpeed)
      });
      return;
    }

    throw new ApiError(400, 'RUNTIME_SPEED_ACTION_INVALID', 'Invalid action', {
      allowed_actions: ['override', 'clear']
    });
  });

  app.get('/api/clock', (_req, res) => {
    context.assertRuntimeReady('clock read');
    jsonOk(res, {
      absolute_ticks: context.sim.clock.getTicks().toString(),
      calendars: []
    });
  });

  app.get('/api/clock/formatted', (_req, res, next) => {
    context.assertRuntimeReady('clock formatted read');
    try {
      jsonOk(res, {
        absolute_ticks: context.sim.clock.getTicks().toString(),
        calendars: deps.toJsonSafe(context.sim.clock.getAllTimes())
      });
    } catch (err: unknown) {
      next(new ApiError(500, 'CLOCK_FORMAT_ERR', `读取格式化时钟失败: ${deps.getErrorMessage(err)}`));
    }
  });

  app.post('/api/clock/control', (req, res) => {
    context.assertRuntimeReady('clock control');
    const { action } = req.body as { action?: unknown };

    if (action === 'pause') {
      jsonOk(res, {
        acknowledged: true,
        ...pauseRuntime(context)
      });
      return;
    }

    if (action === 'resume') {
      jsonOk(res, {
        acknowledged: true,
        ...resumeRuntime(context)
      });
      return;
    }

    throw new ApiError(400, 'CLOCK_ACTION_INVALID', 'Invalid action', {
      allowed_actions: ['pause', 'resume']
    });
  });
};
