import { Prisma } from '@prisma/client';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { sim } from './core/simulation.js';
import { identityInjector, IdentityRequest } from './identity/middleware.js';
import { IdentityPolicyService } from './identity/service.js';
import { IdentityBindingRole, IdentityBindingStatus } from './identity/types.js';
import { PermissionContext } from './permission/types.js';
import { ApiError } from './utils/api_error.js';
import { notifications } from './utils/notifications.js';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
};

const toJsonSafe = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(item => toJsonSafe(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonSafe(item)])
    );
  }

  return value;
};

const createRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const asyncHandler = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const validatePolicyConditions = (conditions: unknown): Record<string, unknown> => {
  if (conditions === undefined || conditions === null) {
    return {};
  }

  if (!isPlainObject(conditions)) {
    throw new ApiError(400, 'POLICY_CONDITIONS_INVALID', 'conditions must be an object');
  }

  const isScalarValue = (candidate: unknown): candidate is string | number | boolean | null => {
    return (
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean' ||
      candidate === null
    );
  };

  for (const [key, value] of Object.entries(conditions)) {
    if (key.trim().length === 0) {
      throw new ApiError(400, 'POLICY_CONDITIONS_INVALID', 'conditions key must not be empty');
    }
    const isScalar = isScalarValue(value);
    const isScalarArray = Array.isArray(value) && value.every(isScalarValue);
    if (!isScalar && !isScalarArray) {
      throw new ApiError(400, 'POLICY_CONDITIONS_INVALID', 'conditions value must be scalar or scalar[]');
    }
  }

  return conditions;
};

const app = express();
const port = process.env.PORT || 3001;

type HealthLevel = 'ok' | 'degraded' | 'fail';

interface StartupHealth {
  level: HealthLevel;
  checks: {
    db: boolean;
    world_pack_dir: boolean;
    world_pack_available: boolean;
  };
  available_world_packs: string[];
  errors: string[];
}

const resolveWorldPacksDir = (): string => {
  const candidates = [
    path.resolve(process.cwd(), 'data/world_packs'),
    path.resolve(process.cwd(), '../../data/world_packs'),
    path.resolve(process.cwd(), '../data/world_packs')
  ];

  const existing = candidates.find(candidate => fs.existsSync(candidate));
  return existing ?? candidates[0];
};

const worldPacksDir = resolveWorldPacksDir();
const preferredWorldPack = 'cyber_noir';

const startupHealth: StartupHealth = {
  level: 'fail',
  checks: {
    db: false,
    world_pack_dir: false,
    world_pack_available: false
  },
  available_world_packs: [],
  errors: []
};

let runtimeReady = false;

const hasPackConfig = (packDir: string): boolean => {
  const candidates = ['config.yaml', 'config.yml', 'pack.yaml', 'pack.yml'];
  return candidates.some(file => fs.existsSync(path.join(packDir, file)));
};

const detectAvailableWorldPacks = (): string[] => {
  if (!fs.existsSync(worldPacksDir)) {
    return [];
  }

  const entries = fs.readdirSync(worldPacksDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => hasPackConfig(path.join(worldPacksDir, entry.name)))
    .map(entry => entry.name);
};

const runStartupPreflight = async (): Promise<void> => {
  startupHealth.errors = [];
  startupHealth.checks.world_pack_dir = fs.existsSync(worldPacksDir);
  startupHealth.available_world_packs = detectAvailableWorldPacks();
  startupHealth.checks.world_pack_available = startupHealth.available_world_packs.length > 0;

  try {
    await sim.prisma.$queryRawUnsafe('SELECT 1');
    startupHealth.checks.db = true;
  } catch (err: unknown) {
    startupHealth.checks.db = false;
    startupHealth.errors.push(`database check failed: ${getErrorMessage(err)}`);
  }

  if (!startupHealth.checks.world_pack_dir) {
    startupHealth.errors.push(`world pack directory missing: ${worldPacksDir}`);
  }
  if (!startupHealth.checks.world_pack_available) {
    startupHealth.errors.push('no available world pack found');
  }

  if (!startupHealth.checks.db) {
    startupHealth.level = 'fail';
  } else if (!startupHealth.checks.world_pack_dir || !startupHealth.checks.world_pack_available) {
    startupHealth.level = 'degraded';
  } else {
    startupHealth.level = 'ok';
  }
};

