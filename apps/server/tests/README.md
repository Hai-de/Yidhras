# Server 测试工作区

本目录是 `apps/server` 的 canonical Vitest 测试工作区。

- `apps/server/tests/**`：正式自动化测试入口
- `apps/server/src/e2e/*.ts`：仅保留少量辅助文件，不再作为主测试入口

## 常用命令

- `pnpm --filter yidhras-server test`
- `pnpm --filter yidhras-server test:unit`
- `pnpm --filter yidhras-server test:integration`
- `pnpm --filter yidhras-server test:e2e`
- `pnpm --filter yidhras-server test:watch`
- `pnpm --filter yidhras-server smoke`

## 单文件执行

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/<file>.spec.ts
pnpm --filter yidhras-server exec vitest run --config vitest.e2e.config.ts tests/e2e/<file>.spec.ts
```

## 目录约定

```text
tests/
  helpers/      # 轻量工具、共享断言、进程封装
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

## 其他说明

- 手动演示脚本位于 `apps/server/scripts/manual/**`。
- canonical smoke 入口为 `pnpm --filter yidhras-server smoke`。
- legacy 单文件 `test:*` 脚本不再作为主维护路径；请优先使用 `tests/**` 下的 Vitest 用例。
