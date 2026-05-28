import {
  clockControlRequestSchema,
  runtimeSpeedOverrideRequestSchema,
  runtimeStatusDataSchema,
  startupHealthDataSchema,
  systemMessageSchema
} from '@yidhras/contracts';
import { z } from 'zod';

import { OpenApiCollector } from '../http/openapi_generator.js';
import type { RouteModule } from './types.js';

// ---- Demo: register OpenAPI metadata for system + clock routes ------------

function buildDemoSpec(): ReturnType<OpenApiCollector['toSpec']> {
  const collector = new OpenApiCollector({
    title: 'Yidhras API',
    version: '0.1.0',
    description: 'Narrative simulation platform API. Generated from Zod contracts.',
    servers: [
      { url: 'http://localhost:3001', description: 'Local dev server' }
    ]
  });

  // -- System routes --

  collector.get('/metrics', {
    summary: 'Prometheus metrics endpoint',
    tags: ['System'],
    responses: {
      200: { description: 'Metrics in Prometheus text format' }
    }
  });

  collector.get('/api/system/notifications', {
    summary: 'List system notifications',
    tags: ['System'],
    responses: {
      200: { description: 'System messages', schema: systemMessageSchema.array() }
    }
  });

  collector.post('/api/system/notifications/clear', {
    summary: 'Clear all system notifications (root only)',
    tags: ['System'],
    responses: {
      200: { description: 'Acknowledgement with cleared count' }
    }
  });

  collector.get('/api/status', {
    summary: 'Runtime status snapshot',
    tags: ['System'],
    query: z.object({
      packId: z.string().min(1)
    }),
    responses: {
      200: { description: 'Runtime status data', schema: runtimeStatusDataSchema }
    }
  });

  collector.get('/api/health', {
    summary: 'Startup health snapshot including sidecar status',
    tags: ['System'],
    responses: {
      200: { description: 'Health data', schema: startupHealthDataSchema }
    }
  });

  // -- Clock routes --

  collector.get('/api/clock', {
    summary: 'Read current simulation clock',
    tags: ['Clock'],
    responses: {
      200: { description: 'Clock with absolute ticks and calendars' }
    }
  });

  collector.get('/api/clock/formatted', {
    summary: 'Read formatted simulation clock',
    tags: ['Clock'],
    responses: {
      200: { description: 'Formatted clock output' }
    }
  });

  collector.post('/api/clock/control', {
    summary: 'Pause or resume the simulation clock',
    tags: ['Clock'],
    body: clockControlRequestSchema,
    responses: {
      200: { description: 'Control acknowledged' }
    }
  });

  collector.post('/api/runtime/speed', {
    summary: 'Set runtime speed strategy',
    tags: ['Clock'],
    body: runtimeSpeedOverrideRequestSchema,
    responses: {
      200: { description: 'Updated runtime speed' }
    }
  });

  // -- OpenAPI self-documentation --

  collector.get('/api/openapi.json', {
    summary: 'This OpenAPI specification',
    tags: ['Meta'],
    responses: {
      200: { description: 'OpenAPI 3.0.3 specification' }
    }
  });

  return collector.toSpec();
}

// ---- Route registration ----------------------------------------------------

let cachedSpec: object | null = null;

export const openApiRoute: RouteModule = {
  register(app) {
    app.get('/api/openapi.json', (_req, res) => {
      if (!cachedSpec) {
        cachedSpec = buildDemoSpec();
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(cachedSpec);
    });
  }
};
