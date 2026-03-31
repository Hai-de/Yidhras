# Yidhras Web

Yidhras 的 Nuxt 4 + Vue 3 + Pinia 前端壳层。
This app is currently a non-final frontend shell for layered UI exploration rather than a finished product UI.

## 当前状态 / Current Status

- `layouts/default.vue` 提供三栏式壳层与 L1/L2/L3/L4 层级切换。
- `components/L2Graph.vue` 提供 Cytoscape 关系图可视化组件。
- `stores/clock.ts` 会从后端 `/api/clock` 同步时间，并把字符串形式的 BigInt 转回前端 `BigInt`。
- `stores/system.ts` 负责当前层级、状态徽标等轻量前端状态。
- `utils/api.ts` 现已提供统一的最小 API client 基础层（envelope 解包、基础错误处理、统一请求入口）。
- `app.vue` 当前只对 L2 提供了真实组件挂载，其余层仍显示占位态。
- 当前 L2 图数据仍是 `app.vue` 内的 mock 数据，不是完整后端驱动图谱。
- 前端布局与产品化交互尚未冻结；正式状态请参考根目录 `TODO.md` 中的 M3。

## 环境要求 / Requirements

- Node.js 18+
- pnpm 10+
- 建议后端同时运行在 `http://localhost:3001`，否则时钟同步会失败

## 安装 / Install

从仓库根目录执行：

```bash
pnpm install
```

或仅安装当前应用依赖：

```bash
pnpm --filter web install
```

## 本地开发 / Development

从仓库根目录执行：

```bash
pnpm --filter web dev
```

默认开发地址通常为 `http://localhost:3000`。

## 质量检查 / Quality Checks

```bash
pnpm --filter web lint
pnpm --filter web typecheck
```

## 构建与预览 / Build & Preview

```bash
pnpm --filter web build
pnpm --filter web preview
```

## 当前文件锚点 / Current File Map

- `app.vue`: 当前应用入口与 L2 mock graph 挂载点
- `layouts/default.vue`: 默认三栏布局、层级切换、顶部状态栏
- `components/L2Graph.vue`: Cytoscape 图谱组件
- `stores/clock.ts`: 时间同步与 BigInt 字符串转换
- `stores/system.ts`: 当前层级/状态管理与运行态同步
- `utils/api.ts`: 统一 API client、envelope 解包与基础错误处理
- `nuxt.config.ts`: Nuxt、Tailwind、Pinia、VueUse 配置

## 已知限制 / Known Limitations

- 当前只有 L2 层具备可视化组件，其它层仍为占位内容。
- 图谱数据仍为 mock 数据，尚未完整接到 `/api/relational/graph`。
- 前端尚未完整接入后端通知队列、推理工作流、world-pack 内容浏览等能力。
- 当前前端更适合作为壳层/布局实验，而不是已冻结产品界面。
- 当前前端仅完成统一 API client 的最小基线接入（clock/status 路径），更广泛的共享 contract 接入仍在后续阶段。
- `apps/web/components/L2Graph.vue` 仍存在 Nuxt/Vue/Cytoscape DOM container typing 兼容问题，已明确记录为前端后续处理项。

## 相关文档 / Related Docs

- 根目录 `README.md`: 项目整体状态与文档索引
- 根目录 `TODO.md`: 里程碑与当前 M3 状态
- `docs/API.md`: 后端接口契约
- `docs/ARCH.md`: 架构边界与 contract/validation 原则
- `docs/LOGIC.md`: 业务逻辑说明与 BigInt transport 规则
