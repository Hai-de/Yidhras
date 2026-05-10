# 部署与运维设计草案

> 状态：草稿（分批写作中）
> 基于：`.limcode/design/skeptical-comprehensive-audit-report.md` §4.14 缺口分析
> 写作策略：每批次处理一个决策域，列出方案、优劣、盲点和待决定项

---

## 当前状态基线

审计 §4.14 识别出的缺口清单：

| # | 缺口 | 严重度 | 阻塞性 |
|---|------|--------|--------|
| 1 | 无 Dockerfile / 容器化构建 | 高 | 阻塞 — 无法在任何非开发机上运行 |
| 2 | 无生产环境配置管理（无 production.yaml、无 NODE_ENV 区分） | 高 | 阻塞 — 密钥、数据库 URL、AI API key 全部硬编码或依赖本地 .env |
| 3 | 数据备份/恢复无自动化 | 高 | 半阻塞 — 可手动运行但生产不可接受 |
| 4 | 无外部监控集成（Prometheus/Grafana） | 中 | 非阻塞 — 可先上线后补齐 |
| 5 | 日志格式默认为 text（已支持 JSON 但未设为生产默认） | 中 | 非阻塞 — `LOGGING_FORMAT=json` 即可切换 |
| 6 | 健康检查仅 `/api/health`，无 readiness/liveness 区分 | 中 | 半阻塞 — 容器编排需要 |
| 7 | 无 Docker Compose / K8s manifest | 高 | 阻塞 — 多服务（server + web + N 个 Rust sidecar）需要编排 |
| 8 | 无 CI 构建/推送镜像流程 | 中 | 非阻塞 — 可手动构建 |
| 9 | 无 HTTPS/TLS 终端配置 | 高 | 阻塞 — 生产必须 |
| 10 | 无 CD/灰度发布策略 | 低 | 非阻塞 — MVP 后考虑 |

已有资产：
- `LOGGING_FORMAT=json` 环境变量切换结构化日志（`utils/logger.ts` 已实现 text/json 双模式）
- `/api/health` 端点（`system.ts:67`），返回 `startupHealthDataSchema` 验证的快照
- `/api/status` 端点（需 root operator 认证），返回 runtime status
- `system/notifications` API（需 root），应用内通知机制
- `prisma migrate` 通过 `pnpm prepare:runtime` 执行
- GitHub Actions CI（`server-tests.yml`、`server-smoke.yml`）
- Rust sidecar 通过 stdio JSON-RPC 与 Node 宿主通信（已加固：`StdioJsonRpcTransport` 共享基类 + 心跳 + 自动重连）

---

## 批次 1：容器化策略与环境配置

### 1.1 核心问题

项目是一个 pnpm monorepo，包含：
- **Node.js 服务**：`apps/server`（Express + Prisma，编译到 `dist/`）
- **Nuxt 前端**：`apps/web`（CSR-only，`ssr: false`，纯静态输出）
- **3 个 Rust sidecar 二进制**：`apps/server/rust/world_engine_sidecar`、`scheduler_decision_sidecar`、`memory_trigger_sidecar`
- **共享包**：`packages/contracts`（无构建步骤，直接导出 `.ts`）

**待解决的根本问题**：上述组件是以单容器运行还是拆分为多容器？如何打包 Rust 二进制？

---

### 1.2 方案 A：单容器（fat image）

将所有组件打包到一个 Docker 镜像中，通过内部进程管理（或简单的 `&` + `wait`）启动 server + N 个 sidecar。

**Dockerfile 结构（示意）**：
```dockerfile
# Stage 1: Rust 构建
FROM rust:1.85-bookworm AS rust-builder
WORKDIR /build/rust
COPY apps/server/rust/ .
RUN cargo build --release -p world_engine_sidecar \
    && cargo build --release -p scheduler_decision_sidecar \
    && cargo build --release -p memory_trigger_sidecar

# Stage 2: Node 构建
FROM node:22-bookworm AS node-builder
WORKDIR /build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/ packages/contracts/
COPY apps/server/ apps/server/
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter yidhras-server build   # tsc → dist/
COPY apps/web/ apps/web/
RUN pnpm --filter yidhras-web generate    # nuxt generate → static

# Stage 3: 运行
FROM node:22-bookworm-slim
COPY --from=rust-builder /build/rust/target/release/*_sidecar /usr/local/bin/
COPY --from=node-builder /build/apps/server/dist/ /app/server/dist/
COPY --from=node-builder /build/apps/server/prisma/ /app/server/prisma/
COPY --from=node-builder /build/apps/server/node_modules/ /app/server/node_modules/
COPY --from=node-builder /build/apps/web/.output/public/ /app/web/static/
COPY --from=node-builder /build/packages/ /app/packages/
EXPOSE 3001
CMD ["node", "/app/server/dist/index.js"]
```

**Sidecar 启动**：Node 进程在 `index.ts` 中通过 `child_process.spawn()` 启动 Rust sidecar。单容器方案下无需改变此模式。

**前端静态文件**：由 Express 直接 serve（当前已有 `plugin_runtime_web.ts` 处理同源 asset 路由），或额外运行一个轻量的 static file server。

**优点**：
- 部署简单：一个镜像，一个容器，一个端口映射
- 与当前开发模式一致（server spawn sidecar），改动量最小
- 无需处理跨容器 IPC（Rust sidecar 仍然是 stdio JSON-RPC，无需改为网络协议）
- 日志聚合简单：所有组件输出到同一 stdout/stderr

**缺点**：
- 镜像体积较大（Node runtime + Rust 二进制 + Prisma + 前端静态文件）
- 无法独立扩缩容：server 和 web 耦合在一起
- Rust sidecar crash 可能导致整个容器被编排系统重启（而非仅重启 sidecar）
- 不符合"一个容器一个进程"的容器最佳实践（sidecar 是独立进程）
- 构建时间较长（Rust release build + pnpm install + Nuxt generate）

**适合场景**：MVP 阶段、单机部署、低流量、运维人力有限

---

### 1.3 方案 B：双容器（server 容器 + web 静态文件容器）

将 server + Rust sidecar 打包为一个容器，web 静态文件单独打包。

**server 容器**：同方案 A Stage 1-3，但不包含 web 静态文件。
**web 容器**：`nginx:alpine` 或 `caddy:alpine`，仅 serve 静态文件。

**优点**：
- web 和 server 可独立扩缩容（web 是无状态的，可轻松扩展）
- web 可使用 CDN 分发（静态文件天然适合边缘缓存）
- 镜像职责清晰

**缺点**：
- 需要额外的反向代理（nginx/Caddy/Traefik）做路由分发
- web 是 CSR-only，独立部署后需处理 CORS 或 API 代理
- 多了一个需要维护的镜像
- Rust sidecar 仍与 server 耦合在同一容器中

**适合场景**：web 访问量大、希望静态资源走 CDN、有现成反向代理基础设施

---

### 1.4 方案 C：完全拆分（server 容器 + web 容器 + sidecar 容器 × 3）

将每个组件独立打包为容器，sidecar 通过 TCP/Unix socket 与 server 通信。

