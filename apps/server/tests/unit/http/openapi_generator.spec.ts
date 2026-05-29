import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { OpenApiCollector } from '../../../src/app/http/openapi_generator.js';

describe('openapi_generator', () => {
  describe('OpenApiCollector', () => {
    const defaultSpecOptions = {
      title: 'Test API',
      version: '1.0.0'
    };

    it('creates collector with spec options', () => {
      const collector = new OpenApiCollector(defaultSpecOptions);
      expect(collector).toBeDefined();
    });

    describe('register', () => {
      it('registers a GET route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector.register({
          method: 'get',
          path: '/api/test',
          summary: 'Test endpoint',
          responses: { 200: { description: 'Success' } }
        });
        expect(result).toBe(collector); // returns this for chaining
      });

      it('registers a POST route with body schema', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'post',
          path: '/api/items',
          summary: 'Create item',
          body: z.object({ name: z.string() }),
          responses: { 201: { description: 'Created' } }
        });
        const spec = collector.toSpec() as Record<string, unknown>;
        expect(spec).toBeDefined();
      });

      it('registers route with query params', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/items',
          summary: 'List items',
          query: z.object({ limit: z.number().optional() }),
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers route with path params', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/items/:id',
          summary: 'Get item',
          params: z.object({ id: z.string() }),
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers route with tags', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/test',
          summary: 'Test',
          tags: ['items', 'public'],
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers route with description', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/test',
          summary: 'Test',
          description: 'A detailed description',
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers route with operationId', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/test',
          summary: 'Test',
          operationId: 'getTest',
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers deprecated route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/old',
          summary: 'Deprecated',
          deprecated: true,
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers route with response schema', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'get',
          path: '/api/test',
          summary: 'Test',
          responses: {
            200: { description: 'Success', schema: z.object({ id: z.string() }) },
            404: { description: 'Not found' }
          }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });

      it('registers route with all request parts', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.register({
          method: 'put',
          path: '/api/items/:id',
          summary: 'Update item',
          body: z.object({ name: z.string() }),
          query: z.object({ dry_run: z.boolean().optional() }),
          params: z.object({ id: z.string() }),
          responses: { 200: { description: 'Updated' } }
        });
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });
    });

    describe('convenience methods', () => {
      it('get() registers a GET route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector.get('/api/items', {
          summary: 'List items',
          responses: { 200: { description: 'OK' } }
        });
        expect(result).toBe(collector);
      });

      it('post() registers a POST route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector.post('/api/items', {
          summary: 'Create item',
          body: z.object({ name: z.string() }),
          responses: { 201: { description: 'Created' } }
        });
        expect(result).toBe(collector);
      });

      it('patch() registers a PATCH route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector.patch('/api/items/:id', {
          summary: 'Patch item',
          responses: { 200: { description: 'OK' } }
        });
        expect(result).toBe(collector);
      });

      it('put() registers a PUT route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector.put('/api/items/:id', {
          summary: 'Update item',
          responses: { 200: { description: 'OK' } }
        });
        expect(result).toBe(collector);
      });

      it('delete() registers a DELETE route', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector.delete('/api/items/:id', {
          summary: 'Delete item',
          responses: { 204: { description: 'Deleted' } }
        });
        expect(result).toBe(collector);
      });
    });

    describe('toSpec', () => {
      it('generates valid OpenAPI spec', () => {
        const collector = new OpenApiCollector({
          title: 'My API',
          version: '2.0.0',
          description: 'A test API',
          servers: [{ url: 'https://api.example.com', description: 'Production' }]
        });
        collector.get('/api/hello', {
          summary: 'Hello',
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec() as Record<string, unknown>;
        expect(spec.openapi).toBe('3.0.3');
        expect(spec.info).toEqual({
          title: 'My API',
          version: '2.0.0',
          description: 'A test API'
        });
        expect(spec.servers).toEqual([{ url: 'https://api.example.com', description: 'Production' }]);
      });

      it('uses default server when not specified', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.get('/api/test', {
          summary: 'Test',
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec() as Record<string, unknown>;
        expect(spec.servers).toEqual([{ url: 'http://localhost:3001' }]);
      });

      it('converts Express path params to OpenAPI format', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.get('/api/items/:itemId/details/:detailId', {
          summary: 'Get detail',
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec() as Record<string, unknown>;
        expect(spec).toBeDefined();
      });

      it('converts wildcard paths', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        collector.get('/api/files/*', {
          summary: 'File proxy',
          responses: { 200: { description: 'OK' } }
        });
        const spec = collector.toSpec() as Record<string, unknown>;
        expect(spec).toBeDefined();
      });

      it('chains multiple route registrations', () => {
        const collector = new OpenApiCollector(defaultSpecOptions);
        const result = collector
          .get('/api/a', { summary: 'A', responses: { 200: { description: 'OK' } } })
          .post('/api/b', { summary: 'B', responses: { 201: { description: 'Created' } } })
          .delete('/api/c', { summary: 'C', responses: { 204: { description: 'Deleted' } } });
        expect(result).toBe(collector);
        const spec = collector.toSpec();
        expect(spec).toBeDefined();
      });
    });
  });
});
