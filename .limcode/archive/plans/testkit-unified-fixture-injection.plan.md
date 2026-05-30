## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 1: 创建 `MutableTestContext` 类型，消除 `(context as { ... }).prop = x` 模式 `#TK-1`
- [x] Phase 2: 实现 `TestKit` 类，统一环境创建 → 迁移 → Prisma → AppContext 全流程 `#TK-2`
- [x] Phase 3: 添加 `vitest.config.ts` 的 `globalSetup` — 一次性 DB 模板创建 `#TK-3`
- [x] Phase 4: 添加 `setupFiles` — 由 TestKit 内建 env 管理替代 `#TK-4`
- [x] Phase 5: 迁移所有集成测试到 TestKit（30 个文件），消除不一致的 setup 模式 `#TK-5`
- [x] Phase 6: 迁移 E2E 测试的服务器启动到 TestKit wrapper `#TK-6`
- [x] Phase 7: typecheck + lint + unit 全量验证 `#TK-7`
<!-- LIMCODE_TODO_LIST_END -->

# 测试夹具统一：TestKit + vitest 集成

## 背景

当前测试基础设施的 10 个具体问题（详见对话中的审计报告）：

| # | 问题 | 影响 |
|---|------|------|
| 1 | 无 `globalSetup`/`setupFiles`，每个测试文件手动管理生命周期 | 重复代码、不一致 |
| 2 | 集成测试 setup 模式分裂：`createIsolatedAppContextFixture()` vs 手动组装 | 新人困惑、bug 风险 |
| 3 | Mock 注入依赖类型断言 `(context as { schedulerStorage: ... }).schedulerStorage = adapter` | 类型安全被架空 |
| 4 | `runtimePreparationPromise` 模块级单例存在竞争风险 | 潜在 flaky test |
| 5 | `beforeAll` 失败时遗留孤立的 `/tmp/yidhras-vitest-*` 目录 | 磁盘泄漏 |
| 6 | `process.env.WORKSPACE_ROOT` 等跨测试突变 | 测试间污染 |
| 7 | `runtime.ts` 280 行、`scheduler_storage.ts` 780 行 — 单体过大 | 可发现性差 |
| 8 | 测试超时包含 `prisma migrate deploy` 时间，CI 环境可能超时 | flaky CI |
| 9 | E2E 服务器启动轮询无日志输出，超时前沉默 | 调试困难 |
| 10 | `test.yaml` 配置被复制但从未被使用 | 死代码 |

项目处于预发布阶段，不受向后兼容约束。

---

## 本次范围

### 纳入

1. `TestKit` 类 — 统一环境创建、DB 迁移、Prisma Client、AppContext 构建
2. `MutableTestContext` 类型 — 类型安全的 mock 注入
3. vitest `globalSetup` — 一次性 DB 模板创建，消除 per-file 迁移
4. vitest `setupFiles` — env 快照/恢复
5. 迁移所有集成测试到新模式
6. E2E 测试的 `withIsolatedTestServer` 重构为 TestKit 子类

### 不纳入

1. 单元测试 — 单元测试不依赖数据库/AppContext，不在本轮
2. Web 前端测试 — 不在本轮
3. 测试覆盖率提升 — 不在本轮
4. `MemSchedulerStorage` 780 行适配器的逻辑重构 — 只移动位置

---

## Phase 1: `MutableTestContext` 类型

**新建文件**: `apps/server/tests/types.ts`

```typescript
import type { AppContext } from '../src/app/context.js';
import type { SchedulerStorageAdapter } from '../src/packs/storage/SchedulerStorageAdapter.js';
import type { PackStorageAdapter } from '../src/packs/storage/PackStorageAdapter.js';
import type { ConversationStore } from '../src/conversation/store.js';
import type { NotificationStore, RuntimeLoopDiagnostics, StartupHealth } from '../src/app/context.js';

/**
 * AppContext 的测试变体，允许在测试中直接替换特定服务。
 * 仅用于测试夹具，生产代码不可用。
 */
export interface MutableTestContext extends AppContext {
  schedulerStorage: SchedulerStorageAdapter;
  packStorageAdapter: PackStorageAdapter;
  conversationStore: ConversationStore;
  notifications: NotificationStore;
  startupHealth: StartupHealth;
  runtimeLoopDiagnostics: RuntimeLoopDiagnostics;
}
```

所有当前使用 `(context as { schedulerStorage: ... }).schedulerStorage = adapter` 的地方改为：