**这要求**：将当前的 stdio JSON-RPC 替换为网络协议（TCP loopback 或 Unix domain socket）。`StdioJsonRpcTransport` 已有共享基类，增加一个 `TcpJsonRpcTransport` 或 `UnixSocketJsonRpcTransport` 实现即可。

**优点**：
- 完全符合微服务/容器最佳实践
- 每个组件可独立扩缩容和重启
- 资源隔离最好

**缺点**：
- **改动量巨大**：需要实现新的 transport 层、服务发现（哪个 sidecar 在哪个端口？）、sidecar 生命周期管理（谁负责启动/停止 sidecar 容器？）
- 运维复杂度爆炸：5 个容器 × N 个 pack = 巨大的编排负担
- 容器间网络延迟（即使是 loopback）高于 stdio
- **在当前阶段（概念验证 → MVP）严重过度设计**

**适合场景**：大规模分布式部署、Kubernetes 原生部署、sidecar 需要独立扩缩容

---

### 1.5 盲点与疑问

1. **Rust 构建在 CI 中还是本地？** 当前 CI（`server-tests.yml`、`server-smoke.yml`）未包含 Rust 编译步骤。如果在 CI 中构建 Docker 镜像，需要 GitHub Actions 有 Rust toolchain。`cargo build --release` 可能需要 5-15 分钟（取决于缓存）。**疑问**：是否有 nightly/release Rust 工具链的版本锁定需求？

2. **前端构建产物放在哪里？** 方案 A 将 web 静态文件放在 server 容器中由 Express serve。当前代码中已有 `plugin_runtime_web.ts` 处理同源 asset 路由，但**这个模块是否支持 serve 整个前端应用（SPA fallback、路由重写等）？** 需要验证。

3. **Prisma migration 在容器启动时自动运行？** `pnpm prepare:runtime` 在开发环境中执行 migrate + init + seed。生产环境中是否应该在 entrypoint 脚本中自动运行 `prisma migrate deploy`？如果多个副本同时启动，migrate 的并发安全性如何？（Prisma 有 migration lock 机制，需要验证。）

4. **Node.js 的 `spawn()` 在 Docker 中的注意事项**：`child_process.spawn()` 在 Docker 中需要正确的 PID 1 处理。Node 进程作为 PID 1 时，不会自动收割僵尸进程。如果 Rust sidecar 退出，Node 需要正确地 `wait()` 或监听 `exit` 事件。当前代码已在 `StdioJsonRpcTransport` 中处理了重连逻辑，但**容器的 init 进程（tini/dumb-init）是否是必须的？**

5. **数据卷挂载**：`data/` 目录包含 SQLite 数据库、world pack 运行时数据、配置覆盖文件。在容器化部署中，这个目录必须挂载为持久卷。**疑问**：`data/configw/local.yaml` 和 `data/configw/default.yaml` 的加载顺序在容器中是否正常工作？Config 加载逻辑是否依赖相对路径？

---

### 1.6 环境配置：12-Factor App 合规性

**当前状态**：
- `.env` 文件：`DATABASE_URL` 和 `PRISMA_DB_PROVIDER` 两个变量
- 无 `.env.example`、无 `.env.production`、无 `NODE_ENV` 区分
- Config 系统是 YAML 分层的：内置默认 → `data/configw/default.yaml` → `data/configw/local.yaml`
- AI model registry：`apps/server/config/ai_models.yaml`（可能作为文件挂载或打包进镜像）

**需要环境变量化的项目**（初步清单）：

| 配置项 | 当前来源 | 需改为 |
|--------|---------|--------|
| `DATABASE_URL` | `.env` | 环境变量 |
| `PRISMA_DB_PROVIDER` | `.env` | 环境变量 |
| `OPENAI_API_KEY` | 推测 env | 环境变量（已有 `shared.ts` 的 `getEnv` 读取） |
| `ANTHROPIC_API_KEY` | env | 环境变量 |
| `DEEPSEEK_API_KEY` | env | 环境变量 |
| `OLLAMA_BASE_URL` | 代码默认值 `localhost:11434` | 环境变量可覆盖 |
| `LOGGING_LEVEL` | env | 环境变量（已有） |
| `LOGGING_FORMAT` | env | 环境变量（已有） |
| `NODE_ENV` | 不存在 | 环境变量 |
| `PORT` | 代码默认 3001 | 环境变量 |
| `WEB_PORT` / `WEB_STATIC_DIR` | 不存在 | 视方案而定 |
| `SIDECAR_BINARY_DIR` | 代码默认 `rust/.../target/release/` | 环境变量或构建时确定 |
| `SCHEDULER_WORKER_ID` | 已有 env 读取 | 保持 |
| AI API keys（多 provider） | 各 adapter 的 `getEnv()` | 保持 |

**方案选择**：

- **A) 纯环境变量**：所有配置通过环境变量注入，YAML config 仅保留 schema 默认值。符合 12-factor，K8s/Compose 友好。但 YAML config 系统的分层覆盖能力会浪费。
- **B) 环境变量 + YAML 分层**：环境变量仅用于注入密钥和服务发现（DB URL、API keys、端口），业务逻辑配置（sim speed、tick interval、workflow profiles）保留在 YAML 中。需要在 `runtime_config.ts` 中实现环境变量覆盖 YAML 值的逻辑。
- **C) 单文件配置挂载**：通过 ConfigMap/volume 挂载完整的 `production.yaml`，覆盖所有默认值。密钥仍通过环境变量注入。最接近当前架构，改动最小。

**建议（待决定）**：方案 B。环境变量处理密钥和服务发现，YAML 处理业务配置，`runtime_config.ts` 增加 `env` override 层。

---

### 1.7 本批次的待决定项

- [ ] **容器方案**：A（单容器）/ B（双容器）/ C（完全拆分）？MVP 阶段强烈倾向于 A
- [ ] **Rust 二进制构建位置**：CI 中构建 or 本地预编译 + 提交二进制？
- [ ] **Prisma migration 策略**：容器启动时自动运行 or 手动/CI 触发？
- [ ] **是否需要 init 进程**（tini/dumb-init）？
- [ ] **环境配置策略**：方案 A / B / C？
- [ ] **前端静态文件 serve 方式**：Express serve or 独立 web server？

---

> 批次 1 结束。批次 2 将覆盖：数据库策略（SQLite vs PostgreSQL、备份/恢复、迁移路径）、多服务编排（Compose / 最小化 K8s）。

---

## 批次 2：数据库策略与多服务编排

### 2.1 核心矛盾

Yidhras 的数据库架构存在一个**根本性的两难**：

- **SQLite**：开发友好、零配置、快照功能可用（`copyFileSync` 直接复制 `runtime.sqlite`）、单文件便于备份。但并发写入能力有限（WAL 模式下读写可并发，但写写仍串行），不支持多副本部署。
- **PostgreSQL**：生产级并发、多副本可共享同一 DB、成熟的备份/恢复生态（`pg_dump`、WAL archiving、PITR）。但**快照功能明确不可用**（`pack_snapshots.ts` 返回错误信息："快照功能仅支持 SQLite 后端"）。

**当前快照逻辑**（`snapshot_capture.ts`）直接通过 `copyFileSync` 复制原始 SQLite 文件，绕过 `PackStorageAdapter` 抽象层。切换到 PostgreSQL 后，这个功能会返回 500 错误，建议用户使用 `pg_dump`。

