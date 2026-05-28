## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 1: 定义 `RouteModule` 统一接口，消除 per-file `XxxRouteDependencies` `#RR-1`
- [x] Phase 2: 所有路由文件改为直接导入 `asyncHandler`，导出 `RouteModule` `#RR-2`
- [x] Phase 3: 创建 `routes/index.ts` 作为唯一 re-export 聚合点 `#RR-3`
- [x] Phase 4: 创建 `routes/packs/index.ts` 作为 pack-scoped 路由聚合点 `#RR-4`
- [x] Phase 5: 重写 `apps/server/src/index.ts` 中的 `registerRoutes`，用循环替代逐个调用 `#RR-5`
- [x] Phase 6: typecheck + unit + integration + e2e 全量验证 `#RR-6`

## 附：既有问题修复

在 TestKit 迁移后排查了全部集成测试失败，修复了以下既有 bug：

| 文件 | 问题 | 修复 |
|------|------|------|
| `src/conversation/assembler.ts:387` | `bundle.combined_prompt` 为 undefined 时 TypeError | `combined_prompt?.length ?? 0` 防御 |
| `tests/integration/ai-gateway-fallback.spec.ts` | `prompt_bundle_v2` 缺少 `combined_prompt` 字段 | 补充字段 |
| `tests/integration/ai-gateway-template.spec.ts` | `prompt_bundle_v2: {}` 空对象 | 补充 `combined_prompt` + `messages` |
| `tests/integration/behavior_control_executor.spec.ts` | `evaluateBuiltinCondition` 从 `context.agent_conversation_memory` 读取，但测试只在 `state.ai_messages` 设置数据 | 修改 `makeMinimalContext` 接受 overrides，4 个测试传入 `agent_conversation_memory` |
| `tests/integration/pack_lifecycle.spec.ts` | 测试用 `metadata.id` 作为 runtime instance_id，但实际 instance_id 是 folder name | 区分 `EXAMPLE_PACK_ID`（folder name）和 `EXAMPLE_PACK_META_ID`（metadata.id） |
| `tests/integration/pack_chaos.spec.ts` | 同上 | 同上 |
| `tests/integration/pack_clock_isolation.spec.ts` | 同上 + `pack_id` 属性不存在（应为 `instance_id`） | 同上 |
| `tests/integration/multi_pack_symmetry.spec.ts` | 同上 + `pack_id` → `instance_id`/`metadata_id` | 同上 |
| `tests/integration/pack_snapshot.spec.ts` | TestKit 创建后覆盖了测试自定义的 WORKSPACE_ROOT | 调整 beforeAll 顺序：先 TestKit.create()，再设 WORKSPACE_ROOT |

**剩余未修复（既有，非本次变更引入）：**
- `agent-scheduler` / `death-note-memory-loop` / `scheduler-multi-worker-partitioning` — 需 `cargo build` 编译 Rust sidecar
- `conversation/pipeline_edge_cases`（2 tests）— assembler 对 null memory 的处理与测试预期不一致
- `pack_snapshot`（1 test，restore Prisma data）— 既有 bug
<!-- LIMCODE_TODO_LIST_END -->

# 路由注册样板消除

## 背景

当前路由注册有三层样板：

1. **`asyncHandler` 被注入而非导入**。`asyncHandler` 是零依赖纯函数（`async_handler.ts:9-17`），却在每个路由文件中通过 `XxxRouteDependencies` 接口传递。每个文件为此付出 3-5 行的接口定义。

2. **中心文件手动 import + call**。`index.ts` 有 17 个 import + 17 个调用；`packs/index.ts` 有 14 个 import + 14 个调用。新增路由必须同时修改路由文件和中心文件。

3. **注入模式不统一**。全局路由有些收 `{ asyncHandler }` deps，有些不收（`system.ts`、`openapi.ts` 直接裸写）；pack-scoped 路由还额外注入 `inferenceService`、`parseOptionalTick` 等。

目标：消除样板但保持显式性 — 不做文件系统扫描，不做装饰器。

---

## 本次范围

### 纳入

1. 定义 `RouteModule` 统一接口
2. 所有路由文件改为直接导入 `asyncHandler`
3. 用 re-export + 收集循环替代手动逐个调用
4. 统一 pack-scoped 路由的额外依赖注入方式

