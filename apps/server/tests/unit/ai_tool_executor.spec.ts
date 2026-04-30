import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolRegistry } from '../../src/ai/tool_executor.js';
import { createToolRegistry, registerPackTools, validateToolArgs } from '../../src/ai/tool_executor.js';
import type { ToolPermissionPolicy } from '../../src/ai/tool_permissions.js';
import type { AiToolRegistryEntry } from '../../src/ai/types.js';
import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js';

const buildMockContext = (overrides?: Record<string, unknown>): AppContext => {
  const prisma = {
    memoryBlock: { findMany: vi.fn().mockResolvedValue([]) },
    relationship: { findFirst: vi.fn().mockResolvedValue(null) },
    agent: { findMany: vi.fn().mockResolvedValue([]) }
  };
  const repos = wrapPrismaAsRepositories(prisma as PrismaClient);
  repos.memory = {
    getPrisma: () => prisma as PrismaClient,
    listActiveMemoryBlocks: vi.fn().mockResolvedValue([])
  } as unknown as typeof repos.memory;
  return {
    prisma,
    repos,
    clock: { getCurrentTick: vi.fn().mockReturnValue(42n) },
    activePackRuntime: {
      init: vi.fn().mockResolvedValue(undefined),
      getActivePack: vi.fn().mockReturnValue(undefined),
      resolvePackVariables: vi.fn().mockReturnValue(''),
      getStepTicks: vi.fn().mockReturnValue(1n),
      getRuntimeSpeedSnapshot: vi.fn().mockReturnValue({ step_ticks: '1', is_default: true }),
      setRuntimeSpeedOverride: vi.fn(),
      clearRuntimeSpeedOverride: vi.fn(),
      getCurrentTick: vi.fn().mockReturnValue(100n),
      getCurrentRevision: vi.fn().mockReturnValue(0n),
      getAllTimes: vi.fn().mockReturnValue([]),
      step: vi.fn().mockResolvedValue(undefined)
    },
    ...overrides
  } as unknown as AppContext;
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  describe('register', () => {
    it('registers a new tool handler', () => {
      const handler = { execute: vi.fn().mockResolvedValue('ok') };
      registry.register('custom_tool', handler);
      expect(registry.has('custom_tool')).toBe(true);
    });

    it('overwrites an existing tool handler with the same name', () => {
      const handler1 = { execute: vi.fn().mockResolvedValue('first') };
      const handler2 = { execute: vi.fn().mockResolvedValue('second') };
      registry.register('test', handler1);
      registry.register('test', handler2);
      expect(registry.has('test')).toBe(true);
    });
  });

  describe('has', () => {
    it('returns true for a registered builtin tool', () => {
      expect(registry.has('get_clock_state')).toBe(true);
    });

    it('returns false for an unregistered tool', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('listNames', () => {
    it('returns all registered tool names including builtins', () => {
      const names = registry.listNames();
      expect(names).toContain('query_memory_blocks');
      expect(names).toContain('get_entity');
      expect(names).toContain('list_active_agents');
      expect(names).toContain('get_relationship');
      expect(names).toContain('get_clock_state');
    });

    it('includes custom registered tools', () => {
      registry.register('custom', { execute: vi.fn().mockResolvedValue(null) });
      expect(registry.listNames()).toContain('custom');
    });
  });

  describe('execute', () => {
    const ctx = { context: buildMockContext(), pack_id: null };

    it('returns TOOL_NOT_FOUND for unregistered tool', async () => {
      const result = await registry.execute('nonexistent', {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_FOUND');
    });

    it('returns TOOL_EXECUTION_FAILED when handler throws', async () => {
      registry.register('failing_tool', {
        execute: vi.fn().mockRejectedValue(new Error('boom'))
      });
      const result = await registry.execute('failing_tool', {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_EXECUTION_FAILED');
      expect(result.error?.message).toBe('boom');
    });

    it('returns success with data when handler completes', async () => {
      registry.register('echo', {
        execute: vi.fn().mockResolvedValue({ echoed: true })
      });
      const result = await registry.execute('echo', {}, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ echoed: true });
    });

    it('passes args and context to the handler', async () => {
      const execute = vi.fn().mockResolvedValue('ok');
      registry.register('passthrough', { execute });
      await registry.execute('passthrough', { key: 'val' }, ctx);
      expect(execute).toHaveBeenCalledWith({ key: 'val' }, ctx);
    });

    it('validates args against schema when registered with one', async () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name']
      };
      registry.register('validated_tool', {
        execute: vi.fn().mockResolvedValue('ok')
      }, schema);

      const badResult = await registry.execute('validated_tool', {}, ctx);
      expect(badResult.success).toBe(false);
      expect(badResult.error?.code).toBe('TOOL_ARGS_INVALID');
      expect(badResult.error?.message).toContain('$.name is required');

      const goodResult = await registry.execute('validated_tool', { name: 'test' }, ctx);
      expect(goodResult.success).toBe(true);
      expect(goodResult.data).toBe('ok');
    });

    it('skips validation when no schema is registered', async () => {
      registry.register('no_schema_tool', {
        execute: vi.fn().mockResolvedValue('ok')
      });
      const result = await registry.execute('no_schema_tool', { anything: 'goes' }, ctx);
      expect(result.success).toBe(true);
    });
  });

  describe('with toolEntries', () => {
    it('auto-wires schema from tool entries to matching handler names', async () => {
      const toolEntries: AiToolRegistryEntry[] = [
        {
          tool_id: 'sys.custom',
          name: 'custom_tool',
          description: 'A custom tool',
          input_schema: {
            type: 'object',
            properties: { required_field: { type: 'string' } },
            required: ['required_field']
          },
          kind: 'system',
          enabled: true
        }
      ];

      const reg = createToolRegistry(toolEntries);
      reg.register('custom_tool', {
        execute: vi.fn().mockResolvedValue('ok')
      });

      const ctx2 = { context: buildMockContext(), pack_id: null };
      const badResult = await reg.execute('custom_tool', {}, ctx2);
      expect(badResult.success).toBe(false);
      expect(badResult.error?.code).toBe('TOOL_ARGS_INVALID');

      const goodResult = await reg.execute('custom_tool', { required_field: 'present' }, ctx2);
      expect(goodResult.success).toBe(true);
    });

    it('does not wire schema for disabled tool entries', async () => {
      const toolEntries: AiToolRegistryEntry[] = [
        {
          tool_id: 'sys.disabled',
          name: 'disabled_tool',
          description: 'Disabled',
          input_schema: {
            type: 'object',
            properties: { x: { type: 'string' } },
            required: ['x']
          },
          kind: 'system',
          enabled: false
        }
      ];

      const reg = createToolRegistry(toolEntries);
      reg.register('disabled_tool', {
        execute: vi.fn().mockResolvedValue('ok')
      });

      const ctx2 = { context: buildMockContext(), pack_id: null };
      const result = await reg.execute('disabled_tool', {}, ctx2);
      expect(result.success).toBe(true);
    });
  });
});

describe('permission enforcement', () => {
    const makeCtx = () => ({ context: buildMockContext(), pack_id: null } as const);

    it('allows execution when no permission policies are set', async () => {
      const registry = createToolRegistry();
      const result = await registry.execute('get_clock_state', {}, makeCtx());
      expect(result.success).toBe(true);
    });

    it('denies when agent_role is not in allowed_roles', async () => {
      const policies: ToolPermissionPolicy[] = [
        { tool_id: 'get_clock_state', allowed_roles: ['active'] }
      ];
      const registry = createToolRegistry(undefined, policies);
      const result = await registry.execute('get_clock_state', {}, {
        ...makeCtx(),
        agent_role: 'observer'
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_PERMISSION_DENIED');
    });

    it('allows when agent_role is in allowed_roles', async () => {
      const policies: ToolPermissionPolicy[] = [
        { tool_id: 'get_clock_state', allowed_roles: ['active'] }
      ];
      const registry = createToolRegistry(undefined, policies);
      const result = await registry.execute('get_clock_state', {}, {
        ...makeCtx(),
        agent_role: 'active'
      });
      expect(result.success).toBe(true);
    });

    it('skips permission check for tools without a matching policy', async () => {
      const policies: ToolPermissionPolicy[] = [
        { tool_id: 'get_entity', allowed_roles: ['active'] }
      ];
      const registry = createToolRegistry(undefined, policies);
      const result = await registry.execute('get_clock_state', {}, {
        ...makeCtx(),
        agent_role: 'observer'
      });
      expect(result.success).toBe(true);
    });

    it('enforces capability requirement', async () => {
      const policies: ToolPermissionPolicy[] = [
        {
          tool_id: 'get_clock_state',
          allowed_roles: ['active'],
          require_capability: 'invoke.clock_read'
        }
      ];
      const registry = createToolRegistry(undefined, policies);
      const denied = await registry.execute('get_clock_state', {}, {
        ...makeCtx(),
        agent_role: 'active',
        capabilities: ['read.entity']
      });
      expect(denied.success).toBe(false);
      expect(denied.error?.code).toBe('TOOL_PERMISSION_DENIED');

      const allowed = await registry.execute('get_clock_state', {}, {
        ...makeCtx(),
        agent_role: 'active',
        capabilities: ['invoke.clock_read']
      });
      expect(allowed.success).toBe(true);
    });
  });

describe('sandbox enforcement', () => {
    it('denies mutation tool in strict context', async () => {
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'pack.mutate',
        name: 'mutate_data',
        description: 'Mutation tool',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'pack',
        enabled: true,
        sandbox: 'mutation'
      }];
      const registry = createToolRegistry(entries);
      registry.register('mutate_data', {
        execute: vi.fn().mockResolvedValue('ok')
      });

      const result = await registry.execute('mutate_data', {}, {
        context: buildMockContext(),
        pack_id: null,
        tool_sandbox: 'strict'
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_SANDBOX_DENIED');
    });

    it('allows strict tool in mutation context', async () => {
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'pack.reader',
        name: 'read_data',
        description: 'Read tool',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'pack',
        enabled: true,
        sandbox: 'strict'
      }];
      const registry = createToolRegistry(entries);
      registry.register('read_data', {
        execute: vi.fn().mockResolvedValue('ok')
      });

      const result = await registry.execute('read_data', {}, {
        context: buildMockContext(),
        pack_id: null,
        tool_sandbox: 'mutation'
      });

      expect(result.success).toBe(true);
    });

    it('allows same sandbox level', async () => {
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'pack.rw',
        name: 'rw_tool',
        description: 'Read-world tool',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'pack',
        enabled: true,
        sandbox: 'readonly_world'
      }];
      const registry = createToolRegistry(entries);
      registry.register('rw_tool', {
        execute: vi.fn().mockResolvedValue('ok')
      });

      const result = await registry.execute('rw_tool', {}, {
        context: buildMockContext(),
        pack_id: null,
        tool_sandbox: 'readonly_world'
      });

      expect(result.success).toBe(true);
    });

    it('skips sandbox check when tool has no sandbox', async () => {
      const registry = createToolRegistry();
      const result = await registry.execute('get_clock_state', {}, {
        context: buildMockContext(),
        pack_id: null,
        tool_sandbox: 'strict'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('registerPackTools', () => {
    it('registers enabled pack tools', () => {
      const registry = createToolRegistry();
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'pack.check_ownership',
        name: 'check_notebook_ownership',
        description: 'Check Death Note ownership',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'pack',
        enabled: true,
        sandbox: 'strict'
      }];

      registerPackTools(registry, entries, {
        check_notebook_ownership: { execute: vi.fn().mockResolvedValue('owned') }
      });

      expect(registry.has('check_notebook_ownership')).toBe(true);
    });

    it('skips disabled pack tools', () => {
      const registry = createToolRegistry();
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'pack.disabled_tool',
        name: 'disabled_tool',
        description: 'Should not register',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'pack',
        enabled: false,
        sandbox: 'strict'
      }];

      registerPackTools(registry, entries, {
        disabled_tool: { execute: vi.fn() }
      });

      expect(registry.has('disabled_tool')).toBe(false);
    });

    it('skips system-kind tools', () => {
      const registry = createToolRegistry();
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'sys.extra',
        name: 'extra_tool',
        description: 'System tool',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'system',
        enabled: true
      }];

      registerPackTools(registry, entries, {
        extra_tool: { execute: vi.fn() }
      });

      expect(registry.has('extra_tool')).toBe(false);
    });

    it('skips tools without matching handler', () => {
      const registry = createToolRegistry();
      const entries: AiToolRegistryEntry[] = [{
        tool_id: 'pack.no_handler',
        name: 'no_handler_tool',
        description: 'No handler',
        input_schema: { type: 'object', properties: {}, required: [] },
        kind: 'pack',
        enabled: true
      }];

      registerPackTools(registry, entries, {});

      expect(registry.has('no_handler_tool')).toBe(false);
    });
  });

describe('validateToolArgs', () => {
  it('returns empty array for valid args matching schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' }
      },
      required: ['name']
    };
    const issues = validateToolArgs(schema, { name: 'test', count: 5 });
    expect(issues).toEqual([]);
  });

  it('returns issues for missing required fields', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    };
    const issues = validateToolArgs(schema, {});
    expect(issues).toContain('$.name is required');
  });

  it('returns issues for wrong types', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: []
    };
    const issues = validateToolArgs(schema, { count: 'not-a-number' });
    expect(issues).toContain('$.count must be integer');
  });

  it('validates nested object properties', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { inner: { type: 'boolean' } },
          required: ['inner']
        }
      },
      required: ['nested']
    };
    const issues = validateToolArgs(schema, { nested: { inner: 'not-bool' } });
    expect(issues.some(i => i.includes('inner'))).toBe(true);
  });

  it('validates array items against items schema', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
        }
      },
      required: []
    };
    const issues = validateToolArgs(schema, { items: [{}, { id: 'ok' }] });
    expect(issues.some(i => i.includes('[0]') && i.includes('required'))).toBe(true);
  });

  it('handles anyOf schema', () => {
    const schema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [
            { type: 'string' },
            { type: 'integer' }
          ]
        }
      },
      required: []
    };
    expect(validateToolArgs(schema, { value: 'hello' })).toEqual([]);
    expect(validateToolArgs(schema, { value: 42 })).toEqual([]);
    expect(validateToolArgs(schema, { value: true }).length).toBeGreaterThan(0);
  });
});