**疑问**：快照功能在生产环境中的重要性如何？如果快照只是调试/回放工具（而非生产必需的备份机制），那么 PostgreSQL 不支持快照可能可以接受。如果快照是核心功能（世界状态回滚、调试 narrative 分叉），那么锁定 SQLite 就是一个**硬约束**。

---

### 2.2 方案 A：坚持 SQLite + 单副本部署

接受"单机单副本"的架构限制，用 SQLite 的简单性换取运维的简单性。

**数据备份策略**：
- 定时复制 `data/` 目录到外部存储（`rclone` / `s3cmd` / `rsync`）
- SQLite `.dump` 逻辑备份（`sqlite3 data/yidhras.sqlite .dump > backup.sql`）
- Litestream 流式复制（SQLite → S3/GCS，实时 WAL 复制，支持 point-in-time recovery）

**Litestream** 特别值得评估：它在 SQLite 进程外运行，持续将 WAL 变更流式复制到对象存储。如果主 SQLite 文件损坏或丢失，可以从对象存储恢复。对于单机部署来说，这是 SQLite 生产可用的关键支撑。

**优点**：
- 快照功能保持可用
- 部署复杂度最低（无需管理额外数据库服务）
- 备份简单（单文件）
- Litestream 提供灾难恢复能力

**缺点**：
- **无法水平扩展**：多个 server 副本不能共享同一个 SQLite 文件（文件锁冲突）
- 写并发上限受 SQLite 限制（单写者，WAL 模式下约 100-500 writes/s）
- 如果 server 进程 crash 且数据文件损坏，恢复依赖 Litestream/备份
- "单副本"意味着**零停机部署几乎不可能**（需要先停旧实例，再启新实例）

**适合场景**：MVP/原型阶段、单机部署、低并发、快照功能被视为核心需求

---

### 2.3 方案 B：PostgreSQL + 放弃快照

切换到 PostgreSQL，接受快照功能不可用，获得多副本部署能力。

**需要处理的问题**：
1. Prisma schema 的 PG 版本已有（`schema.pg.prisma`，648 行），与 SQLite 版本结构一致
2. `PRISMA_DB_PROVIDER=postgresql` + `DATABASE_URL=postgresql://...`
3. `PackStorageAdapter` 的 PostgreSQL 实现使用 "schema-per-pack"（`PostgresPackStorageAdapter.ts`），这在托管 PostgreSQL 中可能需要超级用户权限（创建 schema）
4. Schema-per-pack 意味着每个 world pack 在 PostgreSQL 中有独立的 schema namespace。这是否与 AWS RDS / Google Cloud SQL 的权限模型兼容？**需要实际测试**

**备份策略**：
- `pg_dump` 逻辑备份（定时 cron）
- WAL archiving + PITR（PostgreSQL 原生支持）
- 托管数据库的自动备份（RDS snapshot、Cloud SQL backup）

**优点**：
- 真正的多副本部署（HA）
- 成熟的备份/恢复生态
- 更好的并发性能
- 零停机部署成为可能（rolling update）

**缺点**：
- **快照功能不可用**（API 返回 500）
- 需要管理 PostgreSQL 实例（自建 or 托管）
- Schema-per-pack 权限问题待验证
- 运维复杂度显著增加
- 本地开发环境需要 PostgreSQL（或保留 SQLite 用于开发 + PostgreSQL 用于生产，但双 provider 模式增加了测试矩阵）

**适合场景**：需要多副本 HA、并发量较大、快照功能可被替代

---

### 2.4 方案 C：SQLite 为主 + PostgreSQL 作为可选升级路径

当前阶段使用 SQLite + Litestream 进行生产部署。在架构层面**保留 PostgreSQL 接口**（已有 `PackStorageAdapter` 双实现），但不作为默认生产方案。

当满足以下触发条件之一时，评估切换到 PostgreSQL：
- 需要多副本 HA
- SQLite 并发写入成为瓶颈
- 有运维团队可以管理 PostgreSQL

**这实际上是一个延期决策策略**。

**需要做的**（即使是方案 C）：
- 验证 `PostgresPackStorageAdapter` 在托管 PostgreSQL 上的可用性
- 验证 Prisma migration 在两个 provider 之间的同步性
- 为快照功能设计一个 PostgreSQL 替代方案（即使不实现，至少有一个设计文档）

**关于快照的 PostgreSQL 替代方案**（仅为设计层面的讨论，不要求立即实现）：
- **方案 C1**：使用 `PackStorageAdapter.exportPackData()` 导出 pack 数据为 JSON/JSONL，作为逻辑快照。不是文件级快照，但保留了状态完整性。
- **方案 C2**：在 PostgreSQL 中使用 `pg_dump --schema=<pack_id>` 导出单个 pack schema，作为 pack 级别的逻辑快照。
- **方案 C3**：承认快照功能在 PostgreSQL 中不适用，该功能降级为 SQLite-only 调试工具，生产备份由 PostgreSQL 原生机制承担。

**盲点**：当前 `PostgresPackStorageAdapter` 是**否真的被测试过？** 代码存在（推断 ~600+ 行），但测试覆盖率和实际运行状态未知。CI 中只有 SQLite 配置。如果在生产环境中首次使用 PostgreSQL，可能遇到意料之外的兼容性问题。

---

### 2.5 多服务编排

无论选择哪种数据库方案，部署都需要协调至少以下进程：
1. Node.js server（Express，端口 3001）
2. 最多 3 个 Rust sidecar 进程（由 Node spawn，非独立容器）

如果前端不是由 Express serve，还需要：
3. Web 静态文件 server（nginx/Caddy，端口 3000）

#### 2.5.1 Docker Compose（开发/单机生产）

```yaml
# docker-compose.yml（示意）
services:
  server:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/data/yidhras.sqlite
      - PRISMA_DB_PROVIDER=sqlite
      - LOGGING_FORMAT=json
      - LOGGING_LEVEL=info
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - yidhras_data:/data
      - ./config/production.yaml:/app/config/production.yaml:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    # 如果前端由 Express serve，web 容器可以省略

  # 可选：如果拆分出 web 容器
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    ports:
      - "3000:80"
    depends_on:
      - server
    restart: unless-stopped

  # 可选：Litestream sidecar（SQLite 备份）
  litestream:
    image: litestream/litestream
    volumes:
      - yidhras_data:/data
      - ./litestream.yml:/etc/litestream.yml:ro
    command: replicate
    restart: unless-stopped

volumes:
  yidhras_data:
```

**关键盲点**：
- `DATABASE_URL=file:/data/yidhras.sqlite` 中的**绝对路径 `/data/`** 与开发环境的**相对路径 `file:../../../data/yidhras.sqlite`** 不同。Prisma 的 migration 命令需要在正确的 `DATABASE_URL` 下执行。
- Compose 的 `restart: unless-stopped` 不能替代 crash 恢复逻辑。Node server 内部的 Rust sidecar 重连机制（已有）处理 sidecar crash，Compose 处理 Node 进程 crash。
- Litestream sidecar 需要在 Node 进程启动**之前**先恢复数据库（如果数据卷是空的），或者在启动时检查是否需要恢复。

