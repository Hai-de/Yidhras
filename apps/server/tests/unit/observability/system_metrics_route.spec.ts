import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import { systemRoutes } from '../../../src/app/routes/system.js';
import { initMetrics } from '../../../src/observability/metrics.js';

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0, servers.length)) {
    server.close();
  }
});

describe('main API metrics route', () => {
  it('serves Prometheus metrics from GET /metrics on the Express app', async () => {
    initMetrics();

    const app = express();
    systemRoutes.register(app, {} as AppContext);

    const server = app.listen(0);
    servers.push(server);

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind a TCP port');
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('# HELP');
    expect(body).toContain('yidhras_');
  });
});
