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
- `pnpm scaffold:world-pack` 是新建 world pack 项目的统一入口。
- `pnpm smoke:server` 用于快速运行 server 冒烟验证。
- 数据库迁移、初始化、路径更换与常见坑的展开说明见：`DB_OPERATIONS.md`

### 2.6 Runtime 配置与优先级

当前 server 继续沿用 `data/configw` runtime config scaffold。优先级链与配置边界的事实源见 [`ARCH.md`](../ARCH.md) 第 2.4 节。

简要结论：**env > yaml > code default**（详细优先级列表见 ARCH.md）。

当前已迁入 `configw` 的重点运行参数包括：

- `app.port`
- `world.preferred_pack` / `world.bootstrap.*`
- `sqlite.*`
- `scheduler.*`
- `prompt_workflow.profiles.*`
- `features.experimental.multi_pack_runtime.*`
- `runtime.multi_pack.*`

说明：

- experimental multi-pack runtime 默认关闭，只推荐 operator / test-only 试验
- 稳定模式仍以 single active-pack runtime 为中心
- 多包 runtime 的架构边界与启用约束见 [`ARCH.md`](../ARCH.md) 第 3.3.1 节

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

在 `data/configw/default.yaml` 或 `data/configw/local.yaml` 中调整。示例片段：

```yaml
app:
  port: 3001

sqlite:
  busy_timeout_ms: 5000
  synchronous: "NORMAL"

scheduler:
  lease_ticks: 5
  entity_concurrency:
    default_max_active_workflows_per_entity: 1
  tick_budget:
    max_created_jobs_per_tick: 32
```

完整配置字段与默认值参见 `apps/server/src/config/` 源码和 [`ARCH.md`](../ARCH.md) 第 2.4 节。

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

多包 runtime 当前为 **experimental / default off / operator test-only**。架构边界与约束见 [`ARCH.md`](../ARCH.md) 第 3.3.1 节。

临时通过 env 打开：

```bash
EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED=true \
EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED=true \
pnpm --filter yidhras-server dev
```

或在 YAML 中设置 `features.experimental.multi_pack_runtime.*` 与 `runtime.multi_pack.*`。试验建议：

- 默认保持 `start_mode=manual`
- 保守设置 `max_loaded_packs`
- 先通过 experimental API 显式 load / unload runtime

### 3.5 World Pack 与手工脚本

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

## 6. 插件治理入口命令

当前统一入口：

```bash
pnpm --filter yidhras-server plugin -- <command>
```

常见 command 包括：

- `list`
- `show`
- `confirm`
- `enable`
- `disable`
- `rescan`
- `logs`
- `why-not-enable`

示例：

```bash
pnpm --filter yidhras-server plugin -- list --pack my_pack
pnpm --filter yidhras-server plugin -- show --plugin plugin.alpha --pack my_pack
pnpm --filter yidhras-server plugin -- confirm --plugin plugin.alpha --pack my_pack --grant requested
pnpm --filter yidhras-server plugin -- enable --plugin plugin.alpha --pack my_pack --yes --non-interactive
pnpm --filter yidhras-server plugin -- disable --plugin plugin.alpha --pack my_pack --yes --non-interactive
pnpm --filter yidhras-server plugin -- rescan --pack my_pack
```

说明：
- 本文件只保留入口与少量示例；
- 更完整的治理说明、acknowledgement 语义、GUI/CLI 对照和排障路径，应放入 `docs/guides/PLUGIN_OPERATIONS.md`。

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

## 8. 命令维护边界

以下文件与本文件存在引用关系：

- `README.md`
  - 只保留最小启动与高频入口
- `AGENTS.md`
  - 只保留给协作代理的高频命令和约束链接
- `package.json`
  - 实际脚本定义源
- `apps/server/package.json`
  - server 脚本定义源
- `apps/web/package.json`
  - web 脚本定义源

若出现不一致，优先级建议为：

1. `package.json` / 子包 `package.json`
2. 本文件 `docs/guides/COMMANDS.md`
3. `README.md` / `AGENTS.md` 中的摘要命令
