# CLI 功能扩充 设计

> 状态: 已实现 (阶段 1-3 完成，阶段 4 暂缓)
> 关联: TODO.md — 梳理当前代码实现
> 评估时间: 2026-05-02
> 实施时间: 2026-05-02

## 1. 背景

Yidhras 当前没有独立 CLI 包。CLI 能力内嵌在 `apps/server` 中，通过 `tsx` 将 TypeScript 源文件作为一次性脚本执行。参数解析全部手工完成（`process.argv` + `switch`/`for`），不依赖 commander/yargs。

### 1.1 现有 CLI 命令

| 命令 | 源文件 | 状态 |
|------|--------|------|
| `pnpm config:backup` | `src/cli/config_backup_cli.ts` | 活跃 |
| `pnpm init:configw` | `src/init/init_configw.ts` | 活跃 |
| `pnpm init:world-pack` | `src/init/init_world_pack.ts` | 活跃 |
| `pnpm init:runtime` | `src/init/prepare_runtime.ts` | 活跃 |
| `pnpm scaffold:world-pack` | `src/init/scaffold_world_pack.ts` | 活跃 |
| `pnpm reset:dev-db` | `src/init/reset_dev_db.ts` | 活跃 |
| `pnpm seed:identity` | `src/db/seed_identity.ts` | 活跃 |
| `pnpm plugin` | `src/cli/plugin_cli.ts` | **源文件已删除** |

### 1.2 现有 HTTP API 覆盖但 CLI 缺失的能力

| 能力 | HTTP API | CLI 对应 |
|------|----------|----------|
| 运行时状态 | `GET /api/status` | 无 |
| 时钟控制 | `POST /api/clock/control` | 无 |
| 运行时速度 | `POST /api/runtime/speed` | 无 |
| 操作者管理 | `POST/GET/PATCH/DELETE /api/operators` | 无 |
| 快照管理 | `POST/GET/DELETE /api/packs/snapshots` | 无 |
| 插件管理 | `GET/POST /api/packs/:id/plugins/...` | plugin CLI 已删除 |
| 审计日志 | `GET /api/audit/logs` | 无 |

### 1.3 结构性缺陷

1. **plugin CLI 死代码**: 源文件在兼容性清理中删除，但 `package.json` 脚本和测试文件仍引用，形成断裂面
2. **服务器离线时无法管理**: 数据库检查、操作者管理、模拟控制等操作必须通过运行中的 HTTP API，开发和调试时需先启动完整服务器
3. **无校验命令**: world pack 作者无法在不启动运行时的前提下验证 pack 结构和配置的正确性
4. **AI 配置调试盲区**: 测试模型连通性和 prompt 模板必须启动服务器再 curl，没有离线验证手段

## 2. 核心设计原则

1. **离线优先**: CLI 命令直接操作文件系统和 SQLite，不依赖运行中的服务器。需要服务器上下文的命令（如模拟控制）通过 Unix socket 或 PID 文件与运行实例通信
2. **复用现有服务层**: CLI 仅做参数解析和输出格式化，业务逻辑调用已有的 `apps/server/src/app/services/` 模块，不重复实现
3. **与 config:backup 风格一致**: 所有新 CLI 遵循 `config_backup_cli.ts` 的手工参数解析 + `runCli()` async 入口模式
4. **零新依赖**: 不引入 commander/yargs/inquirer，保持与现有 CLI 风格一致；参数解析使用手写 `parseArgs`，输出用 `console.log` + `--json` 标志支持机器可读
5. **渐进交付**: 按优先级分阶段实现，每个阶段独立可合并、可测试

## 3. CLI 缺口全景

### 3.1 已死代码清理

**#A — plugin CLI 残留清理**

- 源文件 `apps/server/src/cli/plugin_cli.ts` 已删除
- 残留项:
  - `apps/server/package.json` 中 `"plugin": "tsx src/cli/plugin_cli.ts"` 脚本
  - `apps/server/tests/unit/plugin_cli.spec.ts` — 全部 `describe.skip`，保留作参考

### 3.2 数据库管理 (db)

**#1 — 数据库状态与迁移管理**

当前只有 `reset:dev-db`（暴力删除重建），缺少:

