# Commands Guide / 开发命令手册

本文档是仓库级命令说明的主事实源。

> 维护规则：
> - 当工作区脚本、`apps/server/package.json`、`apps/web/package.json` 发生变化时，优先同步本文件。
> - `README.md` 与 `AGENTS.md` 只保留少量高频命令和链接，不再复制完整命令矩阵。
> - 插件治理的长示例后续单独收口到 `PLUGIN_OPERATIONS.md`；本文件只保留入口命令。

## 1. 环境要求

- Node.js 18+
- pnpm 10+

## 2. 仓库根目录命令

在仓库根目录执行：

### 2.1 安装

```bash
pnpm install
```

### 2.2 开发启动

```bash
pnpm dev
pnpm dev:server
pnpm dev:web
```

说明：
- `pnpm dev`：并行启动 workspace 下的 server + web 开发进程；
- 如只需单独启动某一侧，可使用：
  - `pnpm dev:server`
  - `pnpm dev:web`
- 也可使用仓库脚本：
  - Linux / macOS：`./start-dev.sh`
  - Windows：`start-dev.bat`

### 2.2.1 多 Worker 启动（横向扩展）

```bash
# 启动 2 个 server worker（各自监听 3001, 3002）
./start-dev.sh --workers=2

# 通过环境变量启动
WORKERS=2 pnpm dev:workers

# 手动启动单个 worker
SCHEDULER_WORKER_INDEX=0 SCHEDULER_WORKER_TOTAL=2 tsx apps/server/src/index.ts
SCHEDULER_WORKER_INDEX=1 SCHEDULER_WORKER_TOTAL=2 tsx apps/server/src/index.ts
```

说明：
- 多 worker 模式下每个进程独立 spawn 世界引擎 sidecar，实现故障隔离
- Worker 端口 = `APP_PORT + workerIndex`（默认 3001, 3002, ...）
- 分区通过 `SCHEDULER_WORKER_TOTAL` / `SCHEDULER_WORKER_INDEX` 取模分配
- 单 worker 模式（默认）行为不受影响

### 2.3 构建与质量检查

```bash
pnpm build
pnpm lint
pnpm typecheck
```

### 2.4 测试

```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:unit:watch
pnpm test:integration:watch
pnpm test:e2e:watch
```

说明：
- `pnpm test`：运行 workspace 完整测试入口（web unit + server unit/integration/e2e）
- `pnpm test:unit`：运行 workspace 单测入口（web unit + server unit）
- `pnpm test:integration`：运行 server integration
- `pnpm test:e2e`：运行 server e2e
- `pnpm test:unit:watch`：并行 watch web unit + server unit
- `pnpm test:integration:watch`：watch server integration
- `pnpm test:e2e:watch`：watch server e2e

### 2.5 运行时准备与脚手架

```bash
pnpm prepare:runtime
pnpm scaffold:world-pack -- --dir my_pack --name "My Pack" --author "Your Name"
pnpm smoke:server
```

说明：
- `pnpm prepare:runtime` 会委托给 server 完成数据库迁移、运行时初始化与 identity seed。
- `pnpm scaffold:world-pack` 是新建 world-pack 项目的统一入口。
- `pnpm smoke:server` 用于快速运行 server 冒烟验证。
- 数据库迁移、初始化、路径更换与常见坑的展开说明见：`DB_OPERATIONS.md`

### 2.6 Runtime 配置与优先级

配置优先级：**env > yaml > code default**。完整优先级链与字段说明见 [`ARCH.md`](../ARCH.md) 第 2.4 节。

配置拆分布局（`data/configw/conf.d/`），每域独立 YAML 文件：

```
data/configw/
  conf.d/
    app.yaml / paths.yaml / operator.yaml / plugins.yaml / world.yaml
    startup.yaml / database.yaml / logging.yaml / clock.yaml
    world_engine.yaml / scheduler.yaml / prompt_workflow.yaml
    runtime.yaml / features.yaml
  development.yaml / production.yaml / test.yaml
  local.yaml                       # 本地覆盖，不入版本控制
```

常用运行参数（通过 `data/configw/conf.d/*.yaml` 或 `data/configw/local.yaml` 或 env 覆盖）：

```yaml
# conf.d/app.yaml
app:
  port: 3001

# conf.d/database.yaml
database:
  sqlite:
    busy_timeout_ms: 5000

# conf.d/scheduler.yaml
scheduler:
  lease_ticks: 5
```

