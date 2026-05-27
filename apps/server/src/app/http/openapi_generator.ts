import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  type ResponseConfig,
  type RouteConfig} from '@asteasolutions/zod-to-openapi';
import type { ZodType } from 'zod';

// ---- Route metadata builder -----------------------------------------------

export type HttpMethod = RouteConfig['method'];

export interface RouteMetaInput {
  method: HttpMethod;
  path: string;
  summary: string;
  tags?: string[];
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  query?: ZodType;
  body?: ZodType;
  params?: ZodType;
  responses: Record<number, ResponseMetaInput>;
}

export interface ResponseMetaInput {
  description: string;
  schema?: ZodType;
}

export interface SpecOptions {
  title: string;
  version: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
}

// ---- Collector -------------------------------------------------------------

export class OpenApiCollector {
  private registry = new OpenAPIRegistry();

  constructor(private specOptions: SpecOptions) {}

  register(meta: RouteMetaInput): this {
    const routeConfig: RouteConfig = {
      method: meta.method,
      path: convertExpressPath(meta.path),
      summary: meta.summary,
      ...(meta.tags ? { tags: meta.tags } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.operationId ? { operationId: meta.operationId } : {}),
      ...(meta.deprecated ? { deprecated: true } : {}),
      responses: {}
    };

    // Build request object
    const request: NonNullable<RouteConfig['request']> = {};

    if (meta.body) {
      request.body = {
        required: true,
        content: {
          'application/json': { schema: meta.body }
        }
      };
    }

    if (meta.query) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ZodType to RouteParameter cast at boundary
      request.query = meta.query as typeof request.query;
    }

    if (meta.params) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ZodType to RouteParameter cast at boundary
      request.params = meta.params as typeof request.params;
    }

    if (meta.body || meta.query || meta.params) {
      routeConfig.request = request;
    }

    // Responses — build ResponseConfig objects
    for (const [status, respMeta] of Object.entries(meta.responses)) {
      const rc: ResponseConfig = {
        description: respMeta.description
      };

      if (respMeta.schema) {
        rc.content = {
          'application/json': { schema: respMeta.schema }
        };
      }

      // eslint-disable-next-line security/detect-object-injection -- status key from Object.entries
      routeConfig.responses[status] = rc;
    }

    this.registry.registerPath(routeConfig);
    return this;
  }

  get(path: string, meta: Omit<RouteMetaInput, 'method' | 'path'>): this {
    return this.register({ method: 'get', path, ...meta });
  }

  post(path: string, meta: Omit<RouteMetaInput, 'method' | 'path'>): this {
    return this.register({ method: 'post', path, ...meta });
  }

  patch(path: string, meta: Omit<RouteMetaInput, 'method' | 'path'>): this {
    return this.register({ method: 'patch', path, ...meta });
  }

  put(path: string, meta: Omit<RouteMetaInput, 'method' | 'path'>): this {
    return this.register({ method: 'put', path, ...meta });
  }

  delete(path: string, meta: Omit<RouteMetaInput, 'method' | 'path'>): this {
    return this.register({ method: 'delete', path, ...meta });
  }

  toSpec(): object {
    const generator = new OpenApiGeneratorV3(this.registry.definitions);
    return generator.generateDocument({
      openapi: '3.0.3',
      info: {
        title: this.specOptions.title,
        version: this.specOptions.version,
        ...(this.specOptions.description ? { description: this.specOptions.description } : {})
      },
      servers: this.specOptions.servers || [{ url: 'http://localhost:3001' }]
    });
  }
}

// ---- Express path conversion -----------------------------------------------

function convertExpressPath(expressPath: string): string {
  return expressPath
    .replace(/:([a-zA-Z0-9_]+)/g, '{$1}')
    .replace(/\*/g, '{wildcard}');
}