### 不纳入

1. 自动文件系统扫描/glob — 保持显式 import
2. 装饰器/反射元数据
3. Express → Fastify/Koa 迁移
4. 路由文件自身的业务逻辑重构

---

## Phase 1: 定义 `RouteModule` 统一接口

**新建文件**: `apps/server/src/app/routes/types.ts`

```typescript
import type { Express } from 'express';
import type { AppContext } from '../context.js';

export interface RouteModule {
  register(app: Express, context: AppContext): void;
}
```

全局路由直接实现此接口。pack-scoped 路由使用变体：

```typescript
// 当路由需要 asyncHandler 时 — 不再需要，直接 import
// 当路由需要额外服务时 — 通过闭包/高阶函数
export type RouteModuleFactory = (deps: RouteServices) => RouteModule;
```

---

## Phase 2: 所有路由文件改为直接导入 `asyncHandler`

**每个路由文件的变更模式**（以 `overview.ts` 为例）：

**Before:**
```typescript
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';

export interface OverviewRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerOverviewRoutes = (
  app: Express,
  context: AppContext,
  deps: OverviewRouteDependencies
): void => {
  app.get('/api/overview/summary', deps.asyncHandler(async (_req, res) => {
    // ...
  }));
};
```

**After:**
```typescript
import type { AppContext } from '../context.js';
import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import type { RouteModule } from './types.js';

export const overviewRoutes: RouteModule = {
  register(app, context) {
    app.get('/api/overview/summary', asyncHandler(async (_req, res) => {
      // ...
    }));
  }
};
```

### 受影响的文件清单

**全局路由（17 个文件）：**
- `routes/system.ts` — 当前无 deps，改为 `RouteModule`
- `routes/openapi.ts` — 当前无 deps，改为 `RouteModule`
- `routes/packs.ts` — 当前使用 `(app, context, worldPacksDir)`，改为 `RouteModuleFactory`
- `routes/pack_frontend_assets.ts` — 同上
- `routes/pack_actions.ts` — 当前使用 `(app, context, queryHandlerRegistry)`
- `routes/experimental_runtime.ts` — 当前使用 deps
- `routes/config.ts` — 当前使用 deps
- `routes/config_backup.ts` — 当前使用 deps
- `routes/plugins.ts` — 当前使用 deps
- `routes/plugin_runtime_server.ts` — 当前使用 deps
- `routes/plugin_runtime_web.ts` — 当前使用 deps
- `routes/operator_auth.ts` — 当前使用 deps
- `routes/operators.ts` — 当前使用 deps
- `routes/operator_pack_bindings.ts` — 当前使用 deps
- `routes/operator_agent_bindings.ts` — 当前使用 deps
- `routes/operator_grants.ts` — 当前使用 deps
- `routes/operator_audit.ts` — 当前使用 deps

**Pack-scoped 路由（14 个文件，均在 `routes/` 下）：**
- `routes/inference.ts` — 需要 `inferenceService`
- `routes/overview.ts`
- `routes/pack_openings.ts`
- `routes/pack_snapshots.ts`
- `routes/graph.ts`
- `routes/clock.ts` — 需要 `toJsonSafe`、`getErrorMessage`
- `routes/experimental_pack_projection.ts`
- `routes/social.ts`
- `routes/relational.ts`
- `routes/narrative.ts`
- `routes/agent.ts`
- `routes/audit.ts`
- `routes/identity.ts` — 需要 `parseOptionalTick`
- `routes/scheduler.ts`

---

## Phase 3: 创建全局路由聚合点

**重写**: `apps/server/src/app/routes/index.ts`（新建，替代当前分散在 `index.ts` 中的调用）