多包运行时默认启用，架构边界见 [`ARCH.md`](../ARCH.md) 第 3.3.1 节。

## 3. Server 命令

在根目录通过 `--filter yidhras-server` 调用，或进入 `apps/server` 执行。

### 3.1 安装与开发

```bash
pnpm --filter yidhras-server install
pnpm --filter yidhras-server dev
pnpm --filter yidhras-server build
pnpm --filter yidhras-server start
```

### 3.2 质量检查

```bash
pnpm --filter yidhras-server lint
pnpm --filter yidhras-server typecheck
```

### 3.3 测试

```bash
pnpm --filter yidhras-server test
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
pnpm --filter yidhras-server test:unit:watch
pnpm --filter yidhras-server test:integration:watch
pnpm --filter yidhras-server test:e2e:watch
pnpm --filter yidhras-server smoke
```

说明：`pnpm --filter yidhras-server test` 会顺序执行 `test:unit`、`test:integration`、`test:e2e`。

### 3.4 运行时与数据库

```bash
pnpm --filter yidhras-server prepare:runtime
pnpm --filter yidhras-server reset:dev-db
pnpm --filter yidhras-server init:runtime
pnpm --filter yidhras-server seed:identity
pnpm --filter yidhras-server exec prisma migrate deploy
```

说明：
- `prepare:runtime`：迁移数据库 + 初始化运行时 + identity seed
- `reset:dev-db`：重置本地开发数据库
- `init:runtime`：单独执行运行时准备
- `seed:identity`：单独执行 identity seed
- `pnpm --filter yidhras-server exec prisma migrate deploy`：只应用 Prisma migration，不执行 runtime scaffold / seed
- 部署者数据库迁移/更换文档见：`DB_OPERATIONS.md`

### 3.5 常见运行配置覆盖示例

#### 3.5.1 直接改 YAML（推荐）

在 `data/configw/conf.d/<domain>.yaml` 或 `data/configw/local.yaml` 中调整。示例片段：

```yaml
# conf.d/app.yaml
app:
  port: 3001

# conf.d/database.yaml
database:
  sqlite:
    busy_timeout_ms: 5000
    synchronous: "NORMAL"

# conf.d/scheduler.yaml
scheduler:
  lease_ticks: 5
  entity_concurrency:
    default_max_active_workflows_per_entity: 1
  tick_budget:
    max_created_jobs_per_tick: 32
```

完整配置字段与默认值参见 `apps/server/src/config/domains/` 源码和 [`ARCH.md`](../ARCH.md) 第 2.4 节。

#### 3.5.2 临时使用 env 覆盖

```bash
PORT=3101 \
SQLITE_BUSY_TIMEOUT_MS=8000 \
SCHEDULER_LEASE_TICKS=5 \
SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK=1 \
pnpm --filter yidhras-server dev
```

说明：env 变量名与 YAML 字段的对应关系遵循 `CONFIG_KEY=VALUE` 约定；完整映射参见 `apps/server/src/config/` 源码。这些参数属于 runtime host policy，默认值偏保守；若世界包开发者或部署者选择不同数据库，应自行根据数据库能力调整 runner concurrency、tick budget、entity single-flight 相关参数。

### 3.5.3 Experimental multi-pack runtime 启动示例

多包 runtime 为 **experimental / default off / operator test-only**。架构边界与约束见 [`ARCH.md`](../ARCH.md) 第 3.3.1 节。

多包运行时通过 `runtime.multi_pack.*` 配置，详见 [`ARCH.md`](../ARCH.md) 第 3.3.1 节。

### 3.6 配置备份管理

```bash
pnpm --filter yidhras-server config:backup create [--name <name>]
pnpm --filter yidhras-server config:backup list [--limit <n>]
pnpm --filter yidhras-server config:backup info <id>
pnpm --filter yidhras-server config:backup restore <id> [--force]
pnpm --filter yidhras-server config:backup delete <id>
pnpm --filter yidhras-server config:backup policy
pnpm --filter yidhras-server config:backup cleanup
```