#### 2.5.2 最小化 Kubernetes（仅当需要多副本时）

如果选择了方案 B（PostgreSQL），多副本部署才具有实际意义。最小化 K8s 部署包括：

- **Deployment**：`yidhras-server`，replicas: 2-3
- **Service**：ClusterIP，端口 3001
- **Ingress**：TLS 终端 + 路由（`/api/*` → server，`/*` → web 或 CDN）
- **PersistentVolumeClaim**：如果用 SQLite，只能用 ReadWriteOnce（单副本）
- **ConfigMap**：`production.yaml`、`ai_models.yaml`
- **Secret**：API keys、DB passwords

**但这引入了一系列尚未解决的问题**：
- Rust sidecar 在 K8s 中的管理（由 Node spawn？还是作为 sidecar container？）
- 健康检查需要区分 readiness（是否准备好接受请求）和 liveness（是否需要重启）
- 滚动更新时，旧 Pod 的 graceful shutdown（SIGTERM → 停止接受新请求 → 完成 in-flight 请求 → 退出 → sidecar 清理）
- 日志收集（stdout → Fluentd/Vector → centralized logging）

**对于一个当前处于概念验证阶段的项目，K8s 部署可能是过度工程化。** Compose 单机部署覆盖了"可运行"的需求，K8s 在需要扩缩容时再评估。

---

### 2.6 本批次的待决定项

- [ ] **数据库选择**：A（SQLite + 单副本）/ B（PostgreSQL + 放弃快照）/ C（SQLite 为主，PG 延期）？
- [ ] **Litestream 是否引入**（如果选 SQLite）？
- [ ] **快照功能的生产定位**：核心功能 or 调试工具？这直接影响数据库方案选择
- [ ] **PostgresPackStorageAdapter 的测试状态**：是否需要先验证其在托管 PG 上的可用性？
- [ ] **编排方案**：Compose（单机）or 直接 K8s？当前阶段强烈倾向于 Compose
- [ ] **前端 serve 方式**：由 Express serve（简化部署）or 独立 web server（nginx）？

---

> 批次 2 结束。批次 3 将覆盖：监控与可观测性（Prometheus metrics、健康检查分级、结构化日志生产配置）、安全加固（helmet、rate limit、TLS 终端、secret 管理）。

---

## 批次 3：监控、可观测性与安全加固

### 3.1 当前可观测性资产

| 组件 | 状态 | 位置 |
|------|------|------|
| `/api/health` | 已实现 | `system.ts:67`，返回 `startupHealthDataSchema` |
| `/api/status` | 已实现（需 root） | `system.ts:49`，返回 `runtimeStatusDataSchema` |
| `/api/system/notifications` | 已实现（需 root） | `system.ts:29` |
| Scheduler observability | 已实现 | `scheduler_observability.ts`，~1,200 行 |
| Aggregated metrics | **Stubbed** | `scheduler_observability.ts:1213`："Stubbed — will be wired to a real metrics backend later" |
| 日志 | text/json 双模式（`LOGGING_FORMAT=json`） | `utils/logger.ts` |
| Pack runtime health | 已实现 | `pack_runtime_instance.ts`，per-pack health snapshot |
| Request ID | `logger.ts` 支持 | 通过 `setLoggerRequestIdProvider()` 注入 |

**关键发现**：`scheduler_observability.ts` 中已有 `emitAggregatedMetrics()` stub，明确标注 "Phase 3 stub — Future: push to metrics collector / time-series DB"。这意味着**metrics 发射点已在代码中预留，只需要实现 push 逻辑**。

---

### 3.2 健康检查分级

当前 `/api/health` 的设计：

```typescript
// contracts/src/system.ts
startupHealthDataSchema = z.object({
  healthy: z.boolean(),
  level: z.enum(['ok', 'degraded', 'fail']),
  runtime_ready: z.boolean(),
  checks: z.object({
    db: z.boolean(),
    world_pack_dir: z.boolean(),
    world_pack_available: z.boolean()
  }),
  available_world_packs: z.array(z.string()),
  errors: z.array(z.string())
})
```

**现有设计的问题**：
1. `runtime_ready` 是启动时快照（`getStartupHealthSnapshot`），不反映运行时健康变化。如果启动后 DB 连接断开，health 不会更新。
2. 没有 readiness/liveness 区分。K8s 需要 liveness probe（"是否需要重启"）和 readiness probe（"是否准备好接受请求"）分别判断。
3. checks 只有 3 个组件，缺少 sidecar 连接状态、AI provider 可达性、内存/CPU 压力等。

#### 方案 A：最小增强（不改 API 契约）

- `/api/health` 保持现有契约，作为综合健康检查（K8s 中同时用于 readiness 和 liveness）
- 在 `level === 'fail'` 时返回 503（**当前已实现**），K8s liveness probe 依赖此状态码
- 将 `startupHealth` 改为动态计算（每次请求时重新检查，而非返回缓存的启动快照）

**优点**：改动最小，API 契约不变
**缺点**：无法区分"暂时不可用"和"需要重启"，可能导致不必要的 Pod 重启

#### 方案 B：标准 K8s 双探针

新增两个端点（或在同一端点通过 query param 区分）：

- `GET /api/health?probe=readiness`：检查是否准备好接受请求。检查项：DB 连接正常、至少一个 pack 已加载、AI provider 可用（可选）。不可用时返回 503，K8s 从 Service 中摘除但不重启。
- `GET /api/health?probe=liveness`：检查是否需要重启。检查项：event loop 未阻塞（简单计时器）、进程内存未接近上限。不可用时返回 500，K8s 重启 Pod。

**对于当前阶段**：K8s 部署不是立即需求，这个区分的重要性不高。但如果要在 Compose 中使用 `healthcheck`，Compose 只有一个 healthcheck 命令，较难区分 readiness/liveness。**坚持方案 A 即可。**

**盲点**：`startupHealth` 在 `AppContext` 中是一个静态快照还是在每次请求时重新计算？当前代码（`system.ts:68`）调用 `getStartupHealthSnapshot(context)`。如果这个函数返回的是缓存的启动时状态，那么**运行时 DB 故障不会被 health endpoint 反映**。这是一个需要验证的问题。

---

### 3.3 Prometheus / Grafana 集成

#### 方案 A：prom-client（Node.js 原生）

在 Express 中集成 `prom-client` 库：
- 暴露 `GET /metrics` 端点（标准 Prometheus scrape 端点）
- 内置 metrics：HTTP 请求延迟 histogram、请求数 counter、错误率、event loop lag
- 自定义 metrics：active agents gauge、decision job queue length、AI API call latency、tool call 成功率、scheduler tick duration、sidecar 连接状态

**优点**：
- Node.js 生态标准方案
- 代码集成简单
- Prometheus + Grafana 是行业标准组合

**缺点**：
- 需要部署 Prometheus server（额外的基础设施）
- Prometheus 的 pull 模型需要 server 端口对 Prometheus 可达
- Metric 类型定义和 label 设计需要仔细规划（label cardinality 爆炸是常见陷阱）

#### 方案 B：OpenTelemetry（OTEL）SDK