```typescript
import type { MutableTestContext } from '../../types.js';
const ctx = context as MutableTestContext;
ctx.schedulerStorage = new MemSchedulerStorage();
```

收益：如果 `AppContext` 上 `schedulerStorage` 重命名，类型检查会报错，而非静默失败。

---

## Phase 2: `TestKit` 类

**新建文件**: `apps/server/tests/testkit.ts`

```typescript
import path from 'path';
import os from 'os';
import { fs as memFs } from 'memfs';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../src/db/client.js';
import { createPrismaRepositories } from '../src/app/services/repositories/index.js';
import { createTestAppContext } from './fixtures/app-context.js';
import { createIsolatedRuntimeEnvironment } from './helpers/runtime.js';
import { migrateIsolatedDatabase } from './helpers/runtime.js';
import type { MutableTestContext } from './types.js';
import type { SchedulerStorageAdapter } from '../src/packs/storage/SchedulerStorageAdapter.js';

export interface TestKitOptions {
  /** 覆盖 SCHEDULER_WORKER_INDEX 等环境变量 */
  env?: Record<string, string>;
  /** 自定义 scheduler 存储适配器 */
  schedulerStorage?: SchedulerStorageAdapter;
  /** 跳过 DB 迁移（当使用 globalSetup 预构建模板时） */
  skipMigration?: boolean;
}

export class TestKit implements AsyncDisposable {
  readonly tempDir: string;
  readonly databaseUrl: string;
  prisma!: PrismaClient;
  context!: MutableTestContext;
  private cleanupStack: Array<() => Promise<void>> = [];
  private disposed = false;

  private constructor(tempDir: string, databaseUrl: string) {
    this.tempDir = tempDir;
    this.databaseUrl = databaseUrl;
  }

  static async create(options: TestKitOptions = {}): Promise<TestKit> {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'yidhras-test-')
    );

    // 应用 env 覆盖
    const prevEnv: Record<string, string | undefined> = {};
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        prevEnv[k] = process.env[k];
        process.env[k] = v;
      }
    }

    let databaseUrl: string;
    try {
      // 1. 创建隔离环境（复制 seeds 包、config 模板、AI 模型配置）
      const isolation = await createIsolatedRuntimeEnvironment(tempDir);
      databaseUrl = isolation.envOverrides.DATABASE_URL!;

      const kit = new TestKit(tempDir, databaseUrl);
      kit.cleanupStack.push(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      });

      // 2. DB 迁移（除非跳过，当使用 globalSetup 模板时）
      if (!options.skipMigration) {
        await migrateIsolatedDatabase(isolation);
      }

      // 3. 创建 PrismaClient
      kit.prisma = createPrismaClient(); // 使用环境变量中的 DATABASE_URL
      kit.cleanupStack.push(async () => {
        await kit.prisma.$disconnect();
      });

      // 4. 构建 Test AppContext
      const baseContext = createTestAppContext(kit.prisma);
      kit.context = baseContext as MutableTestContext;

      // 5. 应用覆盖
      if (options.schedulerStorage) {
        kit.context.schedulerStorage = options.schedulerStorage;
      }

      return kit;
    } catch (err) {
      // 构造失败时确保清理
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    } finally {
      // 恢复 env
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  /** 链式覆盖 scheduler 存储 */
  withSchedulerStorage(adapter: SchedulerStorageAdapter): this {
    this.context.schedulerStorage = adapter;
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const fn of this.cleanupStack.reverse()) {
      await fn();
    }
  }
}
```

**关键设计决策：**

- `AsyncDisposable` 而非 `afterAll` 手动调用 — `Symbol.asyncDispose` 可以在 `beforeAll` 失败时通过 `try/finally` 保证调用
- 构造失败时立即清理临时目录，不留孤岛
- `env` 覆盖在 `finally` 块中恢复，不依赖 afterAll
- 链式 API（`withSchedulerStorage`）替代多次类型断言

---

## Phase 3: `globalSetup` — 一次性 DB 模板

**新建文件**: `apps/server/tests/support/global_setup.ts`

