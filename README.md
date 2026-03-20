# Yidhras (伊德海拉)

叙事引擎与 Agent 模拟器。

## 核心架构
- **L1 Social:** 社交层 (Post / Noise)
- **L2 Relational:** 关系图谱 (Cytoscape.js 可视化)
- **L3 Narrative:** 叙事逻辑 (Chronos Engine / Resolver)
- **L4 Transmission:** 物理传输层 (延时 / 丢包模拟)

## 快速开始

### 1. 环境准备
- Node.js 18+
- npm 或 pnpm

### 2. 初始化项目
```bash
# 安装依赖
npm install --prefix apps/server
npm install --prefix apps/web

# 统一准备后端运行前置条件（数据库迁移 + world pack 模板）
npm run prepare:runtime --prefix apps/server
```

### 3. 运行项目
您可以使用根目录下的启动脚本：

#### Windows
```cmd
start-dev.bat
```

#### Linux / macOS
```bash
chmod +x start-dev.sh
./start-dev.sh
```

## 开发指令
- **Server:** `npm run dev` (位于 apps/server)
- **Web:** `npm run dev` (位于 apps/web)
- **Runtime Prepare:** `npm run prepare:runtime --prefix apps/server`
- **World Pack Bootstrap:** `npm run init:world-pack --prefix apps/server`

## 冒烟测试（启动流程与关键端点）
- **启动流程冒烟:** `npm run smoke:startup --prefix apps/server`
- **关键端点冒烟:** `npm run smoke:endpoints --prefix apps/server`
- **一键执行全部冒烟:** `npm run smoke --prefix apps/server`
- **可选端口覆盖:** `SMOKE_PORT=3101 npm run smoke --prefix apps/server`

## 启动与验收硬性说明
- **运行前置条件（硬性）:** 启动服务前需完成数据库迁移和 world pack 初始化，统一通过 `npm run prepare:runtime --prefix apps/server` 执行。
- **降级启动策略（硬性）:** 首次拉取项目内容可能为空，`health_level=degraded` 且 `runtime_ready=false` 视为允许启动，不作为冒烟测试失败条件。
- **关键端点一致性（硬性）:** 依赖 world-pack 的接口在运行时未就绪时统一返回 `503` + `WORLD_PACK_NOT_READY` 错误包络。