- 迁移状态查看: 哪些 migration 已应用、何时应用
- 手动迁移执行: `pnpm db:migrate`（当前迁移在 `prepare:runtime` 中自动执行，无独立入口）
- 数据库完整性检查: `PRAGMA integrity_check`
- 表信息查看: 列出所有表及行数

### 3.3 世界包校验 (validate)

**#2 — 世界包结构与配置校验**

对标 `helm lint` / `npm pack --dry-run`。pack 作者需要在不启动运行时的前提下验证:

- 目录结构完整性（`config.yaml`、`README.md` 存在）
- `config.yaml` 格式合法性
- manifest 字段完备性
- 插件目录结构（如有）
- 运行时目录权限

### 3.4 模拟控制 (sim)

**#3 — 运行时模拟管理**

HTTP API 已有完整端点（`/api/status`, `/api/clock/control`, `/api/runtime/speed`），无 CLI 对应。需要:

- `sim:status` — 显示循环状态、当前 tick、调度器状态、AI 网关健康
- `sim:pause` / `sim:resume` — 暂停/恢复模拟循环
- `sim:speed` — 设置运行时速度倍率

这些命令需要与运行中的服务器通信。不引入新的 IPC 机制 — 直接复用 HTTP API（发请求到 `localhost:3001`），复用现有的 JWT 认证。

### 3.5 AI 网关测试 (ai)

**#4 — AI 模型连通性与 prompt 测试**

- `ai:models` — 列出已注册的模型及状态
- `ai:test <model-id>` — 发送最小化请求验证模型连通性
- `ai:prompt <prompt-id>` — 用指定 prompt 模板发送请求，打印响应

不需要启动服务器。直接调用 `src/ai/gateway.ts` 的模型注册表和适配器，绕过 HTTP 层。

### 3.6 运行时诊断 (diag)

**#5 — 离线运行时状态快照**

对标 `GET /api/status`，但不依赖服务器运行:

- 数据库文件信息（大小、表计数、WAL 状态）
- 配置加载状态（conf.d 文件列表、漂移检测结果）
- world pack 目录清单
- 备份目录状态

纯文件系统和 SQLite 读取操作，不需要服务器进程。

### 3.7 操作者管理 (operator)

**#6 — 操作者 CRUD CLI**

HTTP API 已有完整端点，无 CLI 对应:

- `operator:create --name <name> --role <role>`
- `operator:list [--limit <n>]`
- `operator:show <id>`
- `operator:update <id> --role <role>`
- `operator:delete <id>`

直接操作 Prisma + SQLite，复用 `apps/server/src/app/services/` 中已有的操作者业务逻辑模块（如存在），否则直接调 Prisma。

### 3.8 快照管理 (snapshot)

**#7 — 世界包快照 CLI**

HTTP API 已有完整端点，无 CLI 对应:

- `snapshot:create [--name <name>] [--pack <pack-id>]`
- `snapshot:list [--pack <pack-id>] [--limit <n>]`
- `snapshot:show <id>`
- `snapshot:restore <id> [--force]`
- `snapshot:delete <id>`

涉及运行时暂停 → 快照 → 恢复的编排。复用 `apps/server/src/app/services/` 中的快照服务逻辑。

### 3.9 世界包导出 (pack)

**#8 — 世界包打包分发**

- `pack:export <pack-dir> [--output <path>]` — 将 world pack 打包为 `.tar.gz`

此项需要先明确分发模型（pack registry? 直接文件分发?），排在最后。

## 4. 优先级排布

优先级判定维度: 开发调试痛点 × 实现复杂度 × 阻塞其他工作的程度

| 优先级 | 编号 | 命令 | 理由 |
|--------|------|------|------|
| P0 | #A | plugin 残留清理 | 零风险，5 分钟，消除死代码断裂面 | [x] 已完成 |
| P1 | #1 | db 管理 | 开发调试高频操作，离线可用，实现简单 | [x] 已完成 |
| P1 | #2 | validate | pack 作者刚需，离线可用，实现简单 | [x] 已完成 |
| P2 | #3 | sim 控制 | 需服务器运行，但复用 HTTP API 即可，实现简单 | [x] 已完成 |
| P2 | #4 | ai 测试 | 直接调用现有 AI 网关模块，无需服务器 | [x] 已完成 |
| P2 | #5 | diag | 纯只读文件/SQLite 操作，极低风险 | [x] 已完成 |
| P3 | #6 | operator 管理 | 直接操作 Prisma，但不常用 | [x] 已完成 |
| P3 | #7 | snapshot 管理 | 业务逻辑重，需编排暂停/快照/恢复 | [x] 已完成 (list/show/delete 离线, create/restore 指向 HTTP API) |
| P4 | #8 | pack 导出 | 需先明确分发模型设计 | [ ] 暂缓 |

