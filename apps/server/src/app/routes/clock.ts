import {
  clockControlRequestSchema,
  runtimeSpeedOverrideRequestSchema
} from '@yidhras/contracts';
import type { Express } from 'express';

import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { jsonOk } from '../http/json.js';
import { parseBody } from '../http/zod.js';
import { requireAuth } from '../middleware/require_auth.js';
import { readVisibleClockSnapshot } from '../services/app_context_ports.js';
import {
  pauseRuntime,
  resetPackStepStrategy,
  resumeRuntime,
  setPackStepStrategy
} from '../services/runtime/runtime_control.js';

export interface ClockRouteDependencies {
  toJsonSafe(value: unknown): unknown;
  getErrorMessage(err: unknown): string;
}

export const registerClockRoutes = (
  app: Express,
  context: AppContext,
  deps: ClockRouteDependencies
): void => {
  const readProjectedClock = () => {
    const snapshot = readVisibleClockSnapshot({ runtimeClockProjection: context.runtimeClockProjection, packId: undefined });
    return {
      absolute_ticks: snapshot.absolute_ticks,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      calendars: deps.toJsonSafe(snapshot.calendars) as unknown[]
    };
  };

  app.post('/api/runtime/speed', requireAuth(), (req, res) => {
    context.assertRuntimeReady('runtime speed control');
    const body = parseBody(runtimeSpeedOverrideRequestSchema, req.body, 'RUNTIME_SPEED_INVALID');

    if (body.action === 'set_strategy') {
      const strategy = body.strategy;
      const stepStrategy = {
        kind: strategy.kind,
        range: {
          min: BigInt(strategy.range.min),
          max: BigInt(strategy.range.max)
        },
        loopIntervalMs: strategy.loop_interval_ms ?? 1000,
        adaptive: strategy.kind === 'adaptive' && strategy.adaptive ? {
          targetLoopMs: strategy.adaptive.target_loop_ms,
          scaleUpThresholdMs: strategy.adaptive.scale_up_threshold_ms,
          scaleDownThresholdMs: strategy.adaptive.scale_down_threshold_ms
        } : undefined
      };
      const runtimeSpeed = setPackStepStrategy(context, stepStrategy);
      jsonOk(res, {
        runtime_speed: deps.toJsonSafe(runtimeSpeed)
      });
      return;
    }

    if (body.action === 'reset') {
      const runtimeSpeed = resetPackStepStrategy(context);
      jsonOk(res, {
        runtime_speed: deps.toJsonSafe(runtimeSpeed)
      });
      return;
    }

    throw new ApiError(400, 'RUNTIME_SPEED_ACTION_INVALID', 'Invalid action', {
      allowed_actions: ['set_strategy', 'reset']
    });
  });

  app.get('/api/clock', (_req, res) => {
    context.assertRuntimeReady('clock read');
    const projected = readProjectedClock();
    jsonOk(res, {
      absolute_ticks: projected.absolute_ticks,
      calendars: []
    });
  });

  app.get('/api/clock/formatted', (_req, res, next) => {
    context.assertRuntimeReady('clock formatted read');
    try {
      const projected = readProjectedClock();
      jsonOk(res, {
        absolute_ticks: projected.absolute_ticks,
        calendars: projected.calendars
      });
    } catch (err: unknown) {
      next(new ApiError(500, 'CLOCK_FORMAT_ERR', `读取格式化时钟失败: ${deps.getErrorMessage(err)}`));
    }
  });

  app.post('/api/clock/control', requireAuth(), (req, res) => {
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
