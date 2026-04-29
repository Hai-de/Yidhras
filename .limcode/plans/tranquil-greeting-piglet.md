# 挣脱 SQLite 绑定性依赖 — 重构计划

## Progress

| Phase | 状态 | 完成日期 |
|-------|------|----------|
| Phase 1.1 (Repository 接口) | ✅ 完成 | 2026-04-29 |
| Phase 1.2 (AppContext 更新 + 启动注入) | ✅ 完成 | 2026-04-29 |
| Phase 1.3 (调用方迁移) | 🔶 A+C 完成，B/D~G 待续 (8/40+ 文件) | 2026-04-29 |
| Phase 2 (Prisma Schema 拆分 + BigInt) | ✅ 完成 | 2026-04-29 |
| Phase 3 (Pack 存储抽象) | ✅ 完成 | 2026-04-29 |
| Phase 4 (PostgreSQL Pack Adapter) | ✅ 完成 | 2026-04-29 |
| Phase 5 (配置清理 + DatabaseHealth) | ✅ 完成 | 2026-04-29 |
| Phase 6 (测试矩阵) | ⬜ 待开始 | — |

### 已完成细节

**Phase 1.1** — 9 个 Repository 接口 + Prisma 实现类，含 `createPrismaRepositories` 工厂，`AppInfrastructure.repos: Repositories`。

**Phase 1.2** — `index.ts` / `plugin_cli.ts` 启动注入 `createPrismaRepositories(prisma)`。

**Phase 1.3 迁移进度** — 8/40+ 文件：
- **Group A (Scheduler) ✅**: `scheduler_lease.ts`, `scheduler_ownership.ts`, `scheduler_rebalance.ts` → `context.repos.scheduler.*`
- **Group C (Identity/Operator) ✅**: `operator/auth/token.ts`, `operator/audit/logger.ts`, `operator/guard/pack_access.ts`, `operator/guard/subject_resolver.ts`, `app/services/operators.ts` → `context.repos.identityOperator.*`
- **Groups B, D~G (待续)**: ~32 个文件仍使用 `context.prisma`
- **委托目标 (无需迁移)**: 13 个 `*_repository.ts` / service 文件被 Repository 类直接包装

**Phase 2** — `prisma/schema.sqlite.prisma` + `prisma/schema.pg.prisma`（仅 datasource 不同），`package.json` 脚本 `--schema` 参数化，`repositories/bigint.ts` 统一 BigInt 转换。

**Phase 3** — `PackStorageAdapter` 接口 + `SqlitePackStorageAdapter` 实现；5 个 repo 文件 + entity_state_projection 改为接受 `adapter` 参数；`PackStorageEngine`、`teardown.ts`、快照系统、所有调用方均更新；`AppInfrastructure.packStorageAdapter`。

**Phase 4** — `PostgresPackStorageAdapter`（~460 行）：schema-per-pack、Prisma raw SQL、DDL 适配、export/import；`index.ts` provider-aware 选择。

**Phase 5** — `config/domains/sqlite.ts` → `database.ts`（provider-aware schema）；`DatabaseHealthSnapshot` 替代 `SqliteRuntimePragmaSnapshot`；`AppContext.getDatabaseHealth()`；全部配置快照和错误诊断更新为 provider-agnostic。
### 待续工作

- **Phase 1.3 Groups B, D~G** — ~32 个文件仍使用 `context.prisma` 直接访问
  - Group B: `action_dispatcher.ts`, `inference_workflow.ts`, `workflow_query.ts` 等 6 个文件
  - Group D: `agent.ts`, `memory/blocks/store.ts` 等 6 个文件
  - Group E: `social.ts`, `audit.ts`
  - Group F: `plugins/store.ts`, `ai/observability.ts`, `inference/sinks/prisma.ts`, `context_builder.ts`
  - Group G: `system.ts`, `scheduler_observability.ts`, routes, middleware 等 ~16 个文件
- **Phase 6**: 测试矩阵（未开始）

---

Yidhras 目前深度绑定 SQLite，有两层数据库：

1. **主应用 DB**（Prisma + SQLite）：`data/yidhras.sqlite`，~30 个模型，通过 `context.prisma` 直接访问，无抽象层
2. **每个 World Pack 独立运行时 DB**（`node:sqlite` DatabaseSync）：`data/world_packs/<packId>/runtime.sqlite`，5 个固定表 + 动态集合表，通过原始 SQL 直接操作

这导致无法多机部署。项目尚未上线，无生产数据包袱，可以激进重构。

## 设计决策

### 两层问题分开处理

