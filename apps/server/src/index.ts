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

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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
  try {
    res.json({
      absolute_ticks: sim.clock.getTicks().toString(),
      calendars: sim.clock.getAllTimes()
    });
  } catch (err: unknown) {
    notifications.push('error', `读取时钟失败: ${getErrorMessage(err)}`, 'CLOCK_READ_ERR');
    res.status(500).json({ error: 'Clock internal error' });
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
    res.status(400).json({ error: 'Invalid action' });
  }
});

// --- 3. L1: Social Layer ---

app.get('/api/social/feed', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const posts = await sim.prisma.post.findMany({
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { author: true }
  });
  res.json(posts);
});

app.post('/api/social/post', async (req, res) => {
  const { author_id, content } = req.body;
  try {
    const post = await sim.prisma.post.create({
      data: {
        author_id,
        content,
        created_at: sim.clock.getTicks()
      }
    });
    res.json(post);
  } catch (err: unknown) {
    notifications.push('error', `发布动态失败: ${getErrorMessage(err)}`, 'POST_CREATE_ERR');
    res.status(500).json({ error: 'Post creation failed' });
  }
});

// --- 4. L2: Relational Layer ---

app.get('/api/relational/graph', async (req, res) => {
  const graph = await sim.getGraphData();
  res.json(graph);
});

app.get('/api/relational/circles', async (req, res) => {
  const circles = await sim.prisma.circle.findMany({
    include: { members: true }
  });
  res.json(circles);
});

// --- 5. L3: Narrative Layer ---

app.get('/api/narrative/timeline', async (req, res) => {
  const events = await sim.prisma.event.findMany({
    orderBy: { tick: 'desc' }
  });
  res.json(events);
});

// --- 6. Agent Context ---

app.get('/api/agent/:id/context', async (req, res) => {
  const agentId = req.params.id;
  try {
    const agent = await sim.prisma.agent.findUnique({
      where: { id: agentId },
      include: { circle_memberships: { include: { circle: true } } }
    });

    if (!agent) return res.status(404).json({ error: 'Agent not found' });

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
  } catch (err: unknown) {
    notifications.push('warning', `解析 Agent 上下文失败: ${getErrorMessage(err)}`, 'AGENT_CONTEXT_ERR');
    res.status(500).json({ error: 'Internal resolver error' });
  }
});

// --- Error Middleware ---

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error('[Global Error Middleware]', err);
  const message = getErrorMessage(err);
  notifications.push('error', `API 异常: ${message || '未知错误'}`, 'API_CRASH');
  res.status(500).json({
    error: 'Internal Server Error',
    message
  });
});

// --- Start Loop & Server ---

const startSimulation = () => {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    if (!isPaused) {
      try {
        await sim.step(1n);
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