describe('builtin system tools', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  describe('get_clock_state', () => {
    it('returns clock state from activePackRuntime when available', async () => {
      const ctx = {
        context: buildMockContext(),
        pack_id: null
      };

      const result = await registry.execute('get_clock_state', {}, ctx);
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).current_tick).toBe('100');
    });

    it('falls back to context.clock when activePackRuntime is unavailable', async () => {
      const ctx = {
        context: buildMockContext({ activePackRuntime: undefined }),
        pack_id: null
      };

      const result = await registry.execute('get_clock_state', {}, ctx);
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).current_tick).toBe('42');
    });
  });

  describe('get_entity', () => {
    it('returns error when pack_id is missing', async () => {
      const ctx = { context: buildMockContext(), pack_id: null };
      const result = await registry.execute('get_entity', { entity_id: 'e1' }, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ error: { code: 'MISSING_PACK_ID', message: 'pack_id is required' } });
    });

    it('returns error when entity_id is missing', async () => {
      const ctx = { context: buildMockContext(), pack_id: 'pack-1' };
      const result = await registry.execute('get_entity', { pack_id: 'pack-1' }, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ error: { code: 'MISSING_ENTITY_ID', message: 'entity_id is required' } });
    });
  });

  describe('get_relationship', () => {
    it('returns error when source_id is missing', async () => {
      const ctx = { context: buildMockContext(), pack_id: null };
      const result = await registry.execute('get_relationship', { target_id: 't1' }, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ error: { code: 'MISSING_IDS', message: 'source_id and target_id are required' } });
    });
  });

  describe('list_active_agents', () => {
    it('calls listActiveSchedulerAgents and returns results', async () => {
      const mockAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];
      const ctx = {
        context: buildMockContext({
          prisma: {
            agent: { findMany: vi.fn().mockResolvedValue(mockAgents) },
            memoryBlock: { findMany: vi.fn().mockResolvedValue([]) },
            relationship: { findFirst: vi.fn().mockResolvedValue(null) }
          }
        }),
        pack_id: null
      };

      const result = await registry.execute('list_active_agents', { limit: 10 }, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockAgents);
    });
  });

  describe('query_memory_blocks', () => {
    it('queries memory blocks through prisma', async () => {
      const mockBlocks = [
        {
          id: 'mb-1',
          kind: 'note',
          title: 'Test',
          content_text: 'hello',
          tags: '[]',
          created_at_tick: 1n,
          updated_at_tick: 2n
        }
      ];
      const ctx = {
        context: buildMockContext(),
        pack_id: 'pack-1'
      };
      (ctx.context.repos.memory as ReturnType<typeof vi.fn> & { listActiveMemoryBlocks: ReturnType<typeof vi.fn> }).listActiveMemoryBlocks = vi.fn().mockResolvedValue(mockBlocks);

      const result = await registry.execute('query_memory_blocks', { pack_id: 'pack-1', limit: 5 }, ctx);
      expect(result.success).toBe(true);
      const data = result.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('mb-1');
    });
  });
});