const assertRuntimeReady = (feature: string): void => {
  if (runtimeReady) {
    return;
  }

  throw new ApiError(503, 'WORLD_PACK_NOT_READY', `World pack not ready for ${feature}`, {
    startup_level: startupHealth.level,
    available_world_packs: startupHealth.available_world_packs
  });
};

const parsePositiveStepTicks = (value: unknown): bigint => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be a safe integer');
    }
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be greater than 0');
    }
    return parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must not be empty');
    }
    try {
      const parsed = BigInt(trimmed);
      if (parsed <= 0n) {
        throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be greater than 0');
      }
      return parsed;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be a valid integer string');
    }
  }

  throw new ApiError(400, 'RUNTIME_SPEED_INVALID', 'step_ticks must be a number or string');
};

const parseOptionalTick = (value: unknown, fieldName: string): bigint | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be greater than 0`);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be a safe integer`);
    }
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be greater than 0`);
    }
    return parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must not be empty`);
    }
    try {
      const parsed = BigInt(trimmed);
      if (parsed <= 0n) {
        throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be greater than 0`);
      }
      return parsed;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be a valid integer string`);
    }
  }

  throw new ApiError(400, 'IDENTITY_BINDING_INVALID', `${fieldName} must be a number or string`);
};

const bindingRoles: IdentityBindingRole[] = ['active', 'atmosphere'];
const bindingStatuses: IdentityBindingStatus[] = ['active', 'inactive', 'expired'];

const expireIdentityBindings = async (): Promise<void> => {
  const now = sim.clock.getTicks();
  await sim.prisma.identityNodeBinding.updateMany({
    where: {
      AND: [
        { expires_at: { not: null } },
        { expires_at: { lte: now } },
        { status: { not: 'expired' } }
      ]
    },
    data: {
      status: 'expired',
      updated_at: now
    }
  });
};

