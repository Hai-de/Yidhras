# Yidhras (伊德海拉)

叙事引擎与 Agent 模拟器，用于构建带有情报分析、社会操控与分层世界建模感的模拟系统。

> 本文件是仓库入口页，只负责项目总览、启动方式与文档导航；详细架构、接口、业务规则、阶段状态请看对应专门文档。

## 项目定位

Yidhras 当前是一套以可运行后端基线为中心的叙事模拟工程，核心关注点包括：

- 分层世界模型（L1/L2/L3/L4）
- Agent 推理与最小工作流
- world-pack 驱动的运行时内容
- 面向前后端协作的稳定接口边界

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

## 常用命令

- 启动后端：`pnpm --filter yidhras-server dev`
- 启动前端：`pnpm --filter web dev`
- 后端 lint：`pnpm --filter yidhras-server lint`
- 前端 lint：`pnpm --filter web lint`
- 后端 typecheck：`pnpm --filter yidhras-server typecheck`
- 前端 typecheck：`pnpm --filter web typecheck`
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

## 当前状态

项目已具备可运行的后端基线、最小工作流与基础前端壳层；当前阶段状态与优先级以 `TODO.md` 为准。