**Layer 1（主应用 DB）**：Prisma 本身就支持 SQLite / PostgreSQL / MySQL 切换。问题不是 Prisma，而是代码直接依赖 `PrismaClient` 具体类型。解法：引入 Repository 接口层，将 `context.prisma.model.operation()` 替换为 `context.repos.<domain>.method()`。

**Layer 2（Pack 运行时 DB）**：`node:sqlite` 无替代品。需要定义 `PackStorageAdapter` 接口，提供 SQLite 和 PostgreSQL 两种实现。PostgreSQL 实现用 **schema-per-pack** 策略（`pack_<id>.world_entities` 等），保持与当前文件级隔离对应的逻辑隔离。

### 不引入额外 ORM/query builder

Prisma 已经是 ORM，再加一层就是 over-engineering。Repository 接口只包裹 Prisma 调用，不引入 Knex/Drizzle/TypeORM。

### 保持开发体验不变

默认 `PRISMA_DB_PROVIDER=sqlite`，开发者无需启动 PostgreSQL。CI 矩阵测试两个 provider。

---

## Phase 1: Repository 接口层（主应用 DB 抽象）

### 1.1 创建 Repository 接口

在 `apps/server/src/app/services/repositories/` 下，按聚合根分组定义接口。每个接口返回领域类型，不暴露 `PrismaClient` 类型。

```
apps/server/src/app/services/repositories/
  types.ts                          # 共享领域类型（从现有 repository 文件中提取）
  ActionIntentRepository.ts         # findManyPending, claim, releaseLock, markDispatching, markCompleted, ...
  IdentityRepository.ts             # findByIdentityId, upsertIdentity, ...
  AgentRepository.ts                # listAgents, getAgent, upsertAgent, ...
  NarrativeRepository.ts            # Event/WorldVariable CRUD
  MemoryRepository.ts               # MemoryBlock/MemoryCompactionState CRUD
  PluginRepository.ts               # PluginArtifact/PluginInstallation CRUD
  SchedulerRepository.ts            # SchedulerRun/CandidateDecision/Lease/Cursor CRUD
  OperatorRepository.ts             # Operator/Session/Grant/Audit CRUD
  InferenceWorkflowRepository.ts    # DecisionJob/InferenceTrace/AiInvocationRecord CRUD
  SocialRepository.ts               # Post/Relationship/RelationshipAdjustmentLog
  index.ts                          # Repositories 聚合类型 + createPrismaRepositories 工厂
```

每个 interface 文件旁边放 Prisma 实现：

```typescript
// ActionIntentRepository.ts
export interface ActionIntentRepository { ... }
export class PrismaActionIntentRepository implements ActionIntentRepository {
  constructor(private prisma: PrismaClient) {}
  // ...实现
}
```

### 1.2 更新 AppContext

`apps/server/src/app/context.ts`：`AppInfrastructure` 增加 `repos: Repositories`，保留 `prisma` 以支持渐进迁移。

```typescript
export interface Repositories {
  actionIntent: ActionIntentRepository;
  identity: IdentityRepository;
  agent: AgentRepository;
  narrative: NarrativeRepository;
  memory: MemoryRepository;
  plugin: PluginRepository;
  scheduler: SchedulerRepository;
  operator: OperatorRepository;
  inference: InferenceWorkflowRepository;
  social: SocialRepository;
}

export interface AppInfrastructure extends RuntimeSource {
  readonly repos: Repositories;
  readonly prisma: PrismaClient;  // 渐进迁移期保留，全部迁移后删除
  // ...
}
```

### 1.3 迁移调用方（按领域分组，可并行）

每组的迁移是机械替换：`context.prisma.<model>.<op>()` → `context.repos.<domain>.<method>()`。

- **Group A**：Scheduler — `scheduler_ownership_repository.ts`, `scheduler_lease_repository.ts`, `scheduler_rebalance_repository.ts`, `scheduler_rebalance.ts`, `scheduler_observability.ts`
- **Group B**：ActionIntent + DecisionJob — `action_intent_repository.ts`, `action_dispatcher.ts`, `workflow_job_repository.ts`, `workflow_query.ts`
- **Group C**：Identity + Operator — `identity/service.ts`, `operator_auth.ts`, `operator_grants.ts`, `operator_pack_bindings.ts`, `operator_agent_bindings.ts`
- **Group D**：Agent + Memory — `agent.ts`, `memory/blocks/store.ts`, `memory/long_term_store.ts`, `memory/recording/compaction_service.ts`
- **Group E**：Social + Narrative — `social.ts`, `audit.ts`, `event_evidence_repository.ts`, `agent_signal_repository.ts`, `relationship_mutation_repository.ts`
- **Group F**：Plugin + Inference — `plugins/store.ts`, `inference/sinks/prisma.ts`, `ai/observability.ts`
- **Group G**：Core + Routes — `graph_data.ts`, `runtime_activation.ts`, `system.ts`, `access_policy/service.ts`, route files

