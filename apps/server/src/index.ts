import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { sim } from './core/simulation.js';
import { PermissionContext } from './permission/types.js';
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

class ApiError extends Error {
  public status: number;
  public code: string;
  public details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

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

app.use(cors());
app.use(express.json());
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

app.get('/api/social/feed', asyncHandler(async (req, res) => {
  assertRuntimeReady('social feed');
  const limit = parseInt(req.query.limit as string) || 20;
  const posts = await sim.prisma.post.findMany({
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { author: true }
  });
  res.json(posts);
}));

app.post('/api/social/post', asyncHandler(async (req, res) => {
  assertRuntimeReady('social post');
  const { author_id, content } = req.body;

  const post = await sim.prisma.post.create({
    data: {
      author_id,
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
