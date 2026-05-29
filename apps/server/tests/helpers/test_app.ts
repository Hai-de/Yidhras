import type { Server } from 'node:http';
import { createServer } from 'node:http';

import express, { type Express } from 'express';

import type { AppContext } from '../../src/app/context.js';
import type { AsyncRequestHandler } from '../../src/app/http/async_handler.js';
import type { ApiSuccessEnvelope } from '../../src/app/http/json.js';
import { createGlobalErrorMiddleware } from '../../src/app/middleware/error_handler.js';

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export interface CreateTestAppOptions {
  /**
   * If provided, a middleware is added before routes that sets req.operator
   * and req.identity, allowing auth-guarded routes to pass without real auth.
   */
  operator?: {
    id: string;
    username: string;
    is_root: boolean;
    identity_id?: string;
  };
}

/**
 * A test wrapper around a real Express app that serves on an ephemeral port.
 * Use with createMockAppContext() for full-stack route unit testing.
 *
 * @example
 * const ctx = createMockAppContext();
 * ctx.prisma.agent.findMany.mockResolvedValue([...]);
 * const app = createTestApp(ctx, { operator: { id: 'op-1', username: 'test', is_root: true } });
 * someRoute.register(app.express, ctx);
 *
 * const res = await app.get('/api/agents');
 * expect(res.status).toBe(200);
 * expect(res.body.success).toBe(true);
 * await app.close();
 */
export class TestApp {
  readonly express: Express;
  private server: Server | null = null;
  private port: number | null = null;
  private readonly context: AppContext;

  constructor(context: AppContext, options: CreateTestAppOptions = {}) {
    this.context = context;
    this.express = express();
    this.express.use(express.json({ limit: '1mb' }));

    if (options.operator) {
      this.express.use((req, _res, next) => {
        (req as Record<string, unknown>).operator = {
          id: options.operator!.id,
          username: options.operator!.username,
          is_root: options.operator!.is_root
        };
        (req as Record<string, unknown>).identity = options.operator!.identity_id
          ? { id: options.operator!.identity_id }
          : undefined;
        next();
      });
    }
  }

  private async ensureServer(): Promise<number> {
    if (this.port !== null) return this.port;

    // Add error handler LAST — after all routes have been registered.
    // Express error handlers (4-arg) only catch errors from middleware
    // registered before them, so this must be the final use() call.
    this.express.use(createGlobalErrorMiddleware(this.context));

    return new Promise((resolve, reject) => {
      this.server = createServer(this.express);
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('test server did not bind a TCP port'));
          return;
        }
        this.port = addr.port;
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<TestResponse> {
    const port = await this.ensureServer();

    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': body !== undefined ? 'application/json' : 'text/plain',
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let resBody: unknown;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      resBody = await res.json();
    } else {
      resBody = await res.text();
    }

    return {
      status: res.status,
      body: resBody,
      headers: res.headers
    };
  }

  async get(path: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request('GET', path, undefined, headers);
  }

  async post(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request('POST', path, body, headers);
  }

  async put(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request('PUT', path, body, headers);
  }

  async patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request('PATCH', path, body, headers);
  }

  async delete(path: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request('DELETE', path, undefined, headers);
  }

  async close(): Promise<void> {
    if (this.server) {
      return new Promise(resolve => {
        this.server!.close(() => {
          this.server = null;
          this.port = null;
          resolve();
        });
      });
    }
  }
}

/**
 * Creates a TestApp with a minimal Express setup (JSON body parsing,
 * error handler) wired to the given AppContext.
 */
export const createTestApp = (
  context: AppContext,
  options?: CreateTestAppOptions
): TestApp => {
  return new TestApp(context, options);
};

/** Extract the data payload from a success envelope, or throw. */
export const unwrapData = <T>(body: unknown): T => {
  const envelope = body as ApiSuccessEnvelope<T>;
  if (!envelope.success) {
    throw new Error(`Expected success envelope, got: ${JSON.stringify(body)}`);
  }
  return envelope.data;
};

/**
 * Registers a route module's handler directly on the TestApp and returns
 * the handler for direct invocation (bypasses HTTP). Useful for routes
 * that need fine-grained req/res control.
 */
export const extractRouteHandlers = <T extends string>(
  app: TestApp,
  registerFn: (expressApp: Express) => void
) => {
  const routes = new Map<string, AsyncRequestHandler>();

  // Wrap express.get/post to capture handlers
  const originalGet = app.express.get.bind(app.express);
  const originalPost = app.express.post.bind(app.express);
  const originalPut = app.express.put.bind(app.express);
  const originalDelete = app.express.delete.bind(app.express);

  const wrapped = {
    get: (path: string, ...handlers: AsyncRequestHandler[]) => {
      routes.set(`GET ${path}`, handlers[handlers.length - 1]);
      originalGet(path, ...handlers);
    },
    post: (path: string, ...handlers: AsyncRequestHandler[]) => {
      routes.set(`POST ${path}`, handlers[handlers.length - 1]);
      originalPost(path, ...handlers);
    },
    put: (path: string, ...handlers: AsyncRequestHandler[]) => {
      routes.set(`PUT ${path}`, handlers[handlers.length - 1]);
      originalPut(path, ...handlers);
    },
    delete: (path: string, ...handlers: AsyncRequestHandler[]) => {
      routes.set(`DELETE ${path}`, handlers[handlers.length - 1]);
      originalDelete(path, ...handlers);
    }
  };

  // Monkey-patch temporarily while registering
  const prevGet = app.express.get;
  const prevPost = app.express.post;
  const prevPut = app.express.put;
  const prevDelete = app.express.delete;

  app.express.get = wrapped.get as never;
  app.express.post = wrapped.post as never;
  app.express.put = wrapped.put as never;
  app.express.delete = wrapped.delete as never;

  registerFn(app.express);

  app.express.get = prevGet;
  app.express.post = prevPost;
  app.express.put = prevPut;
  app.express.delete = prevDelete;

  return routes;
};
