# Yidhras (伊德海拉)

Yidhras 是以 world pack 驱动的叙事模拟项目，被设计用于模拟研究社会情报流转、散播与代理人链路。

> 本文件只保留仓库入口所需的最小信息：项目概览、启动方式、高频命令与文档导航。更具体的命令矩阵、接口契约、架构边界和专题说明请进入 `docs/`。

## 仓库结构

- `apps/server`：TypeScript + Express + Prisma + SQLite 后端
- `apps/web`：Nuxt 4 + Vue 3 + Pinia 前端
- `packages/contracts`：前后端共享 contracts / transport schema
- `docs/`：稳定参考文档、操作手册与导航
- `.limcode/`：设计、计划、评审等过程资产
- `TODO.md`：当前 backlog 与优先级

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
pnpm prepare:runtime
```

说明：
- 该命令会完成数据库迁移、运行时初始化和 identity seed。
- 如果你是部署者，想了解 `DATABASE_URL`、Prisma migration、初始化步骤、数据库文件更换和常见坑，请看：`docs/guides/DB_OPERATIONS.md`
- 如果你想调整运行端口、bootstrap、sqlite pragma、scheduler runtime / observability、prompt workflow 默认值，请看：`docs/guides/COMMANDS.md` 中的 runtime 配置说明。

### 3. 启动开发环境

直接启动整个工作区开发环境：

```bash
pnpm dev
```

#### Linux / macOS

```bash
chmod +x start-dev.sh
./start-dev.sh
```

#### Windows

```cmd
start-dev.bat
```

说明：

- `pnpm dev` 会并行启动 server + web；
- `start-dev.sh` / `start-dev.bat` 仍然保留，适合需要在启动前自动执行 `prepare:runtime`，或配合 `--reset-db` 使用的场景；
- 如果你只想单独启动某一侧，也可以分别执行：

```bash
pnpm dev:server
pnpm dev:web
```

### 4. 默认地址

- Web：`http://localhost:3000`
- Server：`http://localhost:3001`

### 5. 重置本地开发数据库（可选）

```bash
pnpm --filter yidhras-server reset:dev-db
```

## 高频命令

- 工作区构建：`pnpm build`
- 工作区开发：`pnpm dev`
- 工作区 lint：`pnpm lint`
- 工作区类型检查：`pnpm typecheck`
- 工作区完整测试：`pnpm test`
- 工作区单测：`pnpm test:unit`
- 工作区单测 watch：`pnpm test:unit:watch`
- 运行时准备：`pnpm prepare:runtime`
- 新建 world pack：`pnpm scaffold:world-pack -- --dir my_pack --name "My Pack" --author "Your Name"`
- Server 冒烟：`pnpm smoke:server`
- Runtime 配置说明：`docs/guides/COMMANDS.md`

更多命令、单测入口、Server/Web 分项命令与插件 CLI 入口，见：

- `docs/guides/COMMANDS.md`
- `docs/guides/DB_OPERATIONS.md`
- `docs/guides/PLUGIN_OPERATIONS.md`

## 文档导航

### 入口文档

- `README.md`：仓库入口、最小启动方式、高频命令
- `docs/INDEX.md`：文档总导航、文档分层、事实源规则
- `AGENTS.md`：协作规则、工程约束、文档更新原则
- `TODO.md`：当前 backlog 与优先级

### 稳定参考

- `docs/API.md`：公共接口契约与错误码
- `docs/ARCH.md`：架构边界、模块职责、宿主关系
- `docs/LOGIC.md`：业务规则、执行主线、领域语义
- `docs/WORLD_PACK.md`：world pack 项目化与发布规范
- `docs/THEME.md`：前端主题系统说明
- `docs/ENHANCEMENTS.md`：延期增强项收纳池
- `apps/web/README.md`：前端应用范围、结构与约束

### 操作手册

- `docs/guides/COMMANDS.md`：仓库、Server、Web、测试、脚手架命令
- `docs/guides/DB_OPERATIONS.md`：数据库迁移、初始化、更换与常见坑
- `docs/guides/PLUGIN_OPERATIONS.md`：pack-local plugin 的 CLI / GUI / API 操作说明

### 过程资产

- `.limcode/design/`：设计草案
- `.limcode/plans/`：执行计划
- `.limcode/review/`：评审记录与结论

## 阅读建议

如果你是：

- **第一次进入仓库**：先看本文件，再看 `docs/INDEX.md`
- **想启动项目**：看本文件的“快速开始”与 `docs/guides/COMMANDS.md`
- **想处理数据库迁移或更换数据库文件路径**：看 `docs/guides/DB_OPERATIONS.md`
- **想调整 runtime config / scheduler / sqlite / prompt workflow 默认参数**：看 `docs/guides/COMMANDS.md`
- **想理解接口**：看 `docs/API.md`
- **想理解架构边界**：看 `docs/ARCH.md`
- **想理解业务语义**：看 `docs/LOGIC.md`
- **想操作插件治理**：看 `docs/guides/PLUGIN_OPERATIONS.md`
