# Server 测试工作区

本目录是 `apps/server` 的 canonical Vitest 测试工作区。

- `apps/server/tests/**`：正式自动化测试入口
- `apps/server/tests/support/**`：测试与手动脚本共享的轻量支持模块

## 常用命令

- `pnpm --filter yidhras-server test`
- `pnpm --filter yidhras-server test:unit`
- `pnpm --filter yidhras-server test:integration`
- `pnpm --filter yidhras-server test:e2e`
- `pnpm --filter yidhras-server test:unit:watch`
- `pnpm --filter yidhras-server test:integration:watch`
- `pnpm --filter yidhras-server test:e2e:watch`
- `pnpm --filter yidhras-server smoke`

其中 `test` 为 server 完整测试入口，会顺序执行 `test:unit`、`test:integration`、`test:e2e`。

## 单文件执行

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/<file>.spec.ts
pnpm --filter yidhras-server exec vitest run --config vitest.e2e.config.ts tests/e2e/<file>.spec.ts
```

## 目录约定

```text
tests/
  support/      # 轻量共享支持模块（server 启动、status/assert helpers、默认 pack 配置）
  helpers/      # 进程封装、隔离环境、共享断言
  fixtures/     # 测试上下文与资源装配
  unit/         # 纯逻辑与快速反馈层
  integration/  # Prisma / service / runtime 模块集成
  e2e/          # 真实服务进程与关键 HTTP 链路
```

## 并发与隔离策略

- `unit`：允许默认并行。
- `integration`：当前串行执行（`fileParallelism: false`）。
- `e2e`：当前串行执行（`fileParallelism: false`）。
- `e2e` 优先使用 `tests/helpers/runtime.ts` 提供的隔离环境：
  - 为每个测试会话创建临时数据库文件
  - 通过 `DATABASE_URL` 注入 Prisma 与服务端
  - 禁用 `DEV_RUNTIME_RESET_ON_START`
  - 在独立环境中运行 `prepare:runtime`
- 在临时数据库与独立 runtime 目录尚未普及前，不要把 server 的 `integration` / `e2e` 提升为并行默认值。

## CI 基线

- `server-tests.yml`：当前只运行 `integration`，作为默认 server CI 门禁。
- `server-smoke.yml`：独立运行 startup + key endpoints smoke，覆盖最小 HTTP/启动链路。
- `test:e2e`：仍保留为本地/手动验证入口，但当前不作为默认 CI 门禁。

## 其他说明

- 手动演示脚本位于 `apps/server/scripts/manual/**`。
- canonical smoke 入口为 `pnpm --filter yidhras-server smoke`。
- legacy 单文件 `test:*` 脚本不再作为主维护路径；请优先使用 `tests/**` 下的 Vitest 用例。