app.use(cors());
app.use(express.json());
app.use(identityInjector());
app.use((req, res, next) => {
  const requestId = createRequestId();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// 模拟循环控制变量
let timer: NodeJS.Timeout | null = null;
let isPaused = false;

// --- 0. Global Notification & System ---

app.get('/api/system/notifications', (req, res) => {
  const messages = notifications.getMessages();
  res.json(messages);
});

app.post('/api/system/notifications/clear', (req, res) => {
  notifications.clear();
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  const pack = sim.getActivePack();
  res.json({
    status: isPaused ? 'paused' : 'running',
    runtime_ready: runtimeReady,
    runtime_speed: sim.getRuntimeSpeedSnapshot(),
    health_level: startupHealth.level,
    world_pack: pack ? {
      id: pack.metadata.id,
      name: pack.metadata.name,
      version: pack.metadata.version
    } : null,
    has_error: notifications.getMessages().some(m => m.level === 'error'),
    startup_errors: startupHealth.errors
  });
});

app.get('/api/health', (req, res) => {
  const statusCode = startupHealth.level === 'fail' ? 503 : 200;
  res.status(statusCode).json({
    success: startupHealth.level !== 'fail',
    level: startupHealth.level,
    runtime_ready: runtimeReady,
    checks: startupHealth.checks,
    available_world_packs: startupHealth.available_world_packs,
    errors: startupHealth.errors
  });
});

app.post('/api/runtime/speed', (req, res) => {
  assertRuntimeReady('runtime speed control');
  const { action, step_ticks } = req.body as { action?: unknown; step_ticks?: unknown };

  if (action === 'override') {
    const parsed = parsePositiveStepTicks(step_ticks);
    sim.setRuntimeSpeedOverride(parsed);
    notifications.push('info', `运行时步进已覆盖为 ${parsed.toString()}`, 'RUNTIME_SPEED_OVERRIDE', {
      step_ticks: parsed.toString(),
      override_since: sim.getRuntimeSpeedSnapshot().override_since
    });
    res.json({ success: true, runtime_speed: sim.getRuntimeSpeedSnapshot() });
    return;
  }

  if (action === 'clear') {
    sim.clearRuntimeSpeedOverride();
    notifications.push('info', '运行时步进覆盖已清除', 'RUNTIME_SPEED_OVERRIDE_CLEAR', {
      override_since: null
    });
    res.json({ success: true, runtime_speed: sim.getRuntimeSpeedSnapshot() });
    return;
  }

  throw new ApiError(400, 'RUNTIME_SPEED_ACTION_INVALID', 'Invalid action', {
    allowed_actions: ['override', 'clear']
  });
});

// --- 2. Chronos Layer (Time) ---

app.get('/api/clock', (req, res) => {
  assertRuntimeReady('clock read');
  res.json({
    absolute_ticks: sim.clock.getTicks().toString(),
    calendars: []
  });
});

app.get('/api/clock/formatted', (req, res, next) => {
  assertRuntimeReady('clock formatted read');
  try {
    res.json({
      absolute_ticks: sim.clock.getTicks().toString(),
      calendars: toJsonSafe(sim.clock.getAllTimes())
    });
  } catch (err: unknown) {
    next(new ApiError(500, 'CLOCK_FORMAT_ERR', `读取格式化时钟失败: ${getErrorMessage(err)}`));
  }
});

app.post('/api/clock/control', (req, res) => {
  assertRuntimeReady('clock control');
  const { action } = req.body;
  if (action === 'pause') {
    isPaused = true;
    notifications.push('info', '模拟已暂停');
    res.json({ success: true, status: 'paused' });
  } else if (action === 'resume') {
    isPaused = false;
    notifications.push('info', '模拟已恢复');
    res.json({ success: true, status: 'running' });
  } else {
    throw new ApiError(400, 'CLOCK_ACTION_INVALID', 'Invalid action', {
      allowed_actions: ['pause', 'resume']
    });
  }
});

// --- 3. L1: Social Layer ---

app.get('/api/social/feed', asyncHandler(async (req: IdentityRequest, res) => {
  assertRuntimeReady('social feed');
  if (!req.identity) {
    throw new ApiError(401, 'IDENTITY_REQUIRED', 'Identity is required');
  }
  const identity = req.identity;
  const limit = parseInt(req.query.limit as string) || 20;
  const posts = await sim.prisma.post.findMany({
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { author: true }
  });
  const policyService = new IdentityPolicyService(sim.prisma);
  const filtered = await Promise.all(
    posts.map(async post => {
      return policyService.filterReadableFields(
        {
          identity,
          resource: 'social_post',
          action: 'read'
        },
        post as unknown as Record<string, unknown>
      );
    })
  );
  res.json(filtered);
}));

app.post('/api/social/post', asyncHandler(async (req: IdentityRequest, res) => {
  assertRuntimeReady('social post');
  const { content } = req.body as { content?: string };

  if (!req.identity) {
    throw new ApiError(401, 'IDENTITY_REQUIRED', 'Identity is required');
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ApiError(400, 'SOCIAL_POST_INVALID', 'content is required');
  }

  const policyService = new IdentityPolicyService(sim.prisma);
  await policyService.assertWriteAllowed(
    {
      identity: req.identity,
      resource: 'social_post',
      action: 'write'
    },
    { content }
  );

  const post = await sim.prisma.post.create({
    data: {
      author_id: req.identity.id,
      content,
      created_at: sim.clock.getTicks()
    }
  });
  res.json(post);
}));

// --- 4. L2: Relational Layer ---

app.get('/api/relational/graph', asyncHandler(async (req, res) => {
  assertRuntimeReady('relational graph');
  const graph = await sim.getGraphData();
  res.json(graph);
}));

app.get('/api/relational/circles', asyncHandler(async (req, res) => {
  assertRuntimeReady('relational circles');
  const circles = await sim.prisma.circle.findMany({
    include: { members: true }
  });
  res.json(circles);
}));

app.get('/api/atmosphere/nodes', asyncHandler(async (req, res) => {
  assertRuntimeReady('atmosphere nodes');
  const ownerId = typeof req.query.owner_id === 'string' ? req.query.owner_id.trim() : '';
  const includeExpired = req.query.include_expired === 'true';
  const now = sim.clock.getTicks();

  const nodes = await sim.prisma.atmosphereNode.findMany({
    where: {
      ...(ownerId.length === 0 ? {} : { owner_id: ownerId }),
      ...(includeExpired ? {} : {
        OR: [
          { expires_at: null },
          { expires_at: { gt: now } }
        ]
      })
    },
    orderBy: { created_at: 'desc' }
  });
  res.json(nodes);
}));

// --- 5. L3: Narrative Layer ---

app.get('/api/narrative/timeline', asyncHandler(async (req, res) => {
  assertRuntimeReady('narrative timeline');
  const events = await sim.prisma.event.findMany({
    orderBy: { tick: 'desc' }
  });
  res.json(events);
}));

// --- 6. Agent Context ---

app.get('/api/agent/:id/context', asyncHandler(async (req, res) => {
  assertRuntimeReady('agent context');
  const agentId = req.params.id;
  const agent = await sim.prisma.agent.findUnique({
    where: { id: agentId },
    include: { circle_memberships: { include: { circle: true } } }
  });

  if (!agent) {
    throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', { agent_id: agentId });
  }

  // 构造权限上下文
  const permission: PermissionContext = {
    agent_id: agent.id,
    circles: new Set(agent.circle_memberships.map(m => m.circle_id)),
    global_level: Math.max(...agent.circle_memberships.map(m => m.circle.level), 0)
  };

  // 解析当前世界变量 (基于权限)
  const pack = sim.getActivePack();
  const resolvedVariables = sim.resolver.resolve(
    JSON.stringify(pack?.variables || {}),
    {},
    permission
  );

  res.json({
    identity: agent,
    variables: JSON.parse(resolvedVariables)
  });
}));

// --- 7. Identity & Policy ---

app.post('/api/identity/register', asyncHandler(async (req: IdentityRequest, res) => {
  const { id, type, name, claims, metadata } = req.body as {
    id?: string;
    type?: string;
    name?: string;
    claims?: unknown;
    metadata?: unknown;
  };

  if (!id || !type) {
    throw new ApiError(400, 'IDENTITY_INVALID', 'id and type are required');
  }

  const now = sim.clock.getTicks();
  const identity = await sim.prisma.identity.create({
    data: {
      id,
      type,
      name,
      provider: 'm2',
      status: 'active',
      claims: claims ?? undefined,
      metadata: metadata ?? undefined,
      created_at: now,
      updated_at: now
    }
  });

  res.json(identity);
}));

app.post('/api/identity/bind', asyncHandler(async (req: IdentityRequest, res) => {
  const { identity_id, agent_id, atmosphere_node_id, role, status, expires_at } = req.body as {
    identity_id?: string;
    agent_id?: string;
    atmosphere_node_id?: string;
    role?: string;
    status?: string;
    expires_at?: unknown;
  };

  if (!identity_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'identity_id is required');
  }

  if (!role || !bindingRoles.includes(role as IdentityBindingRole)) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'role must be active or atmosphere');
  }

  const hasAgent = typeof agent_id === 'string' && agent_id.trim().length > 0;
  const hasAtmosphere = typeof atmosphere_node_id === 'string' && atmosphere_node_id.trim().length > 0;

  if (hasAgent === hasAtmosphere) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'Provide exactly one of agent_id or atmosphere_node_id');
  }

  const normalizedStatus = (status ?? 'active') as string;
  if (!bindingStatuses.includes(normalizedStatus as IdentityBindingStatus)) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'status must be active, inactive, or expired');
  }

  if (normalizedStatus === 'active') {
    const existingActive = await sim.prisma.identityNodeBinding.findFirst({
      where: {
        identity_id,
        role: role as IdentityBindingRole,
        status: 'active'
      }
    });
    if (existingActive) {
      throw new ApiError(409, 'IDENTITY_BINDING_CONFLICT', 'Active binding already exists', {
        identity_id,
        role,
        binding_id: existingActive.id
      });
    }
  }

  const expiresAt = parseOptionalTick(expires_at, 'expires_at');

  const now = sim.clock.getTicks();
  const binding = await sim.prisma.identityNodeBinding.create({
    data: {
      identity_id,
      agent_id: hasAgent ? agent_id : null,
      atmosphere_node_id: hasAtmosphere ? atmosphere_node_id : null,
      role: role as IdentityBindingRole,
      status: normalizedStatus as IdentityBindingStatus,
      expires_at: expiresAt ?? undefined,
      created_at: now,
      updated_at: now
    }
  });

  res.json(binding);
}));

