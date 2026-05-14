# Major 依赖升级计划

> 基于 `pnpm outdated` 结果，9 个 major 版本升级按风险从低到高逐步执行。

## 升级清单

| # | 包 | 当前 → 目标 | 风险 | 影响面 | 状态 |
|---|-----|-------------|------|--------|------|
| 1 | `zod-validation-error` | 4.0.2 → 5.0.0 | **低** | 错误消息格式，非功能代码 | ✅ 完成 |
| 2 | `dotenv` | 16.6.1 → 17.4.2 | **低** | 环境变量加载，API 微小变化 | ✅ 完成 |
| 3 | `@types/node` (server) | 20.19.37 → 22.x | **低** | 仅类型定义，不影响运行时 | ✅ 完成 |
| 4 | `typescript` | 5.9.3 → 6.0.3 | **中** | 全项目编译，可能有新错误 | ✅ 完成 |
| 5 | `eslint` | 9.39.4 → 10.3.0 | **中** | 配置格式 / 插件兼容性 | ✅ 完成 |
| 6 | `vitest` | 3.2.4 → 4.1.6 | **中** | 测试框架 API 变化 | ✅ 完成 |
| 7 | `sqlite3` | 5.1.7 → 6.0.1 | **中** | 原生模块，编译/API | ✅ 完成（后移除） |
| 8 | `express` + `@types/express` | 4.22.1 → 5.2.1 | **高** | 路由/中间件 API 破坏性变更 | ✅ 完成 |
| 9 | `prisma` + `@prisma/client` | 6.19.2 → 7.8.0 | **高** | Schema 语法 / 迁移 / 客户端 API | ✅ 完成 (2026-05-14) |

## 执行顺序

每步完成后跑 `pnpm typecheck && pnpm test:unit` 验证。

### Step 1: zod-validation-error 5.0.0
- 检查 CHANGELOG 中的 breaking changes
- 更新后调整 `constitution_schema.ts` 中 `fromError` 的调用方式（如有变化）
- 影响：仅 1 个文件

### Step 2: dotenv 17.4.2
- 主要变化：ESM-only、移除 `config()` 默认导出
- 检查 `apps/server` 中 dotenv 的使用方式
- 当前使用 `dotenv/config` preload 方式，可能无需改动

### Step 3: @types/node (server) 20 → 22
- Node 22 LTS 类型定义
- 检查是否有新的类型不兼容问题
- 不影响运行时，仅影响类型检查

### Step 4: TypeScript 6.0.3
- 新语法特性、更严格的类型检查
- 新错误可能涉及：未使用的变量、类型推断变化、`.d.ts` 生成
- 全项目 `tsc --noEmit` 后修复所有问题

### Step 5: ESLint 10.3.0
- 检查 `eslint.config.mjs` 是否有格式变化
- 检查插件兼容性（`@typescript-eslint`、`eslint-plugin-vue`、`eslint-plugin-boundaries`）
- 如插件不兼容，回退等待上游

### Step 6: vitest 4.1.6
- 同步更新 `@vitest/coverage-v8`
- 检查 vitest 配置文件中 API 命名变化
- 跑全量测试验证

### Step 7: sqlite3 6.0.1
- 更新后检查编译是否成功
- 验证 DB 读写仍正常

### Step 8: express 5.2.1 + @types/express@5.0.6
- Express 5 主要 breaking changes：
  - `req.path` 行为变化
  - 错误处理中间件签名
  - 移除 `app.del()` 等废弃 API
  - 路径匹配语法变化
- 逐个路由文件检查

### Step 9: prisma 7.8.0 + @prisma/client 7.8.0 ✅ (2026-05-14)

**实际变更：**
- `prisma` / `@prisma/client`: `^6.2.1` → `^7.8.0`
- `sqlite3` (npm): 移除（无源码引用），替换为 `better-sqlite3@^12.10.0` + `@prisma/adapter-better-sqlite3@^7.8.0`
- 3 个 schema 文件删除 `url = env("DATABASE_URL")`
- 新建 `prisma.config.ts` 集中管理 datasource URL
- 新建 `src/db/client.ts` 工厂函数 (`createPrismaClient` / `getDefaultPrisma`)
- 13 处 `new PrismaClient()` → `createPrismaClient()`
- 删除 `src/types/node-sqlite.d.ts`（`@types/node@22` 已覆盖）
- `better-sqlite3@11.10.0` 不兼容 Node 26，升级到 `12.10.0`
- typecheck 通过，单元测试通过（1 个预存失败无关）

详见 `.limcode/design/prisma-7-upgrade-design.md`
