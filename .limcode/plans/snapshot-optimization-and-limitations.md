# 世界包快照优化与局限性标明

## Progress

| Phase | 状态 | 完成日期 |
|-------|------|----------|
| Phase 1 (局限性标明) | ✅ 完成 | 2026-04-30 |
| Phase 2 (Tier 1 快速优化) | ✅ 完成 | 2026-04-30 |
| Phase 3 (Tier 2 增量存储) | ⬜ 待评估 | — |

### Phase 1 完成细节

- **1.1 API 路由后端检测**：`pack_snapshots.ts` 新增 `requireSqliteBackend()` 守卫，四个路由入口检查 `packStorageAdapter.backend`，非 sqlite 返回 `501 SNAPSHOT_NOT_AVAILABLE`
- **1.2 函数入口守卫**：`snapshot_capture.ts` 和 `snapshot_restore.ts` 入口处增加 runtime guard，非 sqlite 直接 throw
- **1.3 文档更新**：`docs/API.md` 第 17 节增加后端兼容性 callout；`docs/ARCH.md` 第 2.4.2 节增加 SQLite-only 限制说明
- **1.4 设计决策显式声明**：`snapshot_capture.ts` 顶部完整注释块，解释为何有意绕过 `adapter.exportPackData()`、为何 SQLite-only

### Phase 2 完成细节

- **2.1 contracts schema**：`packSnapshotMetadataSchema` 增加 `compression`（默认 `gzip`）、`storage_plan_sha256`、`storage_plan_inherits_from`
- **2.2 snapshot_locator**：文件名改为 `runtime.sqlite.gz` / `prisma.json.gz`；新增 `computeSha256()`、`resolveStoragePlanPathInChain()`；`snapshotFilesExist()` 适配继承链
- **2.3 snapshot_capture**：`runtime.sqlite` gzip 压缩存储；`prisma.json` gzip 压缩存储；`storage-plan.json` SHA256 去重（与上一快照相同则跳过，metadata 记录继承关系）
- **2.4 snapshot_restore**：对应 gunzip 解压恢复；storage-plan 沿 `storage_plan_inherits_from` 链查找
- **2.5 测试适配**：单元测试适配 `.gz` 文件名和 `compression` 字段；集成测试适配 gzip；`app-context.ts` fixture 补齐 mock `packStorageAdapter`
- **关键问题**：`safeFs.readFileSync` 默认 utf-8 解码损坏二进制 gzip 数据，修复为 `fs.readFileSync` 直接读 Buffer

---

## 现状诊断

### 当前快照流程 (`snapshot_capture.ts:247-294`)

每次快照创建四个文件，全部完整复制，无压缩、无去重、无增量：

| 文件 | 写入方式 | 问题 |
|------|----------|------|
| `runtime.sqlite` | `copyFileSync` 全量复制 (L262-263) | 最大瓶颈，DB 多大就写多少 |
| `prisma.json` | 9 张 Prisma 表全量序列化为 JSON (L273) | 即使只改了一条记录也全量写 |
| `storage-plan.json` | `copyFileSync` 全量复制 (L267-268) | 几乎从不变化，每次白白复制 |
| `metadata.json` | 小文件，可忽略 | — |

上限 20 个快照 (`MAX_SNAPSHOTS_PER_PACK = 20`)，超出删最老的 (`enforceMaxSnapshots`, L221-231)。

### 核心架构问题：快照系统绕过 PackStorageAdapter 抽象

`PackStorageAdapter` 接口（`pack_storage_engine.ts` 重构后的产物，Phase 3 已完成）定义了：

```typescript
exportPackData(packId: string): Promise<Record<string, unknown[]>>;
importPackData(packId: string, data: Record<string, unknown[]>): Promise<void>;
```

两个方法在 `SqlitePackStorageAdapter` 和 `PostgresPackStorageAdapter` 中**均已实现**。但 `snapshot_capture.ts` 完全没有调用 `adapter.exportPackData()`，而是直接用 `safeFs.copyFileSync` 复制原始 SQLite 文件。`snapshot_restore.ts` 同理，直接 `copyFileSync` 恢复原始 SQLite 文件。

**结果**：快照功能是 SQLite-only 的。PostgreSQL 部署者即使配置了 `PostgresPackStorageAdapter`，快照系统也无法工作 — 它根本找不到 `runtime.sqlite` 文件来复制。

---

## Phase 1: 标明局限性

### 目标

在代码和文档中标明快照工具的 SQLite-only 局限性，让 PostgreSQL 等分布式数据库的部署者明确知道需要自行解决备份。

### 变更清单

#### 1.1 API 路由增加后端检测 (`pack_snapshots.ts`)

- `POST /api/packs/:packId/snapshots` — 检查 `packStorageAdapter.backend`，非 `sqlite` 时返回 501 Not Implemented，响应体标明局限性
- `POST /api/packs/:packId/snapshots/:snapshotId/restore` — 同上
- `GET /api/packs/:packId/snapshots` — 非 sqlite 时返回空列表 + 提示信息
- 响应格式：`{ error: "SNAPSHOT_NOT_AVAILABLE", message: "快照功能仅支持 SQLite 后端。当前后端为 postgresql，请使用数据库原生工具（如 pg_dump）进行备份。" }`

#### 1.2 `snapshot_capture.ts` 增加后端守卫

- `capturePackSnapshot()` 入口处检查 adapter backend，非 sqlite 直接 throw
- `restorePackSnapshot()` 同理

#### 1.3 文档更新

- `docs/API.md` — 在快照 API 章节增加后端兼容性说明
- `docs/ARCH.md` — 在 Pack Storage 章节说明快照的适用范围

