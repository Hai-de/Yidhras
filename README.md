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
- `apps/web/README.md`：前端当前状态、Guardrails 与主文件锚点
- `.limcode/plans/frontend-operator-ui-polish-and-interaction-enhancement.plan.md`：当前 UI polish / interaction 增强冻结计划与验收标准
- `.limcode/plans/frontend-graph-deepen-and-timeline-social-mapping.plan.md`：Graph 深化与 Timeline / Social 语义映射优化收口文档

## 当前状态

- 后端基线、最小工作流、contracts/Zod 路径与统一错误包络已稳定。
- 前端 `apps/web` 已完成 Operator UI polish 第一阶段：
  - 统一页面骨架
  - 跨页来源上下文与回跳
  - Graph focus / root / result feedback
  - freshness 与轻量通知反馈
- 前端已完成一轮 Graph 深化与 Timeline / Social 语义映射优化增量：
  - quick roots、search context、inspector 分组增强
  - Timeline ↔ Social context mapping 收紧
  - 仍保持不干扰当前后端 scheduler 主线
- 当前正式里程碑状态与下一优先级以 `TODO.md` 为准。