说明：
- `config:backup` 是 CLI 入口，可附加子命令。不带参数运行显示完整帮助。
- `config:backup:create`、`config:backup:list`、`config:backup:cleanup` 提供快捷别名。
- 备份归档在 `data/backups/config/`，格式为 tar.gz，元数据存于同目录 `backups.json`。
- 保留策略：最多 20 个备份，最长保留 30 天。`cleanup` 手动触发清理。
- 等效 API 端点见 [`API.md`](../API.md) 第 16 节。

### 3.7 World-Pack 与手工脚本

```bash
pnpm --filter yidhras-server scaffold:world-pack -- --dir my_pack --name "My Pack" --author "Your Name"
pnpm --filter yidhras-server manual:world-pack-runtime-demo
pnpm --filter yidhras-server manual:clock-demo
pnpm --filter yidhras-server manual:clock-raw
pnpm --filter yidhras-server manual:dynamics-demo
pnpm --filter yidhras-server manual:dynamics-pluggable-demo
pnpm --filter yidhras-server manual:narrative-demo
pnpm --filter yidhras-server manual:permission-demo
pnpm --filter yidhras-server manual:world-pack-demo
```

## 4. Web 命令

在根目录通过 `--filter web` 调用，或进入 `apps/web` 执行。

### 4.1 安装与开发

```bash
pnpm --filter web install
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web preview
```

如需覆盖后端地址：

```bash
NUXT_PUBLIC_API_BASE=http://localhost:3001 pnpm --filter web dev
```

### 4.2 质量检查与测试

```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web test:unit
pnpm --filter web test:unit:watch
```

说明：
- `test` 是 `test:unit` 的明确别名；`test:unit:watch` 用于 web unit watch。

## 5. 单文件 / 定向测试命令

### 5.1 Server integration 单文件

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/<file>.spec.ts
```

### 5.2 Server e2e 单文件

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.e2e.config.ts tests/e2e/<file>.spec.ts
```

### 5.3 Web unit 单文件

```bash
pnpm --filter web exec vitest run --config vitest.config.ts tests/unit/<file>.spec.ts
```

## 6. 开发者 CLI 工具

以下 CLI 命令均为 `apps/server` 包内脚本，通过 `pnpm --filter yidhras-server <command>` 调用。
所有命令均不依赖运行中的服务器，可直接离线使用（`sim` 和部分 `snapshot` 操作除外）。

### 6.1 数据库管理 (`db`)

```bash
pnpm --filter yidhras-server db status          # 迁移状态 + 文件信息
pnpm --filter yidhras-server db migrate          # 执行待处理的迁移
pnpm --filter yidhras-server db integrity         # PRAGMA integrity_check
pnpm --filter yidhras-server db tables            # 列出所有表及行数
pnpm --filter yidhras-server db:migrate-pack <packId>  # 迁移世界包 pack.yaml 到最新 schema_version
```

### 6.2 世界包校验 (`validate:pack`)

```bash
pnpm --filter yidhras-server validate:pack <pack-dir>   # 校验单个 pack
pnpm --filter yidhras-server validate:pack --all          # 校验所有 pack
```

校验项：配置文件存在性、YAML 解析、Zod schema 验证、README.md 存在性、插件 manifest（如有）。

### 6.3 模拟控制 (`sim`)

需要服务器运行中。

```bash
pnpm --filter yidhras-server sim status     # 运行时状态摘要 (公开端点)
pnpm --filter yidhras-server sim pause      # 暂停模拟循环 (需认证)
pnpm --filter yidhras-server sim resume     # 恢复模拟循环 (需认证)
pnpm --filter yidhras-server sim speed <n|reset>  # 设置/重置速度倍率 (需认证)
pnpm --filter yidhras-server sim login --username <u> --password <p>  # 登录获取 token
```

认证方式：`--token <token>` 参数或 `YIDHRAS_TOKEN` 环境变量。
默认服务器地址：`http://localhost:3001`（可通过 `--base-url` 覆盖）。

#### 6.3.1 运行时 Dump (`sim:dump`)

直接读取 pack 数据库，输出 JSON 到 stdout，不需要服务器运行。

```bash
pnpm --filter yidhras-server sim:dump <packId> --type agent     # 实体 + 状态
pnpm --filter yidhras-server sim:dump <packId> --type relation  # 权限授予 + 中介绑定
pnpm --filter yidhras-server sim:dump <packId> --type memory    # 规则执行记录
pnpm --filter yidhras-server sim:dump <packId> --type all       # 以上全部
```