## 5. 分阶段实施

### 阶段 1: 清理 + 高频离线命令

#### 5.1.1 清理 plugin CLI 残留

**文件变更**:
- `apps/server/package.json` — 移除 `"plugin"` 脚本行、`"config:backup"` 脚本行（此脚本同文件已无意义，确认 config:backup 仍在使用中，保留）
- 确认 `apps/server/tests/unit/plugin_cli.spec.ts` 保持跳过状态，或移入 `tests/archive/`

**验证**: `pnpm typecheck` + `pnpm lint` 通过

---

#### 5.1.2 数据库管理 CLI (`pnpm db`)

**新文件**: `apps/server/src/cli/db_cli.ts`

**命令**:
```bash
pnpm db status                        # 迁移状态 + 数据库文件信息
pnpm db migrate                       # 执行待处理的迁移
pnpm db integrity                     # PRAGMA integrity_check
pnpm db tables                        # 列出所有表及行数
pnpm db --help
```

**实现要点**:
- 复用 `apps/server/src/db/` 中现有 Prisma 初始化逻辑
- `status` 输出: 数据库路径、文件大小、WAL 大小、已应用迁移列表及时间戳
- `migrate` 调用 `prisma migrate deploy`（通过 `execSync`）
- `integrity` 执行 `PRAGMA integrity_check` 原生查询
- `tables` 执行 `SELECT name FROM sqlite_master WHERE type='table'` 并逐表 COUNT

**依赖**: Prisma client、`better-sqlite3` 或直接通过 Prisma `$queryRaw`

**`package.json` 脚本**:
```json
"db": "tsx src/cli/db_cli.ts"
```

---

#### 5.1.3 世界包校验 CLI (`pnpm validate:pack`)

**新文件**: `apps/server/src/cli/validate_pack_cli.ts`

**命令**:
```bash
pnpm validate:pack <pack-dir>         # 校验指定 pack 目录
pnpm validate:pack --all               # 校验 data/world_packs/ 下所有 pack
pnpm validate:pack --help
```

**校验项目**:
1. **结构完整性**:
   - `config.yaml` 存在且 YAML 可解析
   - `README.md` 存在（warn，非 error）
2. **Manifest 完备性**:
   - `id`（kebab-case，长度 3-64）
   - `name`（非空字符串）
   - `version`（semver 格式）
   - `status`（枚举值: `active` | `draft` | `archived`）
3. **config.yaml 合法性**:
   - 使用 `src/packs/schema/constitution_schema.ts` 已有 Zod schema 校验
   - 报告所有 Zod 错误及路径
4. **插件目录**（如存在 `plugins/`）:
   - 每个子目录包含 `plugin.manifest.yaml`
   - 每个 manifest 格式合法
5. **运行时目录**（如存在 `runtime/`）:
   - 可读写检查

**输出格式**: 人类可读（默认）或 JSON（`--json`），每个校验项标注 `PASS` / `WARN` / `FAIL`

**实现要点**:
- 不加载 pack 到运行时，纯文件系统读取 + YAML 解析 + Zod 校验
- 复用 `src/packs/schema/constitution_schema.ts` 的 Zod schema

**`package.json` 脚本**:
```json
"validate:pack": "tsx src/cli/validate_pack_cli.ts"
```

---

### 阶段 2: 运行时交互 + AI 调试

#### 5.2.1 模拟控制 CLI (`pnpm sim`)

**新文件**: `apps/server/src/cli/sim_cli.ts`

**命令**:
```bash
pnpm sim status                       # 运行时状态摘要
pnpm sim pause                        # 暂停模拟循环
pnpm sim resume                       # 恢复模拟循环
pnpm sim speed <multiplier>           # 设置速度倍率 (0 = 停止, -1 = 尽可能快)
pnpm sim speed reset                  # 恢复默认速度
pnpm sim --help
```