app.post('/api/identity/bindings/query', asyncHandler(async (req: IdentityRequest, res) => {
  const { identity_id, role, status, include_expired, agent_id, atmosphere_node_id } = req.body as {
    identity_id?: string;
    role?: string;
    status?: string;
    include_expired?: boolean;
    agent_id?: string;
    atmosphere_node_id?: string;
  };

  if (!identity_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'identity_id is required');
  }

  const hasAgentFilter = typeof agent_id === 'string' && agent_id.trim().length > 0;
  const hasAtmosphereFilter = typeof atmosphere_node_id === 'string' && atmosphere_node_id.trim().length > 0;
  if (hasAgentFilter && hasAtmosphereFilter) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'Provide only one of agent_id or atmosphere_node_id');
  }

  const where: {
    identity_id: string;
    role?: IdentityBindingRole;
    status?: IdentityBindingStatus | { not: 'expired' };
    agent_id?: string;
    atmosphere_node_id?: string;
  } = {
    identity_id
  };

  if (role) {
    if (!bindingRoles.includes(role as IdentityBindingRole)) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'role must be active or atmosphere');
    }
    where.role = role as IdentityBindingRole;
  }

  if (status) {
    if (!bindingStatuses.includes(status as IdentityBindingStatus)) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'status must be active, inactive, or expired');
    }
    where.status = status as IdentityBindingStatus;
  } else if (!include_expired) {
    where.status = { not: 'expired' };
  }

  if (hasAgentFilter) {
    where.agent_id = agent_id;
  }
  if (hasAtmosphereFilter) {
    where.atmosphere_node_id = atmosphere_node_id;
  }

  const bindings = await sim.prisma.identityNodeBinding.findMany({
    where,
    orderBy: { created_at: 'desc' }
  });

  res.json(bindings);
}));

