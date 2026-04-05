# Yidhras (伊德海拉)

叙事引擎与 Agent 模拟器，用于构建带有情报分析、社会操控与分层世界建模感的模拟系统。

> 本文件是仓库入口页，只负责项目总览、启动方式与文档导航；详细架构、接口、业务规则、阶段状态请看对应专门文档。

## 项目定位

Yidhras 当前是一套以可运行后端基线为中心的叙事模拟工程，核心关注点包括：

- 分层世界模型（L1/L2/L3/L4）
- Agent 推理与最小工作流
- world-pack 驱动的运行时内容
- 面向前后端协作的稳定接口边界
- 正在演进为 Operator-first 控制台前端

## 仓库结构

- `apps/server`：TypeScript + Express + Prisma + SQLite 后端
- `apps/web`：Nuxt 4 + Vue 3 + Pinia 前端
- `packages/contracts`：前后端共享 transport/contract 定义
- `docs/`：详细说明文档
- `TODO.md`：当前里程碑与优先级
- `记录.md`：验证快照与验收记录

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 10+

### 安装依赖

```bash
pnpm install
```

### 准备运行时

```bash
pnpm --filter yidhras-server prepare:runtime
```

### 启动项目

#### Linux / macOS

```bash
chmod +x start-dev.sh
./start-dev.sh
```

#### Windows

```cmd
start-dev.bat
```

## 开发环境稳定性说明

后端开发环境现在默认启用了针对 SQLite runtime 的稳定性修复，以避免 `schedulerLease.upsert()` 一类因锁竞争导致的超时：

- simulation loop 已改为**严格串行执行**，不再使用会重入的 `setInterval(async ...)`
- SQLite 启动时会自动应用运行时 pragma：
  - `journal_mode=WAL`
  - `busy_timeout=5000`
  - `synchronous=NORMAL`
  - `foreign_keys=ON`
- development 环境默认会在服务启动前清理 runtime 观测/工作流表，防止开发库无限膨胀

### 一键重建开发数据库

如果开发库状态混乱、体积过大，或想重新从干净环境开始：

```bash
pnpm --filter yidhras-server run reset:dev-db
```

这个脚本会：

1. 检查 `apps/server` 是否仍有 dev/e2e 进程在运行
2. 删除：
   - `data/yidhras.sqlite`
   - `data/yidhras.sqlite-wal`
   - `data/yidhras.sqlite-shm`
3. 重新执行：
   - `prisma migrate deploy`
   - `init:runtime`
   - `seed:identity`

> 这是开发环境破坏式重置命令，会清空本地 SQLite 数据。

### 开发环境默认开关

以下环境变量可用于调试 runtime 稳定性行为：

- `DEV_RUNTIME_RESET_ON_START`
  - 默认：开启
  - 作用：development 环境启动前是否自动清理 `SchedulerRun / SchedulerCandidateDecision / InferenceTrace / DecisionJob / ActionIntent / SchedulerCursor / SchedulerLease`
- `SIM_LOOP_INTERVAL_MS`
  - 默认：`1000`
  - 作用：覆盖 simulation loop 的串行调度间隔
- `SQLITE_BUSY_TIMEOUT_MS`
  - 默认：`5000`
  - 作用：覆盖 SQLite busy timeout
- `SQLITE_WAL_AUTOCHECKPOINT_PAGES`
  - 默认：`1000`
  - 作用：覆盖 SQLite WAL autocheckpoint 页数
- `SQLITE_SYNCHRONOUS`
  - 默认：`NORMAL`
  - 可选：`OFF | NORMAL | FULL | EXTRA`
  - 作用：覆盖 SQLite synchronous 模式

### 调试与验证

可以通过以下方式确认修复生效：

```bash
pnpm --filter yidhras-server typecheck
pnpm --filter yidhras-server run test:scheduler-runtime-status
pnpm --filter yidhras-server run test:scheduler-loop-serialization
```

其中：

- `test:scheduler-runtime-status` 会检查 `/api/status` 中是否暴露 `runtime_loop` 和 `sqlite` 信息，以及 pragma 是否生效
- `test:scheduler-loop-serialization` 会注入人为延迟，证明 simulation loop 在长耗时场景下仍不会重入

## 运行时配置（configw）

`data/` 目录继续作为部署者本地运行数据区，默认不纳入版本管理。项目拉取后即使不存在 `data/`，服务端也会在首次启动时自动创建并补齐运行所需的 `data/configw/**` 配置文件与模板副本。

