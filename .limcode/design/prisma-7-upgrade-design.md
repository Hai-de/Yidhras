# Prisma 6 → 7 升级设计方案

> **状态：✅ 已实施 (2026-05-14)**
>
> 当前项目停留在 Prisma 6.19.3。Prisma 7 引入了两项破坏性变更：
> 1. schema 文件中 `datasource.url` 移除，迁移到 `prisma.config.ts`
> 2. `PrismaClient` 构造函数强制要求 `adapter` 或 `accelerateUrl`
>
> 本项目使用 SQLite，需引入 `@prisma/adapter-better-sqlite3`。

## 实施差异记录

设计文档与实际实施的偏差：

| 项目 | 设计假设 | 实际 |
|------|----------|------|
| PrismaClient call site 数量 | 10 | 13（4 个额外测试文件） |
| `src/core/simulation.ts` | 直接实例化 | 构造函数注入，无需修改 |
| `sqlite3` npm 包 | 项目 DB 驱动 | 无源码引用，已移除 |
| `node:sqlite` 使用 | 未提及 | 3 个 pack storage 文件使用，不受影响 |
| `node-sqlite.d.ts` | 为 `sqlite3` 包声明 | 为 `node:sqlite` 声明（但仍可删除） |
| `better-sqlite3` 版本 | 未指定 | `^12.10.0`（`11.x` 不兼容 Node 26） |
| 实际 prisma 版本 | `6.19.3` | `6.2.1`（起始版本不同，升级路径不变） |

---

## 1. 破坏性变更分析

### 1.1 schema 文件：`url` 字段移除

**Before (Prisma 6):**
```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

**After (Prisma 7):**
```prisma
datasource db {
  provider = "sqlite"
}
```

URL 配置迁移到 `prisma.config.ts`：
```typescript
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./data/dev.sqlite'
  }
})
```

影响：3 个 schema 文件（`schema.sqlite.prisma`、`schema.pg.prisma`、`schema.prisma`）都需要删除 `url` 行。

### 1.2 PrismaClient：强制 adapter

**Before (Prisma 6):**
```typescript
const prisma = new PrismaClient()  // 无参构造 OK
// 或带 datasources
const prisma = new PrismaClient({ datasources: { db: { url } } })
```

**After (Prisma 7):**
```typescript
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/dev.sqlite' })
const prisma = new PrismaClient({ adapter })
```

`better-sqlite3` 是同步 C 绑定，API 与当前异步 `sqlite3` 不同。但项目代码中**不直接使用 sqlite3**——所有 DB 操作都经过 Prisma，因此只需要在 PrismaClient 构造处传入 adapter。

### 1.3 包替换

| 当前 | 目标 |
|------|------|
| `sqlite3` ^6.0.1 | 移除 |
| — | 新增 `better-sqlite3` |
| — | 新增 `@prisma/adapter-better-sqlite3` |

`better-sqlite3` 是纯同步 API，无需 Promise。Prisma adapter 封装了所有异步细节。

---

## 2. 影响面

### 2.1 文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `package.json` | 修改 | `sqlite3` → `better-sqlite3` + `@prisma/adapter-better-sqlite3` |
| `prisma/schema.sqlite.prisma` | 修改 | 删除 datasource `url` 行 |
| `prisma/schema.pg.prisma` | 修改 | 删除 datasource `url` 行 |
| `prisma/schema.prisma` | 修改 | 删除 datasource `url` 行 |
| `prisma.config.ts` | **新建** | 集中管理 datasource URL |
| `src/index.ts` | 修改 | `new PrismaClient()` → `new PrismaClient({ adapter })` |
| `src/core/simulation.ts` | 修改 | `new PrismaClient()` → `new PrismaClient({ adapter })` |
| `src/db/seed.ts` | 修改 | 同上 |
| `src/db/seed_identity.ts` | 修改 | 同上 |
| `src/db/seed_operator.ts` | 修改 | 同上 |
| `src/cli/db_cli.ts` | 修改 | 同上 |
| `src/cli/plugin_cli.ts` | 修改 | 同上 |
| `src/cli/operator_cli.ts` | 修改 | 同上 |
| `src/cli/diag_cli.ts` | 修改 | 同上 |
| `tests/helpers/runtime.ts` | 修改 | `datasources.db.url` → `adapter` |
| `src/types/node-sqlite.d.ts` | 删除 | `sqlite3` 类型声明不再需要 |

### 2.2 调用点统计

共 10 处 `new PrismaClient()` 调用：
- `src/index.ts:103`
- `src/core/simulation.ts` 
- `src/db/seed.ts:9`
- `src/db/seed_identity.ts:9`
- `src/db/seed_operator.ts:13`
- `src/cli/db_cli.ts:159`
- `src/cli/plugin_cli.ts:392`
- `src/cli/operator_cli.ts:300`
- `src/cli/diag_cli.ts:77`
- `tests/helpers/runtime.ts:214` — 使用 `datasources` 选项，需改为 `adapter`

---

## 3. 统一 PrismaClient 工厂

为避免 10 处重复 adapter 构造逻辑，创建一个共享工厂函数。

### 3.1 工厂函数

**新建 `apps/server/src/db/client.ts`：**

```typescript
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