```typescript
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

/**
 * vitest globalSetup — 在 vitest 的独立上下文中运行一次。
 * 创建预迁移的 SQLite 模板数据库，后续测试文件直接复制而非重复迁移。
 */
export async function setup(): Promise<() => Promise<void>> {
  const templateDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yidhras-test-template-')
  );

  // 创建最小隔离环境
  const isolation = await createIsolatedRuntimeEnvironment(templateDir);

  // 运行一次 prisma migrate deploy
  execSync('pnpm --filter yidhras-server prisma migrate deploy', {
    env: { ...process.env, ...isolation.envOverrides },
    stdio: 'pipe'
  });

  // 模板数据库路径传递给 worker
  process.env.YIDHRAS_TEST_DB_TEMPLATE = isolation.envOverrides.DATABASE_URL;

  return async () => {
    // globalTeardown
    await fs.promises.rm(templateDir, { recursive: true, force: true });
  };
}
```

**修改**: `vitest.integration.config.ts` 和 `vitest.e2e.config.ts`

```typescript
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    globalSetup: ['tests/support/global_setup.ts'],
  }
});
```

---

## Phase 4: `setupFiles` — env 快照/恢复

**新建文件**: `apps/server/tests/support/setup_files.ts`

```typescript
/**
 * 每个测试文件运行前快照 process.env，运行后恢复。
 * 消除跨测试文件的 env 泄漏。
 */

let envSnapshot: Record<string, string | undefined> = {};

beforeAll(() => {
  // 快照关键环境变量
  const keys = [
    'DATABASE_URL', 'WORKSPACE_ROOT', 'APP_ENV',
    'SCHEDULER_WORKER_INDEX', 'SCHEDULER_WORKER_TOTAL',
    'PRISMA_DB_PROVIDER'
  ];
  for (const k of keys) {
    envSnapshot[k] = process.env[k];
  }
});

afterAll(() => {
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
```

---

## Phase 5: 迁移集成测试

**迁移模式** — 以 `scheduler-ownership-migration.spec.ts` 为例：

**Before:**
```typescript
let cleanup: (() => Promise<void>) | null = null;
let context: AppContext;

beforeAll(async () => {
  const fixture = await createIsolatedAppContextFixture();
  cleanup = fixture.cleanup;
  context = fixture.context;
});

afterAll(async () => {
  await cleanup?.();
});
```

**After:**
```typescript
let kit: TestKit;

beforeAll(async () => {
  kit = await TestKit.create()
    .withSchedulerStorage(new MemSchedulerStorage());
  (kit.context.schedulerStorage as MemSchedulerStorage).open(TEST_PACK_ID);
});

afterAll(async () => {
  await kit[Symbol.asyncDispose]();
});

test('...', async () => {
  const result = await someService(kit.context, kit.prisma);
});
```

### 迁移顺序

1. `scheduler-ownership-migration.spec.ts` — 最典型的集成测试
2. `pack_lifecycle.spec.ts` — 当前手动组装，受益最大
3. 其余集成测试文件

---

## Phase 6: E2E TestKit 扩展

**新建文件**: `apps/server/tests/testkit_e2e.ts`

```typescript
import { TestKit } from './testkit.js';

export class E2ETestKit extends TestKit {
  private serverProcess: ChildProcess | null = null;
  baseUrl!: string;

  static override async create(options: TestKitOptions = {}): Promise<E2ETestKit> {
    const kit = await super.create(options) as E2ETestKit;
    // E2E 额外：启动 HTTP 服务器
    await kit.startServer();
    await kit.waitForReady();
    return kit;
  }

  private async startServer(): Promise<void> {
    // 复用现有的 startServer 逻辑，但加入超时日志
  }

  private async waitForReady(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.baseUrl}/api/health`);
        if (res.ok) return;
      } catch { /* server not ready yet */ }
      // 每 5 秒输出一次进度
      if ((Date.now() - start) % 5000 < 250) {
        console.log(`[E2ETestKit] waiting for server... ${Math.round((Date.now() - start) / 1000)}s`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Server failed to start within ${timeoutMs}ms. Check server logs.`);
  }

  override async [Symbol.asyncDispose](): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 1000));
    }
    await super[Symbol.asyncDispose]();
  }
}
```

---

## Phase 7: 验证

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
```

### 验证标准

- 所有现有测试通过
- 零 `(context as { ... }).prop = x` 类型断言出现（改用 `MutableTestContext`）
- 不再有直接调用 `createIsolatedRuntimeEnvironment` + `migrateIsolatedDatabase` + `createPrismaClient*` 的测试（统一为 `TestKit.create()`）
- `globalSetup` 模板创建成功，集成测试执行时间减少（per-file 迁移被模板复制替代）
- `setupFiles` 的 env 快照/恢复生效 — 测试间无 env 泄漏