### 初始化链路

当前初始化职责已收口为 3 层：

1. `init:configw`
   - 仅负责把版本管理中的种子模板 materialize 到 `data/configw/**`
2. `init:world-pack`
   - 仅负责根据运行时配置执行默认 world pack bootstrap
3. `init:runtime`
   - 组合执行 configw scaffold + runtime snapshot + world pack bootstrap

而 `prepare:runtime` 负责：

- 数据库迁移
- `init:runtime`
- identity seed

### 初始化报告

`init:configw`、`init:world-pack`、`init:runtime` 现在都会额外输出一条结构化日志：

- 前缀：`[init-report]`
- 内容：JSON

可用于：

- CI 检查
- 首次部署验证
- 运维排障

### 版本管理中的种子模板

版本管理保留的是种子模板，而不是部署者运行后的 `data/` 内容：

- `apps/server/templates/configw/default.yaml`
- `apps/server/templates/configw/development.yaml`
- `apps/server/templates/configw/production.yaml`
- `apps/server/templates/configw/test.yaml`
- `apps/server/templates/world-pack/death_note.yaml`

首次启动时，这些模板会被复制到：

- `data/configw/default.yaml`
- `data/configw/development.yaml`
- `data/configw/production.yaml`
- `data/configw/test.yaml`
- `data/configw/templates/world-pack/death_note.yaml`

### 配置优先级

最终生效配置按以下顺序覆盖：

1. 代码内置默认值
2. `data/configw/default.yaml`
3. `data/configw/{APP_ENV}.yaml`
4. `data/configw/local.yaml`
5. 环境变量

### 当前支持的关键环境变量

- `APP_ENV`：选择环境配置文件，默认回退 `NODE_ENV`，最终默认 `development`
- `PORT`：覆盖服务端端口
- `WORLD_PACK`：覆盖默认启动 world pack
- `WORLD_PACKS_DIR`：覆盖 world packs 根目录
- `WORLD_BOOTSTRAP_ENABLED`：控制是否执行默认 world pack bootstrap
- `WORLD_BOOTSTRAP_TARGET_PACK_DIR`：控制 bootstrap 目标文件夹名
- `WORLD_BOOTSTRAP_TEMPLATE_FILE`：控制 bootstrap 模板文件路径
- `WORLD_BOOTSTRAP_OVERWRITE`：控制是否覆盖已有 `config.yaml`
- `STARTUP_ALLOW_DEGRADED_MODE`：控制是否允许以 degraded 模式启动
- `STARTUP_FAIL_ON_MISSING_WORLD_PACK_DIR`：缺少 world pack 目录时是否直接 fail
- `STARTUP_FAIL_ON_NO_WORLD_PACK`：没有可用 world pack 时是否直接 fail

## 常用命令

- 启动后端：`pnpm --filter yidhras-server dev`
- 启动前端：`pnpm --filter web dev`
- 后端 lint：`pnpm --filter yidhras-server lint`
- 前端 lint：`pnpm --filter web lint`
- 后端 typecheck：`pnpm --filter yidhras-server typecheck`
- 前端 typecheck：`pnpm --filter web typecheck`
- 前端单测：`pnpm --filter web test:unit`
- 后端冒烟：`pnpm --filter yidhras-server smoke`

## 文档导航

### 仓库入口文档

- `README.md`：项目入口、快速开始、文档导航
- `AGENTS.md`：协作约定、开发命令、工程规则
- `TODO.md`：里程碑状态与近期优先级
- `记录.md`：验证证据、验收边界、历史快照

### 详细说明文档

- `docs/INDEX.md`：详细文档导航
- `docs/API.md`：当前对外接口契约与错误码
- `docs/ARCH.md`：稳定架构边界与模块职责
- `docs/LOGIC.md`：业务规则、领域语义与边界说明
- `docs/THEME.md`：前端主题 contract、默认主题与 provider-owned theme 约定
- `docs/ENHANCEMENTS.md`：当前暂缓处理、但值得后续回收的增强项清单
- `apps/web/README.md`：前端当前状态、Guardrails 与主文件锚点

## 当前状态

- 后端基线、最小工作流、contracts/Zod 路径与统一错误包络已稳定。
- 前端 Operator-first 控制台、Graph 深化与 Timeline / Social 语义映射增量已落地；细节见 `apps/web/README.md`。
- 当前正式里程碑状态与下一优先级以 `TODO.md` 为准，验证证据与历史快照见 `记录.md`。