#### 1.4 配置文件增加注释

- `data/configw/default.yaml` — 在数据库配置段增加注释，说明快照功能仅 SQLite 可用

---

## Phase 2: Tier 1 快速优化（仅 SQLite 后端）

以下优化仅作用于 SQLite 后端，因为只有 SQLite 路径才会走到文件复制逻辑。改动范围限制在 `snapshot_capture.ts` 和 `snapshot_restore.ts`。

### 2.1 `runtime.sqlite` gzip 压缩存储

Node.js 内置 `zlib.gzipSync` / `zlib.gunzipSync`，零额外依赖。SQLite 数据库压缩率通常在 60-80%。

**改动**：
- `snapshot_capture.ts` L262-263：`copyFileSync` → `readFileSync` + `gzipSync` + `writeFileSync`，文件名改为 `runtime.sqlite.gz`
- `snapshot_locator.ts`：`RUNTIME_DB_FILENAME` → `runtime.sqlite.gz`（或增加压缩后缀常量）
- `snapshot_restore.ts` L320：`copyFileSync` → `readFileSync` + `gunzipSync` + `writeFileSync`
- `snapshotFilesExist()` 适配新文件名

**风险**：大 DB（>500MB）时 gzip 同步操作会阻塞事件循环。对策：使用 `zlib.gzip` 异步版本 + `await`，或限制单个快照最大 DB 尺寸。

### 2.2 `prisma.json` gzip 压缩

同上，JSON 压缩率通常 80-90%。文件名改为 `prisma.json.gz`。

### 2.3 `storage-plan.json` 去重

- `capturePackSnapshot` 中计算 `storage-plan.json` 的 SHA256
- 与上一次快照的 `storage-plan.json` 的 SHA256 比对（从上一个 `metadata.json` 读取 `storage_plan_sha256` 字段）
- 相同则跳过复制，在 `metadata.json` 中写 `storage_plan_inherits_from: "<parent_snapshot_id>"`
- 不同则正常复制
- `snapshot_restore.ts` 恢复时：若 `storage_plan_inherits_from` 存在，沿父快照链查找 `storage-plan.json`
- `metadata.json` schema 增加可选字段 `storage_plan_sha256: string | null` 和 `storage_plan_inherits_from: string | null`

### 2.4 metadata 增强

`PackSnapshotMetadata`（`packages/contracts/src/pack_snapshot.ts`）增加字段：

```typescript
storage_plan_sha256: z.string().nullable().optional(),
storage_plan_inherits_from: z.string().nullable().optional(),
compression: z.enum(['none', 'gzip']).default('gzip'),
```

### 文件变更汇总（Phase 2）

| 路径 | 变更 |
|------|------|
| `apps/server/src/packs/snapshots/snapshot_capture.ts` | gzip 压缩 SQLite + Prisma JSON；storage-plan 去重 |
| `apps/server/src/packs/snapshots/snapshot_restore.ts` | 对应解压 + 沿链查找 storage-plan |
| `apps/server/src/packs/snapshots/snapshot_locator.ts` | 文件名常量更新；增加沿链查找 storage-plan 函数 |
| `packages/contracts/src/pack_snapshot.ts` | metadata schema 增加 compression + sha256 字段 |

---

## Phase 3: Tier 2 增量存储（后续评估）

以下方案需要在 Phase 1-2 完成后，根据实际存储增长情况决定是否实施。

### 3.1 Prisma 数据增量

- 每个快照只存储相对于父快照的变更记录
- 恢复时从父快照加载基线 + 应用增量
- 需要解决：快照链断裂（手动删除了某个中间快照）时的回退策略

### 3.2 SQLite 页面级增量

- 在 SQLite 中维护 page version 追踪
- 快照时只导出变更的数据库页
- 或利用 SQLite WAL archive 机制

这两种方案实现复杂度显著高于 Tier 1，暂不实施。

---

## 设计决策

### 为什么不让快照系统调用 adapter.exportPackData() 以支持 PostgreSQL？

1. `adapter.exportPackData()` 返回的是行数据 JSON，不含 SQLite 的 WAL、索引、页面结构等。对 SQLite 来说，`copyFileSync` 更简单可靠且保留完整数据库状态。
2. PostgreSQL 部署者通常使用 `pg_dump`、`pg_basebackup`、WAL archiving 等成熟方案，比自建快照更可靠。对部署者而言，数据库备份是基础设施层的职责，不是应用层该管的。
3. 如果在应用层强行抽象一套"通用快照"，只会得到一个既不匹配 SQLite 优势（文件级快照的简单性）、也不匹配 PostgreSQL 优势（原生工具链）的半吊子方案。

### 为什么 Phase 2 采用同步 gzip 而非异步？

`capturePackSnapshot` 本身就在 runtime paused 期间调用，且已被 `await` 包裹。对于典型 pack（SQLite DB < 100MB），同步 gzip 耗时 < 1s，不会构成实际问题。若未来出现超大 pack，可改为 `zlib.gzip` 异步版本。

---

## 执行顺序

1. **Phase 1**（局限性标明）— 独立，立即可做
2. **Phase 2**（Tier 1 优化）— 依赖 Phase 1 的 metadata schema 变更
3. **Phase 3**（Tier 2 增量）— 待评估

## 校验方式

- Phase 1：PostgreSQL provider 下 `POST /api/packs/:id/snapshots` 返回 501
- Phase 2：SQLite provider 下快照创建/恢复端到端正常；快照目录中文件为 `.gz` 后缀；连续两次快照后 `storage-plan.json` 未变化时第二个快照不包含该文件
- `pnpm typecheck && pnpm lint` 零错误
- `pnpm test` 全部通过