### 1.4 全部迁移后删除 `context.prisma`

---

## Phase 2: 可配置 Prisma Provider

### 2.1 拆分为两个 schema 文件

- `prisma/schema.sqlite.prisma` — `datasource db { provider = "sqlite" }`
- `prisma/schema.pg.prisma` — `datasource db { provider = "postgresql" }`

两个文件包含相同的 model 定义。`BigInt`、`Json`、`@default(uuid())` 在两个 provider 都兼容。

### 2.2 Schema 选择脚本

```bash
# .env 增加
PRISMA_DB_PROVIDER=sqlite  # 或 postgresql
```

`package.json` 的 prisma 命令通过 `--schema` 参数选择：
```json
{
  "prisma:generate": "prisma generate --schema=prisma/schema.${PRISMA_DB_PROVIDER:-sqlite}.prisma",
  "prisma:migrate": "prisma migrate dev --schema=prisma/schema.${PRISMA_DB_PROVIDER:-sqlite}.prisma",
  "prisma:deploy": "prisma migrate deploy --schema=prisma/schema.${PRISMA_DB_PROVIDER:-sqlite}.prisma"
}
```

### 2.3 确保 BigInt 兼容性

当前所有时间戳用 `BigInt`（epoch tick）。PostgreSQL 下 Prisma 会自动映射到 `INT8`。在 Repository 层保持 `BigInt` 类型不变，Prisma 客户端会根据 provider 自动处理序列化。

---

## Phase 3: Pack 运行时存储抽象

### 3.1 定义 `PackStorageAdapter` 接口

`apps/server/src/packs/storage/PackStorageAdapter.ts`：

```typescript
export interface PackStorageAdapter {
  readonly backend: 'sqlite' | 'postgresql';

  // Schema management
  ensureEngineOwnedSchema(): Promise<void>;
  ensureCollection(collection: CollectionDefinition): Promise<void>;

  // Engine-owned records (fixed 5 tables + projection_events)
  listEngineOwnedRecords<T>(packId: string, tableName: string): Promise<T[]>;
  upsertEngineOwnedRecord<T>(packId: string, tableName: string, record: T): Promise<T>;
  countEngineOwnedRecords(packId: string, tableName: string): Promise<number>;

  // Dynamic collections (user-declared per-pack tables)
  upsertCollectionRecord(packId: string, collectionKey: string, record: Record<string, unknown>): Promise<Record<string, unknown>>;
  listCollectionRecords(packId: string, collectionKey: string): Promise<Record<string, unknown>[]>;

  // Lifecycle
  destroyPackStorage(packId: string): Promise<void>;

  // Snapshot support
  exportPackData(packId: string): Promise<Record<string, unknown[]>>;
  importPackData(packId: string, data: Record<string, unknown[]>): Promise<void>;

  // Health
  ping(packId: string): Promise<boolean>;
}
```

关键设计：`packId` 是方法参数而不是构造函数参数 — 同一个 adapter 实例服务所有 pack，支持连接池复用（PostgreSQL 场景的关键）。

### 3.2 将现有 `sqlite_engine_owned_store.ts` 重构为 `SqlitePackStorageAdapter`

- 将 `withRuntimeDatabase` 封装保留在 adapter 内部
- `pack_db_locator.ts` 的逻辑移入 adapter（文件路径解析是 SQLite 特有关系）
- 保持 `SqliteEngineOwnedTableSpec` 泛型在内部使用，adapter 对外暴露的是 `packId` 参数化的接口

### 3.3 将 `pack_collection_repo.ts` 合并进 adapter

动态集合的 `CREATE TABLE`、`INSERT ... ON CONFLICT` 逻辑移入 adapter 实现。SQLite 版本保持现有 DDL 生成逻辑。

### 3.4 更新 Pack Storage Repository 层

5 个 repo 文件（`entity_repo.ts`, `entity_state_repo.ts`, `authority_repo.ts`, `mediator_repo.ts`, `rule_execution_repo.ts`）改为接收 `PackStorageAdapter` 而非直接调用 `sqlite_engine_owned_store`。

### 3.5 更新 `PackStorageEngine`

