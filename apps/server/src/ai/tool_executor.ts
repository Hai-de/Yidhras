import type { AppContext } from '../app/context.js';
import { listActiveSchedulerAgents } from '../app/services/inference_workflow/scheduler_signal_repository.js';
import { listPackWorldEntities } from '../packs/storage/entity_repo.js';
import type { ToolPermissionPolicy } from './tool_permissions.js';
import { resolveToolPermissions } from './tool_permissions.js';
import type { AiToolRegistryEntry, AiToolSandboxLevel } from './types.js';

export interface ToolExecutionContext {
  context: AppContext;
  pack_id?: string | null;
  agent_role?: string | null;
  capabilities?: string[];
  tool_sandbox?: AiToolSandboxLevel;
}

export interface ToolHandler {
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface ToolRegistry {
  register(name: string, handler: ToolHandler, schema?: Record<string, unknown>): void;
  execute(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
  has(name: string): boolean;
  listNames(): string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const validateType = (value: unknown, expectedType: string): boolean => {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
};

const validateSchemaNode = (value: unknown, schema: Record<string, unknown>, path = '$'): string[] => {
  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some(option => isRecord(option) && validateSchemaNode(value, option, path).length === 0);
    return valid ? [] : [`${path} does not satisfy anyOf schema`];
  }

  const issues: string[] = [];
  if (typeof schema.type === 'string' && !validateType(value, schema.type)) {
    issues.push(`${path} must be ${schema.type}`);
    return issues;
  }

  if (schema.type === 'object' && isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const field of required) {
      if (!(field in value)) {
        issues.push(`${path}.${field} is required`);
      }
    }

    if (isRecord(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (!(key in value) || !isRecord(propertySchema)) {
          continue;
        }
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
        issues.push(...validateSchemaNode(value[key], propertySchema, `${path}.${key}`));
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, index) => {
      issues.push(...validateSchemaNode(item, schema.items as Record<string, unknown>, `${path}[${String(index)}]`));
    });
  }

  return issues;
};

export const validateToolArgs = (schema: Record<string, unknown>, args: Record<string, unknown>): string[] => {
  return validateSchemaNode(args, schema);
};

const SANDBOX_ORDER: Record<AiToolSandboxLevel, number> = {
  strict: 0,
  readonly_world: 1,
  mutation: 2
};

interface HandlerEntry {
  handler: ToolHandler;
  schema?: Record<string, unknown>;
  sandbox?: AiToolSandboxLevel;
}

const createHandlerMap = () => {
  const entries = new Map<string, HandlerEntry>();

  return {
    register(name: string, handler: ToolHandler, schema?: Record<string, unknown>, sandbox?: AiToolSandboxLevel): void {
      entries.set(name, { handler, schema, sandbox });
    },
    get(name: string): HandlerEntry | undefined {
      return entries.get(name);
    },
    has(name: string): boolean {
      return entries.has(name);
    },
    names(): string[] {
      return Array.from(entries.keys());
    }
  };
};

interface ToolEntryMaps {
  schemaMap: Map<string, Record<string, unknown>>;
  sandboxMap: Map<string, AiToolSandboxLevel>;
}

const buildToolEntryMaps = (toolEntries?: AiToolRegistryEntry[]): ToolEntryMaps => {
  const schemaMap = new Map<string, Record<string, unknown>>();
  const sandboxMap = new Map<string, AiToolSandboxLevel>();

  if (!toolEntries) {
    return { schemaMap, sandboxMap };
  }

  for (const entry of toolEntries) {
    if (entry.enabled) {
      if (entry.input_schema) {
        schemaMap.set(entry.name, entry.input_schema);
      }
      if (entry.sandbox) {
        sandboxMap.set(entry.name, entry.sandbox);
      }
    }
  }

  return { schemaMap, sandboxMap };
};

export const createToolRegistry = (toolEntries?: AiToolRegistryEntry[], permissionPolicies?: ToolPermissionPolicy[]): ToolRegistry => {
  const { schemaMap, sandboxMap } = buildToolEntryMaps(toolEntries);
  const policies = permissionPolicies ?? [];
  const handlers = createHandlerMap();

  const registerWithSchema = (name: string, handler: ToolHandler): void => {
    handlers.register(name, handler, schemaMap.get(name), sandboxMap.get(name));
  };

  registerWithSchema('query_memory_blocks', {
    async execute(args, ctx) {
      const packId = typeof args.pack_id === 'string' ? args.pack_id : ctx.pack_id;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.trunc(args.limit), 100) : 10;

      const rows = await ctx.context.repos.memory.listActiveMemoryBlocks(packId, limit);

      return rows.map(row => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        content_text: row.content_text,
        tags: row.tags,
        created_at_tick: row.created_at_tick.toString(),
        updated_at_tick: row.updated_at_tick.toString()
      }));
    }
  });

  registerWithSchema('get_entity', {
    async execute(args, ctx) {
      const packId = typeof args.pack_id === 'string' ? args.pack_id : ctx.pack_id;
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : null;

      if (!packId) {
        return { error: { code: 'MISSING_PACK_ID', message: 'pack_id is required' } };
      }

      if (!entityId) {
        return { error: { code: 'MISSING_ENTITY_ID', message: 'entity_id is required' } };
      }

      const entities = await listPackWorldEntities(ctx.context.packStorageAdapter, packId);
      return entities.find(e => e.id === entityId) ?? null;
    }
  });

  registerWithSchema('list_active_agents', {
    async execute(args, ctx) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.trunc(args.limit), 100) : 50;
      const agents = await listActiveSchedulerAgents(ctx.context, limit);
      return agents;
    }
  });

  registerWithSchema('get_relationship', {
    async execute(args, ctx) {
      const sourceId = typeof args.source_id === 'string' ? args.source_id : null;
      const targetId = typeof args.target_id === 'string' ? args.target_id : null;

      if (!sourceId || !targetId) {
        return { error: { code: 'MISSING_IDS', message: 'source_id and target_id are required' } };
      }

      const rel = await ctx.context.repos.relationship.getPrisma().relationship.findFirst({
        where: { from_id: sourceId, to_id: targetId }
      });

      return rel ?? null;
    }
  });

  registerWithSchema('get_clock_state', {
    execute(_args, ctx) {
      const tick = ctx.context.activePackRuntime?.getCurrentTick()
        ?? ctx.context.clock.getCurrentTick();

      const times = ctx.context.activePackRuntime?.getAllTimes?.() ?? [];

      return Promise.resolve({
        current_tick: tick.toString(),
        formatted_times: times
      });
    }
  });

  return {
    register(name: string, handler: ToolHandler, schema?: Record<string, unknown>): void {
      const resolvedSchema = schema ?? schemaMap.get(name);
      const resolvedSandbox = sandboxMap.get(name);
      handlers.register(name, handler, resolvedSchema, resolvedSandbox);
    },
    async execute(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
      const entry = handlers.get(name);
      if (!entry) {
        return {
          success: false,
          error: { code: 'TOOL_NOT_FOUND', message: `Tool "${name}" is not registered` }
        };
      }

      if (entry.sandbox && ctx.tool_sandbox) {
        const requiredLevel = SANDBOX_ORDER[entry.sandbox];
        const allowedLevel = SANDBOX_ORDER[ctx.tool_sandbox];
        if (requiredLevel > allowedLevel) {
          return {
            success: false,
            error: {
              code: 'TOOL_SANDBOX_DENIED',
              message: `Tool "${name}" requires sandbox "${entry.sandbox}" but context allows "${ctx.tool_sandbox}"`
            }
          };
        }
      }

      if (policies.length > 0) {
        const permissionResult = resolveToolPermissions(policies, name, {
          agent_role: ctx.agent_role,
          pack_id: ctx.pack_id,
          capabilities: ctx.capabilities
        });

        if (!permissionResult.allowed) {
          return {
            success: false,
            error: { code: 'TOOL_PERMISSION_DENIED', message: permissionResult.reason ?? 'Permission denied' }
          };
        }
      }

      if (entry.schema) {
        const issues = validateSchemaNode(args, entry.schema);
        if (issues.length > 0) {
          return {
            success: false,
            error: { code: 'TOOL_ARGS_INVALID', message: issues.join('; ') }
          };
        }
      }

      try {
        const data = await entry.handler.execute(args, ctx);
        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'TOOL_EXECUTION_FAILED', message } };
      }
    },
    has(name: string): boolean {
      return handlers.has(name);
    },
    listNames(): string[] {
      return handlers.names();
    }
  };
};

export const registerPackTools = (
  registry: ToolRegistry,
  toolEntries: AiToolRegistryEntry[],
  handlers: Record<string, ToolHandler>
): void => {
  for (const entry of toolEntries) {
    if (!entry.enabled || entry.kind !== 'pack') {
      continue;
    }

    const handler = handlers[entry.name];
    if (!handler) {
      continue;
    }

    registry.register(entry.name, handler, entry.input_schema);
  }
};
