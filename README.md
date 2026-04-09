# Yidhras (伊德海拉)

Yidhras 是一个叙事模拟工程，包含运行时、world pack、Agent 推理/工作流，以及面向操作台的前端。

> 本文件只保留仓库概览、启动方式、常用命令与文档导航。更细的接口、架构和业务规则见 `docs/`。

## 仓库结构

- `apps/server`：TypeScript + Express + Prisma + SQLite 后端
- `apps/web`：Nuxt 4 + Vue 3 + Pinia 前端
- `packages/contracts`：前后端共享 transport / contract 定义
- `docs/`：接口、架构、逻辑与主题文档
- `TODO.md`：当前优先级与里程碑
- `记录.md`：验证记录与历史快照

## 环境要求

- Node.js 18+
- pnpm 10+

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备运行时

```bash
pnpm --filter yidhras-server prepare:runtime
```

该命令会完成数据库迁移、运行时初始化和 identity seed。

### 3. 启动开发环境

#### Linux / macOS

```bash
chmod +x start-dev.sh
./start-dev.sh
```

#### Windows

```cmd
start-dev.bat
```

也可以分别启动：

```bash
pnpm --filter yidhras-server dev
pnpm --filter web dev
```

### 4. 默认地址

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`

### 5. 重置本地开发数据库（可选）

```bash
pnpm --filter yidhras-server reset:dev-db
```

## 常用命令

- 工作区构建：`pnpm build`
- 工作区 lint：`pnpm lint`
- 工作区 typecheck：`pnpm typecheck`
- 工作区测试：`pnpm test`
- 工作区单测：`pnpm test:unit`
- 后端集成测试：`pnpm --filter yidhras-server test:integration`
- 后端 E2E：`pnpm --filter yidhras-server test:e2e`
- 后端冒烟：`pnpm --filter yidhras-server smoke`
- 前端单测：`pnpm --filter web test:unit`

## 文档导航

### 仓库入口

- `README.md`：项目概览、启动方式、命令入口
- `AGENTS.md`：协作约定、工程规则、开发命令
- `TODO.md`：当前优先级与里程碑
- `记录.md`：验证证据与验收记录

### 详细文档

- `docs/INDEX.md`：详细文档导航
- `docs/API.md`：当前对外接口契约与错误码
- `docs/ARCH.md`：稳定架构边界与模块职责
- `docs/LOGIC.md`：当前业务规则与领域语义
- `docs/THEME.md`：前端主题系统说明
- `docs/ENHANCEMENTS.md`：延后处理的增强项
- `apps/web/README.md`：前端应用说明与约束

## 当前范围

- 服务端包含 runtime、world pack 加载、scheduler、inference / workflow、audit 与 read-model API。
- 前端包含 overview、workflow、scheduler、graph、social、timeline、agents 页面。
- 当前优先级以 `TODO.md` 为准，验证记录见 `记录.md`。

## Current Implementation Highlight

The first Death Note-specific semantic behavior loop is now implemented on the server side.

Current status includes:

- `world-death-note` pack expanded with thematic capabilities, state, invocation grounding rules and objective enforcement
- server-side Intent Grounder inserted between provider decision and final `ActionIntentDraft`
- active-pack `rules.invocation` consumed at runtime
- unexpected semantic action can fall back to narrativized `history` events instead of hard failure
- scheduler follow-up can consume event metadata such as `followup_actor_ids`

This phase was completed without introducing a privileged Death Note-specific governor/admin agent and without changing the public inference strategy surface (`mock | rule_based`).