通过 `@opentelemetry/sdk-node` 实现 traces + metrics + logs 的统一导出：
- Traces：HTTP 请求 → AI API call → tool call → DB query 的完整调用链
- Metrics：通过 OTLP 导出到 Prometheus / Grafana Cloud / Datadog / New Relic
- Logs：结构化日志与 trace 关联（通过 `trace_id` 字段）

**优点**：
- 供应商中立，不锁定特定后端
- Traces + metrics + logs 统一 SDK
- AI Gateway 的调用链特别适合 trace（`task_service → route_resolver → gateway → adapter → elasticity`）

**缺点**：
- OTEL SDK 相对较重
- 学习曲线较陡
- 对于当前项目规模可能过度工程化
- 需要 OTEL Collector 或直接导出到后端

#### 方案 C：结构化日志 + 外部解析（最轻量）

不引入 metrics SDK，依赖结构化日志（`LOGGING_FORMAT=json`）+ 日志聚合器（Loki/Grafana/ELK）：
- 在日志中嵌入 `metric` 字段（如 `{"metric": "ai_call_duration_ms", "value": 1200}`）
- 日志聚合器（如 Grafana Loki + LogQL）从日志中提取 metrics
- 不需要 `/metrics` 端点，不需要 Prometheus server

**优点**：
- 实现最简单（logger 已支持 JSON，只需约定 metric 字段格式）
- 不需要额外的基础设施变更
- 日志天然包含上下文（trace_id、agent_id、pack_id），便于关联分析

**缺点**：
- 日志的 metrics 查询效率和精度不如 Prometheus
- 不适合高频 metrics（如 per-request latency histogram）——日志量会爆炸
- 对于 AI API 调用这类低频（每 tick 一次）的 metrics，日志方式可接受；对于 HTTP server 的 per-request metrics，日志方式不太合适

**建议**：**当前阶段方案 C + 预留方案 A 的接入点**。`scheduler_observability.ts` 的 `emitAggregatedMetrics()` stub 已经预留了接入点。先在日志中嵌入关键 metrics（AI call duration、scheduler tick duration、error rate），当需要更精细的监控时再引入 `prom-client`。

---

### 3.4 安全加固

审计 §4.14 指出安全中间件几乎为零。`create_app.ts` 仅 36 行，只有 `cors()`。

#### 3.4.1 HTTP 安全头（helmet）