**实现要点**:
- 通过 HTTP 请求到 `http://localhost:3001` 与运行中的服务器通信
- 复用现有 API 端点: `GET /api/status`, `POST /api/clock/control`, `POST /api/runtime/speed`
- 从 `data/configw/local.yaml`（如存在）或默认值读取端口
- 需 JWT 认证: 从环境变量 `YIDHRAS_TOKEN` 读取，或通过 `data/` 下的 token 文件
- 服务器未运行时给出明确提示: "服务器未运行 (localhost:3001 不可达)"

**`package.json` 脚本**:
```json
"sim": "tsx src/cli/sim_cli.ts"
```

---

#### 5.2.2 AI 网关测试 CLI (`pnpm ai`)

**新文件**: `apps/server/src/cli/ai_cli.ts`

**命令**:
```bash
pnpm ai models                        # 列出所有注册模型及状态
pnpm ai test <model-id>               # 发送最小化请求验证连通性
pnpm ai prompt <prompt-id> [--model <model-id>] [--var key=value ...]  # 测试 prompt 模板
pnpm ai --help
```

**实现要点**:
- 不启动 HTTP 服务器，直接初始化 AI 网关的模型注册表和适配器
- `models` 从 `apps/server/config/ai_models.yaml` 和 `data/configw/conf.d/` 读取模型列表，打印: provider, model name, status
- `test <model-id>` 调用对应 provider 适配器，发送 "Hello, respond with 'ok' only." 消息，打印响应和延迟
- `prompt <prompt-id>` 加载指定 prompt 模板，填充变量，发送到指定模型，打印完整响应
- 需要初始化 Prisma（prompt 模板在 DB 中）或直接读 YAML（取决于当前 prompt 存储方式）

**注意**: 此命令需要加载配置系统（模型注册表在 `ai_models.yaml`），但不启动 Express 服务器。需要从 `src/ai/gateway.ts` 中提取模型注册表为独立可调用的模块。

**`package.json` 脚本**:
```json
"ai": "tsx src/cli/ai_cli.ts"
```

---

#### 5.2.3 运行时诊断 CLI (`pnpm diag`)

**新文件**: `apps/server/src/cli/diag_cli.ts`

**命令**:
```bash
pnpm diag                             # 完整诊断报告
pnpm diag --json                      # JSON 格式输出
pnpm diag --help
```

**输出内容**:
1. **数据库**:
   - 文件路径、大小、WAL 大小
   - 表列表及行数
   - `PRAGMA integrity_check` 结果
   - 迁移状态摘要
2. **配置**:
   - `conf.d/` 文件清单
   - 各域加载来源（默认 / 模板 / 本地覆写）
   - 漂移检测结果（如有）
3. **World Packs**:
   - `data/world_packs/` 目录清单
   - 每个 pack 的 id / name / version / status
   - 运行时数据库是否存在
4. **备份**:
   - 备份数量、最近备份时间、总占用空间
5. **环境**:
   - Node.js 版本、pnpm 版本
   - 关键环境变量（`NODE_ENV`, `DATABASE_URL`）

**实现要点**:
- 纯只读操作: 文件系统 stat + SQLite 查询 + YAML 解析
- 复用 `src/app/services/config_backup.ts` 的备份列表
- 复用 pack manifest loader 的目录扫描逻辑
- 不写入任何文件，不修改任何状态

**`package.json` 脚本**:
```json
"diag": "tsx src/cli/diag_cli.ts"
```

---

### 阶段 3: 管理类命令

#### 5.3.1 操作者管理 CLI (`pnpm operator`)

**新文件**: `apps/server/src/cli/operator_cli.ts`

**命令**:
```bash
pnpm operator create --name <name> [--role <role>]
pnpm operator list [--limit <n>]
pnpm operator show <id>
pnpm operator update <id> [--role <role>]
pnpm operator delete <id>
pnpm operator --help
```

**实现要点**:
- 直接初始化 Prisma client，操作 `Operator` 表
- 若有 `apps/server/src/app/services/` 中的操作者服务模块，复用之；否则直接 Prisma 查询
- 敏感字段（password_hash 等）不打印
- `delete` 为软删除（若 schema 支持）或硬删除 + 确认提示

**`package.json` 脚本**:
```json
"operator": "tsx src/cli/operator_cli.ts"
```

---

#### 5.3.2 快照管理 CLI (`pnpm snapshot`)

**新文件**: `apps/server/src/cli/snapshot_cli.ts`