`pack_storage_engine.ts` 接收 `PackStorageAdapter`，不再直接调用 `ensurePackRuntimeSqliteStorage` / `ensureDeclaredPackCollectionTables`。

### 3.6 更新快照系统

`snapshot_capture.ts` / `snapshot_restore.ts` 中对 pack 运行时 DB 的操作改用 `adapter.exportPackData()` / `adapter.importPackData()`。Prisma 数据部分保持不变（已有 Repository 层）。

---

## Phase 4: PostgreSQL Pack Storage Adapter 实现

### 4.1 Schema-per-pack 策略

每个 pack 在 PostgreSQL 中拥有独立 schema：`pack_<sanitized_id>`。

```typescript
export class PostgresPackStorageAdapter implements PackStorageAdapter {
  readonly backend = 'postgresql';

  constructor(private prisma: PrismaClient) {}

  private schemaName(packId: string): string {
    const sanitized = packId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    return `pack_${sanitized}`;
  }

  async ensureEngineOwnedSchema(): Promise<void> {
    // 用 $executeRawUnsafe 创建所有固定表
    // 用参数化查询保证安全（schema 名需白名单校验）
  }
  // ...
}
```

### 4.2 字段类型映射

`mapFieldTypeToSqliteType` → 改为通用的 `mapFieldTypeToSqlType(backend)`：

| 逻辑类型 | SQLite | PostgreSQL |
|---------|--------|------------|
| number | INTEGER | NUMERIC |
| boolean | INTEGER (0/1) | BOOLEAN |
| string | TEXT | TEXT |
| json | TEXT | JSONB |
| timestamp | TEXT | BIGINT |

### 4.3 Export/Import

- `exportPackData`：`SELECT * FROM pack_<id>.<table>` 遍历所有表，结果序列化为 JSON
- `importPackData`：先 `CREATE SCHEMA IF NOT EXISTS` + 建表，再逐行 INSERT
- `destroyPackStorage`：`DROP SCHEMA pack_<id> CASCADE`

---

## Phase 5: 配置和启动清理

### 5.1 数据库配置 Schema 通用化

`apps/server/src/config/domains/sqlite.ts` → 重命名为 `database.ts`：

```typescript
export const DatabaseConfigSchema = z.object({
  provider: z.enum(['sqlite', 'postgresql']).default('sqlite'),
  sqlite: z.object({
    busy_timeout_ms: z.number().int().positive().default(5000),
    wal_autocheckpoint_pages: z.number().int().positive().default(1000),
    synchronous: z.enum(['OFF', 'NORMAL', 'FULL', 'EXTRA']).default('NORMAL'),
  }).optional(),
  postgresql: z.object({
    connection_timeout_ms: z.number().int().positive().default(5000),
    ssl: z.boolean().default(true),
  }).optional(),
});
```

### 5.2 `RuntimeDatabaseBootstrap` 通用化

当前接口返回 `SqliteRuntimePragmaSnapshot`。改为返回 provider-agnostic 的 `DatabaseHealthSnapshot`：

- `SqliteRuntimeDatabaseBootstrap`：应用 PRAGMA，返回 snapshot
- `PostgresRuntimeDatabaseBootstrap`：`SELECT 1` 验证连接

### 5.3 清理 `AppContext` 中的 SQLite 特定字段

- 删除 `getSqliteRuntimePragmas()`
- `handleSimulationStepError` 中的 PRAGMA 诊断改为条件化（仅 SQLite provider）

### 5.4 更新 `index.ts` 启动流程

```typescript
const dbProvider = process.env.PRISMA_DB_PROVIDER ?? 'sqlite';
const prisma = new PrismaClient();
const repos = createPrismaRepositories(prisma);
const packStorageAdapter = dbProvider === 'postgresql'
  ? new PostgresPackStorageAdapter(prisma)
  : new SqlitePackStorageAdapter();

const appContext: AppContext = {
  repos,
  prisma, // 渐进迁移期间
  packStorageAdapter,
  // ...
};
```

---

## Phase 6: 测试策略

### 6.1 Repository 接口的可模拟性

所有 Repository 接口天然可 mock。给现有单元测试提供 `createMockRepositories()` 工厂。

### 6.2 PackStorageAdapter 测试矩阵

为 `SqlitePackStorageAdapter` 和 `PostgresPackStorageAdapter` 跑同一套测试：

```typescript
// tests/unit/pack_storage_adapter.spec.ts
describe.each([
  ['sqlite', () => new SqlitePackStorageAdapter()],
  ['postgresql', () => new PostgresPackStorageAdapter(testPrisma)],
])('%s adapter', (_, factory) => {
  // 所有 pack storage 测试
});
```