app.post('/api/identity/bindings/unbind', asyncHandler(async (req: IdentityRequest, res) => {
  const { binding_id, status } = req.body as {
    binding_id?: string;
    status?: string;
  };

  if (!binding_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'binding_id is required');
  }

  const existing = await sim.prisma.identityNodeBinding.findUnique({
    where: { id: binding_id }
  });
  if (!existing) {
    throw new ApiError(404, 'IDENTITY_BINDING_NOT_FOUND', 'Binding not found', { binding_id });
  }


  if (status && !bindingStatuses.includes(status as IdentityBindingStatus)) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'status must be active, inactive, or expired');
  }

  const now = sim.clock.getTicks();
  const binding = await sim.prisma.identityNodeBinding.update({
    where: { id: binding_id },
    data: {
      status: (status ?? 'inactive') as IdentityBindingStatus,
      updated_at: now
    }
  });

  res.json(binding);
}));

app.post('/api/identity/bindings/expire', asyncHandler(async (req: IdentityRequest, res) => {
  const { binding_id } = req.body as {
    binding_id?: string;
  };

  if (!binding_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'binding_id is required');
  }


  const existing = await sim.prisma.identityNodeBinding.findUnique({
    where: { id: binding_id }
  });
  if (!existing) {
    throw new ApiError(404, 'IDENTITY_BINDING_NOT_FOUND', 'Binding not found', { binding_id });
  }

  const now = sim.clock.getTicks();
  const binding = await sim.prisma.identityNodeBinding.update({
    where: { id: binding_id },
    data: {
      status: 'expired',
      expires_at: now,
      updated_at: now
    }
  });

  res.json(binding);
}));

app.post('/api/policy', asyncHandler(async (req: IdentityRequest, res) => {
  const {
    effect,
    subject_id,
    subject_type,
    resource,
    action,
    field,
    conditions,
    priority
  } = req.body as {
    effect?: string;
    subject_id?: string;
    subject_type?: string;
    resource?: string;
    action?: string;
    field?: string;
    conditions?: unknown;
    priority?: number;
  };

  if (!effect || !resource || !action || !field) {
    throw new ApiError(400, 'POLICY_INVALID', 'effect, resource, action, field are required');
  }

  if (effect !== 'allow' && effect !== 'deny') {
    throw new ApiError(400, 'POLICY_INVALID', 'effect must be allow or deny');
  }

  const validatedConditions = validatePolicyConditions(conditions);

  const now = sim.clock.getTicks();
  const policy = await sim.prisma.policy.create({
    data: {
      effect,
      subject_id: subject_id ?? null,
      subject_type: subject_type ?? null,
      resource,
      action,
      field,
      conditions:
        Object.keys(validatedConditions).length > 0
          ? (validatedConditions as Prisma.InputJsonValue)
          : undefined,
      priority: priority ?? 0,
      created_at: now,
      updated_at: now
    }
  });

  res.json(policy);
}));