**命令**:
```bash
pnpm snapshot create [--name <name>] [--pack <pack-id>]
pnpm snapshot list [--pack <pack-id>] [--limit <n>]
pnpm snapshot show <id>
pnpm snapshot restore <id> [--force]
pnpm snapshot delete <id>
pnpm snapshot --help
```

**实现要点**:
- 复用 `apps/server/src/app/services/` 中的快照服务（若存在）
- 直接操作 Prisma + 文件系统（快照数据存储位置需确认）
- `create` 涉及运行时状态序列化 — 若服务层已封装，直接调用；否则需要暂停模拟 → 复制数据 → 恢复的流程
- `restore` 需要 `--force` 确认

**`package.json` 脚本**:
```json
"snapshot": "tsx src/cli/snapshot_cli.ts"
```

---

### 阶段 4: 分发支持

#### 5.4.1 世界包导出 CLI (`pnpm pack:export`)

**新文件**: `apps/server/src/cli/pack_export_cli.ts`

**命令**:
```bash
pnpm pack:export <pack-dir> [--output <path>]
pnpm pack:export --help
```

**实现要点**:
- 先运行 validate:pack 校验，校验失败则拒绝导出（`--force` 可跳过）
- 排除 `.git`、`node_modules`、`runtime/`（运行时数据）、临时文件
- 生成 `.tar.gz` 归档
- 归档内包含: `config.yaml`, `README.md`, `CHANGELOG.md`, `plugins/`, `assets/`（如有）

**设计前置条件**: 需明确 world pack 的分发模型（本地 tar.gz? registry? git-based?），此命令仅实现本地打包。若后续有 registry 需求，在此基础上加 `--publish`。

**`package.json` 脚本**:
```json
"pack:export": "tsx src/cli/pack_export_cli.ts"
```

---

## 6. 文件结构总览

实施完成后 CLI 目录布局:

```
apps/server/src/cli/
  config_backup_cli.ts       # 已有 — 配置备份管理
  db_cli.ts                  # 阶段 1 — 数据库管理
  validate_pack_cli.ts       # 阶段 1 — 世界包校验
  sim_cli.ts                 # 阶段 2 — 模拟控制
  ai_cli.ts                  # 阶段 2 — AI 网关测试
  diag_cli.ts                # 阶段 2 — 运行时诊断
  operator_cli.ts            # 阶段 3 — 操作者管理
  snapshot_cli.ts            # 阶段 3 — 快照管理
  pack_export_cli.ts         # 阶段 4 — 世界包导出
```

## 7. 实施记录

### 7.1 实际实现与设计差异

| 项目 | 设计 | 实际实现 | 原因 |
|------|------|----------|------|
| sim 通信 | HTTP 直接调用 | 同设计 | |
| sim 认证 | JWT token (YIDHRAS_TOKEN env) | 同设计，增加 `sim login` 命令 | 方便获取 token |
| ai 模型读取 | 读 YAML 文件 | 读 `BUILTIN_AI_REGISTRY_CONFIG` 常量 + YAML 合并 | 模型实际在 TS 常量中，YAML 只有空模板 |
| ai prompt 命令 | `ai prompt <id>` | 未实现 | prompt 模板加载依赖复杂，暂跳过 |
| snapshot create/restore | Prisma + 运行时 | 未实现，指向 HTTP API | create/restore 需要完整运行时上下文 |
| operator 实现 | 复用服务层 | 直接操作 Prisma + bcrypt | 服务层依赖 AppContext，CLI 无法构造 |

### 7.2 后续工作

- [ ] 如有超过 5 个 CLI 命令，考虑将公共参数解析逻辑提取为 `cli/lib/args.ts`（`--help`、`--json`、positional command dispatch），避免每个 CLI 文件重复实现
- [ ] 如 sim CLI 的 HTTP 通信模式被多个命令使用（如 operator 也改为 HTTP），提取为 `cli/lib/http_client.ts`
- [ ] CI 中加入 CLI 冒烟测试: `pnpm db status --json` 返回有效 JSON 且 exit code 0
- [ ] 阶段 4: `pack:export` — 需要先明确分发模型
- [ ] `ai prompt` 命令 — 需要 prompt 模板系统的轻量加载路径
- [ ] `snapshot create/restore` — 需要不启动完整服务器即可访问的运行时外观
