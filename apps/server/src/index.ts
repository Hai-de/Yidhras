import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';

import { sim } from './core/simulation.js';
import { PermissionContext } from './permission/types.js';
import { notifications } from './utils/notifications.js';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
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
    world_pack: pack ? {
      id: pack.metadata.id,
      name: pack.metadata.name,
      version: pack.metadata.version
    } : null,
    has_error: notifications.getMessages().some(m => m.level === 'error')
  });
});

// --- 2. Chronos Layer (Time) ---

app.get('/api/clock', (req, res) => {
  res.json({
    absolute_ticks: sim.clock.getTicks().toString(),
    calendars: []
  });
});

app.get('/api/clock/formatted', (req, res, next) => {
  try {
    res.json({
      absolute_ticks: sim.clock.getTicks().toString(),
      calendars: sim.clock.getAllTimes()
    });
  } catch (err: unknown) {
    next(new ApiError(500, 'CLOCK_FORMAT_ERR', `读取格式化时钟失败: ${getErrorMessage(err)}`));
  }
});

app.post('/api/clock/control', (req, res) => {
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
  const limit = parseInt(req.query.limit as string) || 20;
  const posts = await sim.prisma.post.findMany({
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { author: true }
  });
  res.json(posts);
}));

app.post('/api/social/post', asyncHandler(async (req, res) => {
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
  const graph = await sim.getGraphData();
  res.json(graph);
}));

app.get('/api/relational/circles', asyncHandler(async (req, res) => {
  const circles = await sim.prisma.circle.findMany({
    include: { members: true }
  });
  res.json(circles);
}));

// --- 5. L3: Narrative Layer ---

app.get('/api/narrative/timeline', asyncHandler(async (req, res) => {
  const events = await sim.prisma.event.findMany({
    orderBy: { tick: 'desc' }
  });
  res.json(events);
}));

// --- 6. Agent Context ---

app.get('/api/agent/:id/context', asyncHandler(async (req, res) => {
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
  try {
    await sim.init('cyber_noir');
    notifications.push('info', 'Yidhras 系统初始化成功', 'SYS_INIT_OK');
    startSimulation();
    app.listen(port, () => {
      console.log(`[Yidhras Server] API full implementation running at http://localhost:${port}`);
    });
  } catch (err: unknown) {
    console.error('[Yidhras Server] Init Error:', err);
    notifications.push('error', `系统初始化失败: ${getErrorMessage(err)}`, 'SYS_INIT_FAIL');
  }
};

start();