```typescript
// 显式 re-export 每个路由模块
export { packListRoutes } from './packs.js';
export { packFrontendAssetRoutes } from './pack_frontend_assets.js';
export { packActionsRoute } from './pack_actions.js';
export { experimentalRuntimeRoutes } from './experimental_runtime.js';
export { openApiRoute } from './openapi.js';
export { systemRoutes } from './system.js';
export { configBackupRoutes } from './config_backup.js';
export { configRoutes } from './config.js';
export { pluginRoutes } from './plugins.js';
export { pluginRuntimeServerRoutes } from './plugin_runtime_server.js';
export { pluginRuntimeWebRoutes } from './plugin_runtime_web.js';
export { operatorAuthRoutes } from './operator_auth.js';
export { operatorRoutes } from './operators.js';
export { packBindingRoutes } from './operator_pack_bindings.js';
export { agentBindingRoutes } from './operator_agent_bindings.js';
export { grantRoutes } from './operator_grants.js';
export { operatorAuditRoutes } from './operator_audit.js';

import * as self from './index.js';

// 自动收集所有 RouteModule 导出
function isRouteModule(v: unknown): v is { register: Function } {
  return typeof v === 'object' && v !== null && 'register' in v;
}

export const allGlobalRoutes = Object.values(self).filter(isRouteModule);
```

新增路由时只需在此文件加一行 `export { xRoutes } from './x.js'`，无需修改 `index.ts` 调用点。

---

## Phase 4: 创建 pack-scoped 路由聚合点

**重写**: `apps/server/src/app/routes/packs/index.ts`

```typescript
import type { Express, Router } from 'express';
import { Router as createRouter } from 'express';
import type { InferenceService } from '../../../inference/service.js';
import type { AppContext } from '../../context.js';
import type { PackScopeResolver } from '../../runtime/PackScopeResolver.js';

// 显式 re-export
export { inferenceRoutes } from '../inference.js';
export { overviewRoutes } from '../overview.js';
// ... 全部 14 个

import * as self from './index.js';

interface PackRoutesDeps {
  inferenceService: InferenceService;
  scopeResolver: PackScopeResolver;
  parseOptionalTick?: (value: unknown, fieldName: string) => bigint | null;
  toJsonSafe?: (value: unknown) => unknown;
  getErrorMessage?: (err: unknown) => string;
}

export function createPackRouter(context: AppContext, deps: PackRoutesDeps): Router {
  const router = createRouter({ mergeParams: true }) as unknown as Express;

  // 需要额外服务的路由通过参数传递，不需要的直接调用 register
  for (const mod of Object.values(self)) {
    if (typeof mod === 'function') {
      mod(router, context, deps);  // factory 模式的路由
    } else if (mod && typeof mod === 'object' && 'register' in mod) {
      (mod as { register: Function }).register(router, context);
    }
  }

  return router;
}
```

对于需要额外服务的路由（如 `inference.ts` 需要 `inferenceService`），改用 factory 导出：

```typescript
// routes/inference.ts
import type { InferenceService } from '../inference/service.js';

export const inferenceRoutes = (router: Express, context: AppContext, deps: { inferenceService: InferenceService }) => {
  // ...
};
```

---

## Phase 5: 重写 `index.ts` 中的 `registerRoutes`

**Before** (`index.ts:287-320`):
```typescript
const registerRoutes: RouteRegistrar = (application, context) => {
  registerPackListRoutes(application, context, worldPacksDir);
  registerPackFrontendAssetRoutes(application, context, worldPacksDir);
  registerPackActionsRoute(application, context, queryHandlerRegistry);
  registerExperimentalRuntimeRoutes(application, context, { asyncHandler });
  // ... 17 行调用
  const packRouter = registerPackRoutes({ context, scopeResolver, asyncHandler, ... });
  application.use('/:packId', packScopeMiddleware, packRouter);
};
```

**After:**
```typescript
import { allGlobalRoutes } from './app/routes/index.js';
import { createPackRouter } from './app/routes/packs/index.js';
import { asyncHandler } from './app/http/async_handler.js';

const registerRoutes: RouteRegistrar = (application, context) => {
  // 全局路由（顺序敏感：必须在 /:packId 之前）
  for (const route of allGlobalRoutes) {
    route.register(application, context);
  }

  // Pack-scoped 路由
  const packRouter = createPackRouter(context, {
    inferenceService,
    scopeResolver: packScopeResolver,
    parseOptionalTick,
    toJsonSafe,
    getErrorMessage
  });
  application.use('/:packId', packScopeMiddleware, packRouter);
};
```

---

## Phase 6: 验证

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
```

### 验证标准

- 所有现有测试通过
- `pnpm typecheck` 零错误
- 新增路由只需：写路由文件 + 在 `routes/index.ts` 加一行 re-export
- 所有 `XxxRouteDependencies` 接口被删除
- `asyncHandler` 通过 import 直接使用，不再通过 deps 参数传递