`helmet` 是 Express 的标准安全中间件，设置各种 HTTP 头：
- `Content-Security-Policy`：限制脚本/样式来源
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`（HSTS）
- `X-XSS-Protection`

**引入风险**：
- CSP 可能阻止前端插件的动态 import（plugin web bundle 通过动态 import 加载）。如果设置 `script-src 'self'`，插件的 web bundle 可能被阻止。
- CSP 可能阻止 AI Gateway 对 OpenAI/Anthropic API 的请求（但这只是后端调用，CSP 只影响浏览器，不影响 Node 的 `fetch`）。

**建议**：添加 `helmet()` 作为默认中间件，CSP 初始使用较宽松的策略（如 `default-src 'self'; script-src 'self' 'unsafe-inline';`），后续根据实际需求收紧。

#### 3.4.2 频率限制（express-rate-limit）

**必须引入**。当前系统没有任何频率限制，API 端点完全暴露。攻击者可以：
- 暴力破解 operator 认证（如果有的话）
- 通过高频请求耗尽 AI API 配额
- 对 `/api/health` 等端点发动 DDoS

**方案**：
- 全局 rate limit：100 requests/min/IP（基本防护）
- 认证端点（`/api/auth/*`）更严格：10 requests/min/IP
- AI 推理相关端点：由 AI Gateway 的 `rate_limiter.ts` 控制（已有，但仅针对 provider API 调用，不针对 HTTP 入口）

**盲点**：`express-rate-limit` 默认使用内存存储。多副本部署时，rate limit 状态不在副本间共享。对于单机部署（方案 A），这不是问题；对于多副本部署，需要使用 Redis 等共享存储。

#### 3.4.3 TLS 终端

生产环境必须使用 HTTPS。有两种模式：

- **方案 A（推荐）**：反向代理（Nginx/Caddy/Traefik）处理 TLS 终端，后端 server 仅暴露 HTTP（`localhost:3001`）。Caddy 可以自动申请 Let's Encrypt 证书。
- **方案 B**：Node 进程直接处理 TLS（`https.createServer`），管理证书文件。

**方案 A 是标准做法**。方案 B 增加了 Node 进程的复杂度（证书更新、密钥文件权限）。

对于 Compose 部署：添加一个 Caddy 容器作为反向代理。
对于 K8s 部署：cert-manager + Ingress。

#### 3.4.4 Secret 管理

**当前状态**：API keys 通过环境变量传入（`shared.ts` 的 `getEnv()` 函数）。这是基本安全的（环境变量不提交到 git），但存在以下风险：
- `.env` 文件可能被误提交（当前 `.env` 中只有 DATABASE_URL，但用户可能添加 API keys）
- 日志中可能意外输出 API key（`diag_cli.ts` 已经对 DATABASE_URL 做了脱敏，但 AI adapter 的请求日志可能包含 key）

**方案**：
1. 确保 `.env` 已在 `.gitignore` 中（**需验证**）
2. 创建 `.env.example` 模板文件，不含实际密钥
3. 在 AI adapter 的日志中对 API key 做脱敏（当前 `diag_cli.ts` 已有 DATABASE_URL 脱敏模式，可复用）
4. 生产环境中通过 Docker secret / K8s Secret / 环境变量注入（不写入文件）

#### 3.4.5 CSRF 保护

**对于纯 API server + CSR 前端**：CSRF 通常不是主要威胁向量，因为：
- API 使用 JSON 请求体（非 form-encoded），浏览器不会在简单请求中自动附加 cookies
- 前端是 CSR-only（`ssr: false`），由 JS 发起 API 请求

**但是**：如果启用了 cookie-based session（当前代码中 `operator/auth` 模块可能使用 session），CSRF 仍然是一个理论风险。**需要验证认证机制是 token-based 还是 cookie-based。** 如果是 token-based（如 Authorization header），CSRF 不适用；如果是 cookie-based，需要添加 CSRF token 或 SameSite cookie 属性。

**疑问（需要验证）**：当前 operator 认证是通过什么机制维持 session 的？JWT token in Authorization header？还是 express-session cookie？

#### 3.4.6 请求体大小限制

**必须引入**。Express 默认没有请求体大小限制（或限制很大），攻击者可以发送超大 JSON payload 耗尽服务器内存。

```typescript
app.use(express.json({ limit: '1mb' }));
```

1MB 对于正常 API 请求是足够的（prompt 文本、event payload）。如果需要上传文件（world pack archive），可以在特定端点设置更大的 limit。

---

### 3.5 本批次的待决定项

- [ ] **健康检查**：方案 A（保持现有 /api/health）or 方案 B（readiness/liveness 双探针）？
- [ ] **验证 startupHealth 是动态还是静态**：`getStartupHealthSnapshot` 是否每次都重新检查 DB 连接？
- [ ] **Metrics 策略**：方案 C（日志嵌入 metrics）+ 预留方案 A（prom-client）接入点？
- [ ] **TLS 终端**：Caddy or Nginx？
- [ ] **认证机制验证**：当前 operator session 是 token-based 还是 cookie-based？这决定了 CSRF 策略
- [ ] **`.gitignore` 验证**：`.env` 是否已在 gitignore 中？
- [ ] **helmet CSP 策略**：初始宽松（允许插件动态 import）→ 后续收紧？

---

> 批次 3 结束。批次 4 将覆盖：CI/CD 流水线（构建/测试/推送镜像）、graceful shutdown、数据备份自动化、Rust sidecar 构建与分发。

---

## 批次 4：CI/CD、优雅关闭、备份自动化、Sidecar 分发

### 4.1 当前 CI 状态

**已有**：两个 GitHub Actions workflow
- `server-tests.yml`：在 PR/push to main 时运行 `test:integration`（串行），触发条件：`apps/server/**`、`packages/contracts/**` 变更
- `server-smoke.yml`：同样触发条件，运行 `prepare:runtime` + e2e smoke tests

**缺失**：
- 无 Docker 镜像构建/推送
- 无 Rust 编译步骤
- `test:e2e` 不在 CI 中运行（明确设计：本地/手动验证）
- 无前端构建验证
- 无 `typecheck` 在 CI 中的运行（可能已包含在 test 流程中？需验证）

---

### 4.2 CI/CD 流水线设计

#### 阶段划分

```
PR / push to main
  │
  ├─► Lint & Typecheck (并行)
  │     ├─ pnpm lint
  │     └─ pnpm typecheck
  │
  ├─► Test (lint/typecheck 通过后)
  │     ├─ pnpm test:unit          (并行)
  │     └─ pnpm test:integration   (串行)
  │
  ├─► Build (test 通过后，仅 main 分支)
  │     ├─ Rust release build      (缓存 target/)
  │     ├─ Server tsc build
  │     ├─ Web nuxt generate
  │     └─ Docker image build
  │
  └─► Push (仅 main 分支 tag)
        ├─ Docker image → GHCR / Docker Hub
        └─ (可选) 部署到 staging
```

#### Rust 编译在 CI 中

**关键问题**：`cargo build --release` 耗时 5-15 分钟，即使有缓存。

**方案**：
- GitHub Actions `rust-cache` action 缓存 `target/` 目录
- 仅在 `apps/server/rust/**` 路径变更时编译（条件执行）
- 日常 PR 可以不编译 Rust（多数 PR 不涉及 Rust 代码），在合并到 main 时统一编译

**盲点**：当前 Rust sidecar 的三个二进制文件（`world_engine_sidecar`、`scheduler_decision_sidecar`、`memory_trigger_sidecar`）是否有**独立的版本号**？CI 构建的镜像如何标记版本（git SHA？git tag？）？如果没有版本号，生产环境中如何确定运行的 sidecar 版本？

#### 镜像构建策略

**如果选择方案 A（单容器）**：
- 一个 `Dockerfile`，多阶段构建
- 镜像 tag：`ghcr.io/yidhras/server:<git-sha>` + `ghcr.io/yidhras/server:latest`
- 构建时间：Rust release（5-15 min）+ pnpm install（2-5 min）+ tsc build（30s）+ nuxt generate（1-2 min）= **约 10-25 分钟**

**如果选择方案 B（双容器）**：
- `Dockerfile.server`：Rust + Node + Prisma
- `Dockerfile.web`：Node build + nginx
- 两个镜像可以并行构建

---

### 4.3 优雅关闭评估

当前 `index.ts:511-548` 已实现优雅关闭：

```
收到 SIGTERM/SIGINT
  ├─ 10s 超时计时器
  ├─ 停止 sim timer
  ├─ 关闭 HTTP server (httpServer.close())
  ├─ 停止 world engine sidecar (stdin EOF → 自然退出 → 3s 后 SIGKILL)
  ├─ Prisma disconnect
  ├─ 关闭 registry watcher
  ├─ 关闭 config watcher
  └─ process.exit(0)
```

**评估**：当前实现覆盖了主要组件，但有几点需要注意：

1. **HTTP server.close() 不等 in-flight 请求**：`server.close()` 停止接受新连接，但不会强制关闭现有连接。需要搭配 `server.closeIdleConnections()`（Node 18.2+）或手动跟踪连接数。
2. **多 sidecar 的关闭顺序**：当前仅关闭 `worldEngine`。`scheduler_decision_sidecar` 和 `memory_trigger_sidecar` 是否也需要显式关闭？**需要验证**：代码中是否有其他 sidecar client 的 stop 方法。
3. **10s 超时是否足够**：AI API 调用可能需要 30-60 秒（特别是 tool loop 的场景）。如果正在进行的推理请求被中断，是否需要等待其完成？
4. **K8s 兼容性**：K8s 发送 SIGTERM 后默认等待 `terminationGracePeriodSeconds`（默认 30s），然后发送 SIGKILL。当前 10s 超时在 30s 内，符合要求。

**待验证**：`scheduler_decision_sidecar` 和 `memory_trigger_sidecar` 的 client 是否有 `stop()` 方法，以及当前是否在 graceful shutdown 中被调用。

---

### 4.4 数据备份自动化

#### SQLite 备份（方案 A/C）

**三层备份策略**：

| 层级 | 频率 | 工具 | 保留 |
|------|------|------|------|
| 实时 WAL 流式复制 | 实时 | Litestream → S3/GCS | 最后一个检查点 + 增量 WAL |
| 定时文件快照 | 每小时 | `sqlite3 .backup` → 本地文件 → rclone → S3 | 24 小时（滚动） |
| 每日逻辑备份 | 每天 | `sqlite3 .dump` → gzip → S3 | 30 天 |

**Litestream 配置示例**（`litestream.yml`）：
```yaml
dbs:
  - path: /data/yidhras.sqlite
    replicas:
      - type: s3
        bucket: yidhras-backup
        path: sqlite
        region: ap-southeast-1
      - type: file
        path: /data/backup/local
```

**Litestream restore**（容器启动时）：
```bash
# 如果数据文件不存在或损坏，从 S3 恢复
if [ ! -f /data/yidhras.sqlite ]; then
  litestream restore -o /data/yidhras.sqlite s3://yidhras-backup/sqlite
fi
```

#### PostgreSQL 备份（方案 B）

使用 PostgreSQL 原生工具：
- `pg_dump` 定时逻辑备份
- WAL archiving（`archive_command`）→ S3
- 如果使用托管服务（RDS/Cloud SQL），使用其自动备份功能

**盲点**：如果使用 Litestream，Litestream sidecar 需要与 server 容器共享数据卷。在 Docker Compose 中这很简单（shared volume），在 K8s 中需要注意 PVC 的 access mode（必须 ReadWriteMany 或使用 sidecar container 在同一 Pod 中）。

---

### 4.5 Rust Sidecar 构建与分发

**当前方式**：Rust 源码在 `apps/server/rust/` 中，由 Node 宿主在运行时通过 `child_process.spawn()` 启动编译好的二进制。

**问题**：Rust 二进制如何到达生产环境？

#### 方案 A：CI 中编译 + 打包进 Docker 镜像（推荐）

Dockerfile 的多阶段构建中编译 Rust，二进制直接包含在镜像中。**优点**：分发简单，版本与镜像绑定。**缺点**：构建时间长。

#### 方案 B：预编译二进制 + 版本管理

在 CI 中单独编译 Rust 二进制，上传为 GitHub Release artifact。Dockerfile 从 Release 下载预编译二进制。

**优点**：
- Docker 构建更快（不需要 Rust toolchain）
- 二进制可以独立版本管理和分发

**缺点**：
- 需要维护 Release 流程
- 多架构（amd64/arm64）需要交叉编译
- 如果 Rust 代码频繁变更，Release 管理开销大

#### 方案 C：Rust 源码打包进镜像 + 安装 Rust toolchain（最不可取）

在运行镜像中包含 Rust toolchain，启动时编译。**不推荐**：镜像体积巨大、启动极慢。

**建议**：方案 A。对于当前阶段，构建时间可接受。当构建时间成为瓶颈时再评估方案 B。

**盲点：二进制架构兼容性**
- CI runner 是 `ubuntu-latest`（x86_64/amd64）
- 如果生产环境是 ARM64（如 AWS Graviton、Apple Silicon Mac Mini server），需要交叉编译：`cargo build --release --target aarch64-unknown-linux-gnu`
- 需要决定是否需要多架构镜像（`docker buildx` multi-platform build）

---

### 4.6 `.env` 与 gitignore 验证

**已验证**：
- 根 `.gitignore` 包含 `.env`
- `apps/server/.gitignore` 包含 `.env`
- 认证机制是 JWT token-based（`Authorization: Bearer`），不是 cookie-based → **CSRF 不适用**

**Operator auth 机制**（`operator/auth/`）：
- JWT token（`jsonwebtoken` 库）
- `Authorization: Bearer <token>` header
- Token hash（SHA256）存储在数据库中进行撤销检查
- `jwt_secret` 和 `jwt_expires_in` 从 operator auth config 中读取

**这意味着**：
- 批次 3 中关于 CSRF 的疑问已解决 — 不需要 CSRF 保护
- Secret 管理的主要关注点变为：JWT secret 和 API keys 的注入方式

---

### 4.7 本批次的待决定项

- [ ] **CI 中是否编译 Rust**：每次 PR or 仅 main 分支？Rust 变更频率如何？
- [ ] **Rust 二进制版本管理**：是否有独立的 sidecar 版本号？
- [ ] **多 sidecar 关闭**：scheduler_decision 和 memory_trigger sidecar 是否有 stop() 方法？
- [ ] **多架构支持**：是否需要 ARM64 镜像？
- [ ] **备份存储**：S3/GCS/本地文件？Litestream 的 S3 bucket 是否已有？
- [ ] **httpServer.close()**：是否需要 closeIdleConnections() 以确保 in-flight 请求被等待？

---

> 批次 4 结束。批次 5 将覆盖：日志与审计生产配置、告警规则设计、灾难恢复流程、未覆盖的运维关注点（pack 导入导出、config 热更新、多环境配置管理）。

---

## 批次 5：日志、告警、灾难恢复与剩余运维关注点

### 5.1 生产日志配置

**当前实现**（`utils/logger.ts`）已经完备：
- 支持 `LOGGING_FORMAT=text|json`（环境变量）
- 支持 `LOGGING_LEVEL=debug|info|warn|error`（环境变量）
- 支持 `LOGGING_FORMAT=json` 时输出结构化 JSON（含 `ts`、`level`、`module`、`request_id`、`message`）
- 支持通过 `setLoggerRequestIdProvider()` 注入 request ID

**生产环境配置建议**：
```bash
LOGGING_FORMAT=json       # 结构化日志，便于集中化采集
LOGGING_LEVEL=info        # 生产环境不需要 debug
```

**日志采集**：
- **Docker Compose**：stdout/stderr 自动被 Docker 收集（`docker logs` / `docker compose logs`）
- **Docker + 日志驱动**：使用 `json-file` 驱动 + log rotation（`max-size: 10m, max-file: 3`）
- **集中化日志**（未来）：Docker 的 `fluentd` / `loki` 日志驱动 → Grafana Loki → Grafana Explore

**当前不需要**：引入 Winston/Pino 等日志库。`utils/logger.ts` 的轻量封装已经满足需求。唯一可能的增强是**日志采样**（高频路径的重复日志自动降频），但这在 MVP 阶段不需要。

---

### 5.2 审计日志

**当前状态**：系统有 `operator/audit` 路由（`operator_audit.ts`），推测有操作审计记录（操作员登录、pack 加载、配置变更等）。但审计日志的持久化、查询、防篡改机制需要在生产部署前验证。

**生产需求**：
- 审计事件必须写入持久化存储（当前可能已写入 Prisma）
- 审计日志需要保留策略（如 90 天）
- 关键事件（操作员创建/删除、pack 加载/卸载、权限变更）应触发告警

**盲点**：审计日志是否与业务日志（`utils/logger.ts`）分离？如果审计事件仅通过 `logger.info()` 输出，在日志聚合中可能与普通日志混淆。更好的做法是审计事件写入独立的数据库表（已有？），日志仅作为辅助输出。

---

### 5.3 告警规则设计

**核心告警维度**：

| 告警 | 条件 | 严重度 | 通知方式 |
|------|------|--------|---------|
| **服务不可用** | `/api/health` 返回非 200，持续 2 分钟 | Critical | PagerDuty / 电话 |
| **AI provider 不可用** | OpenAI + Anthropic + DeepSeek 全部熔断 | Critical | PagerDuty |
| **单一 AI provider 熔断** | 任一 provider circuit breaker open | Warning | Slack |
| **模拟循环停滞** | 连续 10 tick 无决策事件 | Warning | Slack |
| **磁盘使用率 > 85%** | `df -h /data` | Warning | Slack |
| **内存使用率 > 90%** | 进程 RSS > 阈值 | Warning | Slack |
| **Sidecar crash 连续失败** | 自动重连 3 次后仍失败 | Critical | PagerDuty |
| **数据库连接失败** | Prisma 连接错误，持续 1 分钟 | Critical | PagerDuty |
| **数据备份失败** | Litestream / pg_dump 失败，持续 2 周期 | Warning | Slack |
| **速率限制触发** | express-rate-limit 被触发（可能攻击） | Warning | Slack |

**告警实现**：
- **当前阶段（Compose 单机）**：通过 health endpoint 监控 + UptimeRobot / Better Uptime 等外部服务进行 HTTP 探测。关键进程指标通过 Docker stats 观察。
- **未来（K8s）**：Prometheus Alertmanager + Grafana Alerting。

**盲点：告警疲劳**。10 个告警规则对于一个单机部署来说可能过多。建议从 3 个核心告警开始（服务不可用、AI provider 全熔断、数据备份失败），逐步添加。

---

### 5.4 灾难恢复流程

#### SQLite + Litestream 场景（方案 A/C）

**场景 1：server 进程 crash，数据文件完整**
1. Docker restart policy 自动重启容器
2. Node 进程重新启动 → Prisma connect → pack 重新加载
3. 恢复时间：~5-10 秒

**场景 2：数据文件损坏或丢失**
1. 启动 Litestream restore：`litestream restore -o /data/yidhras.sqlite s3://bucket/sqlite`
2. 从最后一个 WAL 检查点恢复（通常丢失 < 1 秒的数据）
3. Node 进程正常启动
4. 恢复时间：取决于 S3 下载速度，通常 30 秒 - 5 分钟

**场景 3：S3 bucket 不可用 + 本地备份可用**
1. 使用本地备份文件（每小时的 `sqlite3 .backup`）
2. 手动或脚本恢复：`cp /data/backup/hourly/yidhras-$(date).sqlite /data/yidhras.sqlite`
3. 恢复时间：< 1 分钟
4. 数据丢失：最多 1 小时

**场景 4：全部备份不可用（灾难性）**
1. 没有恢复路径
2. 需要接受数据丢失
3. 至少 Prisma migration 可以从 schema 重新创建表结构
4. 世界包可以从源码重新加载（`data/world_packs/` 目录）

#### PostgreSQL 场景（方案 B）

使用托管数据库的自动备份恢复（RDS snapshot restore / Cloud SQL point-in-time recovery）。恢复时间通常 5-30 分钟。

**待验证**：Litestream 的 S3 bucket 是否已经存在？bucket 的 region、权限、版本控制、生命周期策略需要配置。

---

### 5.5 剩余运维关注点

#### 5.5.1 Pack 导入/导出

**已实现**：
- CLI 命令：`pnpm pack:export <dir> [--output <path>]` 和 `pnpm pack:import <archive>`
- `PackStorageAdapter.exportPackData()` / `importPackData()` 接口
- 导出格式：`.tar.gz` archive

**生产关注**：pack 导入/导出是否需要在前端管理界面中提供？还是仅 CLI 操作？如果是后者，生产环境中需要 exec 进入容器执行命令，不太方便。**建议**：MVP 阶段保留 CLI-only，后续通过管理 API 端点暴露（需 operator 认证）。

#### 5.5.2 配置热更新

**已实现**：`config/watcher.ts` 监听 `data/configw/conf.d/*.yaml` 文件变更，通过 `resetRuntimeConfigCache()` 重置缓存。safe 级别配置项支持热重载，非 safe 级别需重启。

**生产关注**：
- 容器化部署中，配置变更通过 volume 挂载的文件还是通过 ConfigMap 更新？
- Compose 中修改 volume 中的 YAML 文件，watcher 会检测到并自动重载（已支持）
- K8s 中 ConfigMap 更新后，需要触发 Pod 内的 watcher（如果 ConfigMap 以 symlink 方式挂载，`fs.watch` 可能检测不到变更）——**这是一个已知的 K8s 限制，需要使用 `configmap-reload` sidecar 或 Reloader operator**

#### 5.5.3 多环境配置管理

**当前状态**：YAML 配置分层（内置默认 → `default.yaml` → `local.yaml`）。生产环境需要增加 `production.yaml`。

**方案**：
```yaml
# 加载顺序（后覆盖前）
1. 内置默认值（代码中硬编码）
2. data/configw/default.yaml（git tracked）
3. data/configw/local.yaml（gitignored，本地开发）
4. data/configw/conf.d/production.yaml（挂载的 volume，生产环境）
5. 环境变量覆盖（需在 runtime_config.ts 中实现 env override）
```

**`production.yaml` 应覆盖的项**（示意）：
```yaml
simulation:
  default_tick_interval_ms: 3000  # 生产环境可适当降低频率
  max_simulation_speed: 10

ai_gateway:
  default_timeout_ms: 45000
  retry_limit: 3
  allow_fallback: true

logging:
  level: info
  format: json
```

#### 5.5.4 多世界包并发运行

**当前**：多 pack 通过 `MultiPackLoopHost` 管理，所有 pack 在同一 Node 进程中运行。

**运维关注**：
- 每个 pack 有独立的 `runtime.sqlite`（数据隔离已实现）
- 每个 pack 有独立的 Rust sidecar 进程（进程隔离已实现？**待验证**：sidecar 是 per-pack 还是全局共享？）
- 10 个 pack 并发运行时，Node 进程和 Rust sidecar 的内存/CPU 压力尚未基准测试
- 如果一个 pack 的推理失败（如 AI API 返回错误），是否会影响其他 pack？

#### 5.5.5 TLS 证书管理

**Compose 部署**：使用 Caddy 作为反向代理，自动申请 Let's Encrypt 证书。Caddy 配置示例：
```caddyfile
yidhras.example.com {
    reverse_proxy server:3001
    encode gzip
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
    }
}
```

**需要**：一个公网可访问的域名（用于 Let's Encrypt 验证）。如果只是内网部署，可使用自签名证书或内部 CA。

---

### 5.6 最终待决定项汇总

以下为全部 5 个批次中积累的所有待决定项，按优先级排列：

#### P0（阻塞部署）
- [ ] **容器方案**：单容器（A）/ 双容器（B）/ 完全拆分（C）？
- [ ] **数据库选择**：SQLite + Litestream（A）/ PostgreSQL + 放弃快照（B）/ SQLite 为主延期 PG（C）？
- [ ] **TLS 终端**：Caddy / Nginx / Traefik？
- [ ] **AI API keys 注入方式**：环境变量 / Docker secret / K8s Secret？

#### P1（生产加固）
- [ ] **环境配置策略**：环境变量 + YAML 分层（方案 B）or 纯环境变量（方案 A）？
- [ ] **Prisma migration 策略**：容器启动时自动运行 or 手动/CI 触发？
- [ ] **备份存储**：S3/GCS/本地文件？Litestream bucket 是否已有？
- [ ] **是否需要 init 进程**（tini/dumb-init）？
- [ ] **多架构支持**：是否需要 ARM64 镜像？
- [ ] **helmet CSP 策略**：初始宽松 → 后续收紧？

#### P2（优化）
- [ ] **CI 中 Rust 编译**：每次 PR or 仅 main 分支？
- [ ] **Metrics 策略**：日志嵌入（C）or prom-client（A）or OpenTelemetry（B）？
- [ ] **健康检查分级**：保持当前 /api/health（A）or readiness/liveness 双探针（B）？
- [ ] **前端 serve 方式**：Express serve or 独立 nginx？
- [ ] **前端部署**：CDN（静态分发）/ Docker 容器 / Vercel/Netlify？

#### 待验证问题（不阻塞，但需要澄清）
- [ ] PostgresPackStorageAdapter 在托管 PG（RDS/Cloud SQL）上的可用性
- [ ] `getStartupHealthSnapshot` 是静态快照还是动态计算？
- [ ] scheduler_decision_sidecar 和 memory_trigger_sidecar 是否有 `stop()` 方法？
- [ ] sidecar 是 per-pack 还是全局共享？
- [ ] 审计日志是否写入独立数据库表？
- [ ] Litestream S3 bucket 是否已存在？

---

> 全 5 批次草稿完成。本文档的待决定项需要逐一确认后转化为实施计划。
> 关联文档：`.limcode/design/skeptical-comprehensive-audit-report.md`（缺口来源）、`docs/ARCH.md`（架构边界）、`docs/subsystems/AI_GATEWAY.md`（AI Gateway 弹性层）。