app.post('/api/policy/evaluate', asyncHandler(async (req: IdentityRequest, res) => {
  const { resource, action, fields, attributes } = req.body as {
    resource?: string;
    action?: string;
    fields?: string[];
    attributes?: Record<string, unknown>;
  };

  if (!resource || !action || !fields) {
    throw new ApiError(400, 'POLICY_EVAL_INVALID', 'resource, action, fields are required');
  }

  if (!req.identity) {
    throw new ApiError(401, 'IDENTITY_REQUIRED', 'Identity is required');
  }

  const service = new IdentityPolicyService(sim.prisma);
  const result = await service.evaluateFields(
    {
      identity: req.identity,
      resource,
      action,
      attributes
    },
    fields
  );

  const details = await service.explainFieldDecisions(
    {
      identity: req.identity,
      resource,
      action,
      attributes
    },
    fields
  );

  res.json({
    allowed_fields: Array.from(result.allowedFields),
    denied_fields: Array.from(result.deniedFields),
    has_wildcard_allow: result.hasWildcardAllow,
    details
  });
}));

// --- Error Middleware ---

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : 'req_unknown';
  const isApiError = err instanceof ApiError;
  const status = isApiError ? err.status : 500;
  const code = isApiError ? err.code : 'API_INTERNAL_ERROR';
  const message = getErrorMessage(err);
  const details = isApiError ? err.details : undefined;

  if (status >= 500) {
    console.error(`[Global Error Middleware] [${requestId}]`, err);
    notifications.push('error', `API 异常(${code}): ${message}`, code);
  } else {
    console.warn(`[API Warning] [${requestId}] ${code}: ${message}`);
    notifications.push('warning', `API 请求异常(${code}): ${message}`, code);
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      request_id: requestId,
      timestamp: Date.now(),
      ...(details === undefined ? {} : { details })
    }
  });
});

// --- Start Loop & Server ---

const startSimulation = () => {
  if (!runtimeReady) {
    return;
  }

  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    if (!isPaused) {
      try {
        await expireIdentityBindings();
        await sim.step(sim.getStepTicks());
      } catch (err: unknown) {
        notifications.push(
          'error',
          `模拟步进失败 (可能存在 BigInt 异常): ${getErrorMessage(err)}`,
          'SIM_STEP_ERR'
        );
        isPaused = true; // 发生致命错误时自动暂停
      }
    }
  }, 1000);
};

const start = async () => {
  await runStartupPreflight();

  try {
    if (startupHealth.level === 'fail') {
      runtimeReady = false;
      notifications.push('error', `系统启动健康检查失败: ${startupHealth.errors.join('; ')}`, 'SYS_PRECHECK_FAIL');
    } else if (!startupHealth.checks.world_pack_available) {
      runtimeReady = false;
      notifications.push('warning', '世界包为空，系统以降级模式启动。请先导入 world pack。', 'WORLD_PACK_EMPTY');
    } else {
      const selectedPack = startupHealth.available_world_packs.includes(preferredWorldPack)
        ? preferredWorldPack
        : startupHealth.available_world_packs[0];
      await sim.init(selectedPack);
      runtimeReady = true;
      notifications.push('info', `Yidhras 系统初始化成功 (pack=${selectedPack})`, 'SYS_INIT_OK');
      startSimulation();
    }
  } catch (err: unknown) {
    runtimeReady = false;
    startupHealth.level = 'degraded';
    startupHealth.errors.push(`simulation init failed: ${getErrorMessage(err)}`);
    console.error('[Yidhras Server] Init Error:', err);
    notifications.push('error', `系统初始化失败，已降级运行: ${getErrorMessage(err)}`, 'SYS_INIT_FAIL');
  }

  app.listen(port, () => {
    console.log(`[Yidhras Server] API full implementation running at http://localhost:${port}`);
  });
};

start();