let defaultPrisma: PrismaClient | null = null

export const createPrismaClient = (databaseUrl?: string): PrismaClient => {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? 'file:./data/dev.sqlite'
  const adapter = new PrismaBetterSqlite3({ url })
  return new PrismaClient({ adapter })
}

export const getDefaultPrisma = (): PrismaClient => {
  if (!defaultPrisma) {
    defaultPrisma = createPrismaClient()
  }
  return defaultPrisma
}
```

### 3.2 迁移模式

**Before (各处分散):**
```typescript
const prisma = new PrismaClient()
```

**After (统一工厂):**
```typescript
import { createPrismaClient } from '../db/client.js'
const prisma = createPrismaClient()
```

或对于单例场景：
```typescript
import { getDefaultPrisma } from '../db/client.js'
const prisma = getDefaultPrisma()
```

### 3.3 测试 helper

`tests/helpers/runtime.ts` 中的 `createPrismaClientForEnvironment`：

**Before:**
```typescript
return new PrismaClient({
  datasources: {
    db: { url: environment.databaseUrl }
  }
})
```

**After:**
```typescript
return createPrismaClient(environment.databaseUrl)
```

---

## 4. SQLite 类型声明清理

项目当前有 `src/types/node-sqlite.d.ts`（为 `sqlite3` 包做类型声明）。迁移到 `better-sqlite3` 后：

- 该文件可删除（`better-sqlite3` 自带类型）
- 如有任何代码直接 `import sqlite3 from 'sqlite3'`，需改为 `import Database from 'better-sqlite3'`（当前代码库中无此类引用）

---

## 5. prisma.config.ts

放置于 `apps/server/prisma.config.ts`，Prisma CLI 自动发现。

```typescript
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./data/dev.sqlite'
  }
})
```

**注意：** `defineConfig` 从 `prisma/config` 导入，非 `@prisma/client`。

---

## 6. 实施步骤

| 步骤 | 操作 | 验证 |
|------|------|------|
| 1 | 更新 `package.json`：移除 `sqlite3`，添加 `better-sqlite3` + `@prisma/adapter-better-sqlite3` | `pnpm install` |
| 2 | 升级 `prisma` + `@prisma/client` 到 7.8.x | `pnpm update --latest` |
| 3 | 从 3 个 schema 文件中删除 `url` 行 | — |
| 4 | 创建 `prisma.config.ts` | `prisma validate` |
| 5 | 创建 `src/db/client.ts` 工厂函数 | — |
| 6 | 迁移 10 处 `new PrismaClient()` → `createPrismaClient()` | — |
| 7 | 更新测试 helper | — |
| 8 | 删除 `src/types/node-sqlite.d.ts` | — |
| 9 | 重新生成 Prisma client | `prisma generate` |
| 10 | 全量验证 | `typecheck` + `test:unit` |

---

## 7. 风险与边界

1. **better-sqlite3 vs sqlite3**：前者是同步 API，后者是异步。Prisma adapter 封装了所有 DB I/O，应用层代码完全不直接调用 SQLite API，因此同步/异步差异不传播到业务代码。

2. **better-sqlite3 编译**：它是 C++ 原生模块，需要 `node-gyp` 构建环境。CI 中已具备（Rust sidecar 也需编译工具链）。

3. **测试隔离**：`createPrismaClientForEnvironment` 改为使用 adapter 构造，每个测试仍可获得独立的 SQLite 文件（通过 `url` 参数）。

4. **PostgreSQL schema**：`schema.pg.prisma` 也需删除 `url`。PostgreSQL 场景使用 `@prisma/adapter-pg`，不在本次范围内（仅保留 schema 文件可解析即可）。
