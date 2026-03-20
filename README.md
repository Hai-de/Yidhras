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

# 初始化数据库 (Server)
cd apps/server
npx prisma generate
npx prisma migrate dev --name init
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
