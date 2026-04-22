import {
  clockControlRequestSchema,
  runtimeSpeedOverrideRequestSchema
} from '@yidhras/contracts';
import type { Express } from 'express';

import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { jsonOk } from '../http/json.js';
import { parseBody } from '../http/zod.js';
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
  const readProjectedClock = () => {
    const packId = context.activePackRuntime?.getActivePack()?.metadata.id?.trim() ?? '';
    if (!packId) {
      return null;
    }

    const projected = context.runtimeClockProjection?.readFormattedClock(packId);
    if (projected) {
      return projected;
    }

    return {
      absolute_ticks: context.sim.getCurrentTick().toString(),
      calendars: deps.toJsonSafe(context.sim.getAllTimes()) as unknown[]
    };
  };

  app.post('/api/runtime/speed', (req, res) => {
    context.assertRuntimeReady('runtime speed control');
    const body = parseBody(runtimeSpeedOverrideRequestSchema, req.body, 'RUNTIME_SPEED_INVALID');

    if (body.action === 'override') {
      const parsed = deps.parsePositiveStepTicks(body.step_ticks);
      const runtimeSpeed = overrideRuntimeSpeed(context, parsed);
      jsonOk(res, {
        runtime_speed: deps.toJsonSafe(runtimeSpeed)
      });
      return;
    }

    if (body.action === 'clear') {
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
    const projected = readProjectedClock();
    jsonOk(res, {
      absolute_ticks: projected?.absolute_ticks ?? context.sim.getCurrentTick().toString(),
      calendars: []
    });
  });

  app.get('/api/clock/formatted', (_req, res, next) => {
    context.assertRuntimeReady('clock formatted read');
    try {
      const projected = readProjectedClock();
      jsonOk(res, {
        absolute_ticks: projected?.absolute_ticks ?? context.sim.getCurrentTick().toString(),
        calendars: projected?.calendars ?? deps.toJsonSafe(context.sim.getAllTimes())
      });
    } catch (err: unknown) {
      next(new ApiError(500, 'CLOCK_FORMAT_ERR', `读取格式化时钟失败: ${deps.getErrorMessage(err)}`));
    }
  });

  app.post('/api/clock/control', (req, res) => {
    context.assertRuntimeReady('clock control');
    const body = parseBody(clockControlRequestSchema, req.body, 'CLOCK_ACTION_INVALID');

    if (body.action === 'pause') {
      jsonOk(res, {
        acknowledged: true,
        ...pauseRuntime(context)
      });
      return;
    }

    if (body.action === 'resume') {
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