### 6.3 CI 矩阵

- SQLite：默认，开发也用
- PostgreSQL：CI 中启动 Docker PostgreSQL 容器，`PRISMA_DB_PROVIDER=postgresql` 跑全套测试

---

## 文件变更汇总

### 新增文件

| 路径 | 说明 |
|-----|------|
| `prisma/schema.sqlite.prisma` | SQLite datasource + 所有 model |
| `prisma/schema.pg.prisma` | PostgreSQL datasource + 所有 model |
| `src/app/services/repositories/*.ts` | ~10 个 Repository 接口 + Prisma 实现 |
| `src/packs/storage/PackStorageAdapter.ts` | Pack 存储接口 |
| `src/packs/storage/adapters/SqlitePackStorageAdapter.ts` | SQLite 实现（从现有关联重构） |
| `src/packs/storage/adapters/PostgresPackStorageAdapter.ts` | PostgreSQL 实现 |
| `src/db/PostgresRuntimeDatabaseBootstrap.ts` | PostgreSQL bootstrap |
| `src/config/domains/database.ts` | 通用化 DB 配置 schema |
| `tests/helpers/mock_repositories.ts` | Mock Repository 工厂 |
| `tests/helpers/mock_pack_storage.ts` | Mock PackStorageAdapter |

### 修改文件

| 路径 | 变更 |
|-----|------|
| `src/app/context.ts` | `repos: Repositories` + 删除 `getSqliteRuntimePragmas` |
| `src/index.ts` | Provider-aware 启动，组装 adapter |
| `src/core/simulation.ts` | 接收 `Repositories` 替代裸 `PrismaClient` |
| `src/core/runtime_database_bootstrap.ts` | 实现通用 `DatabaseBootstrap` 接口 |
| `src/db/sqlite_runtime.ts` | PRAGMA 逻辑封装到 SqliteRuntimeDatabaseBootstrap |
| `src/packs/storage/pack_storage_engine.ts` | 使用 `PackStorageAdapter` |
| `src/packs/storage/internal/sqlite_engine_owned_store.ts` | 重构为 `SqlitePackStorageAdapter` |
| `src/packs/storage/pack_collection_repo.ts` | 合并进 adapter |
| `src/packs/storage/pack_db_locator.ts` | 移入 `SqlitePackStorageAdapter` 内部 |
| `src/packs/storage/entity_repo.ts` | 通过 adapter 访问 |
| `src/packs/storage/entity_state_repo.ts` | 同上 |
| `src/packs/storage/authority_repo.ts` | 同上 |
| `src/packs/storage/mediator_repo.ts` | 同上 |
| `src/packs/storage/rule_execution_repo.ts` | 同上 |
| `src/packs/snapshots/snapshot_capture.ts` | 使用 adapter |
| `src/packs/snapshots/snapshot_restore.ts` | 使用 adapter |
| `src/packs/runtime/teardown.ts` | 使用 adapter |
| `src/kernel/install/install_pack.ts` | 使用 adapter-aware PackStorageEngine |
| `src/app/services/system.ts` | 删除 SQLite pragma 引用 |
| `package.json` | Schema 选择脚本，支持多 provider |
| `data/configw/conf.d/sqlite.yaml` | 改名为 `database.yaml`，增加 provider 字段 |

### 机械迁移文件（~50 个文件，`context.prisma` → `context.repos`）

列在 Phase 1.3 Group A-G 中。

---

## 执行顺序

1. **Phase 1**（Repository 接口层）— 最大工作量，但最安全，可增量进行
2. **Phase 2**（Prisma Provider 可配置）— 依赖 Phase 1 完成
3. **Phase 3**（Pack 存储抽象）— 与 Phase 1-2 独立，可并行
4. **Phase 4**（PostgreSQL Pack Adapter）— 依赖 Phase 3
5. **Phase 5**（配置清理）— 依赖 Phase 1-4
6. **Phase 6**（测试矩阵）— 贯穿全程

## 校验方式

- 每个 Phase 完成后 `pnpm typecheck && pnpm lint` 零错误
- `pnpm test:unit` 全程通过（SQLite 默认）
- Phase 4 后用 Docker PostgreSQL 跑 `PRISMA_DB_PROVIDER=postgresql pnpm test:unit`
- Phase 6 完整 CI 矩阵：`pnpm test` 在两个 provider 下都通过
- 手动验证：`PRISMA_DB_PROVIDER=postgresql pnpm dev` 启动，确认前端功能正常