### 6.4 AI 网关工具 (`ai`)

```bash
pnpm --filter yidhras-server ai models       # 列出所有注册模型及状态
pnpm --filter yidhras-server ai test <model>  # 发送最小化请求验证连通性
```

模型列表来自内置注册表 (`BUILTIN_AI_REGISTRY_CONFIG`) 与 `apps/server/config/ai_models.yaml` 的合并结果。

### 6.5 运行时诊断 (`diag`)

```bash
pnpm --filter yidhras-server diag            # 完整诊断报告
pnpm --filter yidhras-server diag --json     # JSON 格式输出
```

输出内容：数据库信息、配置域列表、World-Pack 清单、备份状态、环境信息。

### 6.6 操作者管理 (`operator`)

```bash
pnpm --filter yidhras-server operator create --name <u> --password <p> [--root]
pnpm --filter yidhras-server operator list [--limit <n>]
pnpm --filter yidhras-server operator show <id>
pnpm --filter yidhras-server operator update <id> [--password <p>] [--status active|disabled|suspended] [--root]
pnpm --filter yidhras-server operator delete <id>
```

注意：`delete` 为软删除（状态设为 `disabled`），非物理删除。

### 6.7 快照管理 (`snapshot`)

```bash
pnpm --filter yidhras-server snapshot list [--pack <pack-id>]
pnpm --filter yidhras-server snapshot show <id> --pack <pack-id>
pnpm --filter yidhras-server snapshot delete <id> --pack <pack-id> [--force]
```

注意：`create` 和 `restore` 需要服务器运行中，请使用 HTTP API：
- `POST /api/packs/snapshots` — 创建快照
- `POST /api/packs/snapshots/:id/restore` — 恢复快照

### 6.8 插件治理 (`plugin`)

```bash
pnpm --filter yidhras-server plugin list [--pack <pack-id>]   # 列出插件
pnpm --filter yidhras-server plugin confirm <id> --pack <p>   # 确认导入
pnpm --filter yidhras-server plugin enable <id> --pack <p>    # 启用
pnpm --filter yidhras-server plugin disable <id> --pack <p>   # 禁用
```

CLI 命令直接操作 Prisma，不需要服务器运行。也可通过 HTTP API 操作：

```bash
GET    /api/packs/:id/plugins              # 列出插件
POST   /api/packs/:id/plugins/:id/confirm  # 确认导入
POST   /api/packs/:id/plugins/:id/enable   # 启用
POST   /api/packs/:id/plugins/:id/disable  # 禁用
```

更完整的治理说明、acknowledgement 语义、GUI/CLI 对照和排障路径见 `docs/guides/PLUGIN_OPERATIONS.md`。

### 6.9 世界包导出/导入 (`pack:export` / `pack:import`)

```bash
pnpm --filter yidhras-server pack:export <pack-dir> [--output <path>] [--force] [--json]
pnpm --filter yidhras-server pack:import <archive> [--force] [--json]
```

说明：
- `export`：将 world pack 打包为 `<id>-<version>.tar.gz`，同时生成 `.sha256` 校验文件。默认输出到工作目录，`--output` 指定输出路径。导出前自动运行 validate:pack 校验，校验失败则拒绝（`--force` 跳过）。
- `import`：从 `.tar.gz` 归档安装 world pack 到 `data/world_packs/<id>/`。自动校验归档内容，目标目录已存在时需 `--force` 覆盖。
- 排除项：`.git`、`node_modules`、`runtime/`、临时文件。
- 支持 `--json` 机器可读输出。

## 7. 常用工作流建议

### 7.1 首次启动仓库

```bash
pnpm install
pnpm prepare:runtime
pnpm dev:server
pnpm dev:web
```

### 7.2 本地改动后的常规检查

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
```

如涉及 server 接口、工作流或 runtime 行为，再补：

```bash
pnpm test:integration
pnpm test:e2e
```

### 7.3 修改 server 后的最小验证

```bash
pnpm --filter yidhras-server lint
pnpm --filter yidhras-server typecheck
pnpm --filter yidhras-server test:integration
```

### 7.4 修改 web 后的最小验证

```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test:unit
```

## 8. 文档边界

命令定义以 `package.json` 为准；本文件为命令说明主事实源。命令与文档的分工见 [`INDEX.md`](../INDEX.md)。
