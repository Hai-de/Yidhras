# Documentation Index / 文档导航

`docs/` 是 Yidhras 的文档导航与稳定参考入口。

> 目标：让读者先判断“该去哪看”，再进入对应文档；避免同一组事实在多个文件中长期重复维护。

## 文档分层

当前仓库文档按四层组织：

### 1. 入口文档层
用于第一次进入仓库的读者，强调项目定位、最小启动路径与导航。

- `../README.md`
  - 用途：仓库入口、最小启动方式、少量高频命令、总导航
  - 不该写什么：长篇命令手册、低频 CLI 示例、阶段性实现快照、完整子系统说明
- `../AGENTS.md`
  - 用途：协作规则、工程约束、文档维护原则
  - 不该写什么：完整业务状态、重复的命令大全、替代正式参考文档的实现说明
- `INDEX.md`
  - 用途：文档总导航、分层说明、事实源规则
  - 不该写什么：重复的系统设计、接口细节、阶段状态汇报

### 2. 稳定参考层
用于长期参考，尽量只写相对稳定的事实与边界。

- `API.md`
  - 用途：公共 HTTP contract、错误码、调用边界
  - 不该写什么：阶段性推进说明、里程碑记录、过细的内部实现过程
- `ARCH.md`
  - 用途：系统分层、模块边界、宿主关系、依赖方向
  - 不该写什么：滚动式开发状态、待办列表、完整操作手册
- `LOGIC.md`
  - 用途：业务规则、执行主线、领域语义
  - 不该写什么：纯架构分层说明、命令入口、里程碑总结
- `THEME.md`
  - 用途：前端主题 contract、解析链路、调试入口
- `WORLD_PACK.md`
  - 用途：world pack 项目化、README 标配、发布规范
- `ENHANCEMENTS.md`
  - 用途：明确延期但未废弃的增强项收纳池
  - 不该写什么：当前迭代 backlog、已完成里程碑复盘
- `../apps/web/README.md`
  - 用途：前端应用范围、结构与开发约束

### 3. 操作手册层
用于命令、流程、CLI、排障和具体操作流程。

- `guides/COMMANDS.md`
  - 用途：工作区 / server / web 常用命令、测试矩阵、运行时准备与脚手架命令
- `guides/PLUGIN_OPERATIONS.md`
  - 用途：插件 CLI / GUI / API 的治理流程与常见排查路径
- 如后续需要，再补：
  - `guides/TESTING.md`
  - `guides/RUNTIME_SETUP.md`

### 4. 状态 / 过程记录层
用于阶段性计划、评审、里程碑、迁移记录，不作为长期稳定事实源。

- `../TODO.md`
  - 用途：当前 backlog 与优先级
  - 不该写什么：长期稳定架构说明、完整已完成能力清单
- `../.limcode/design/`
  - 用途：设计草案
- `../.limcode/plans/`
  - 用途：执行计划与任务拆解
- `../.limcode/review/`
  - 用途：评审记录、审查结论、证据归档
- `history/INDEX.md`
  - 用途：人类可读历史归档入口

## 快速导航

### 仓库入口

- 项目概览与启动：`../README.md`
- 协作规则与工程约束：`../AGENTS.md`
- 当前 backlog：`../TODO.md`

### 稳定参考

- 接口契约：`API.md`
- 架构边界：`ARCH.md`
- 业务规则：`LOGIC.md`
- 主题系统：`THEME.md`
- World Pack 规范：`WORLD_PACK.md`
- 延后增强项：`ENHANCEMENTS.md`
- 前端应用说明：`../apps/web/README.md`

### 专题能力

- Prompt Workflow：`capabilities/PROMPT_WORKFLOW.md`
- AI Gateway：`capabilities/AI_GATEWAY.md`
- Plugin Runtime：`capabilities/PLUGIN_RUNTIME.md`

### 操作手册

- 命令手册：`guides/COMMANDS.md`
- 插件治理操作：`guides/PLUGIN_OPERATIONS.md`

### 历史归档

- 历史索引：`history/INDEX.md`

### 过程资产

- 设计草案：`../.limcode/design/`
- 执行计划：`../.limcode/plans/`
- 评审记录：`../.limcode/review/`

## 事实源规则

### 规则 1：一个主题只保留一个主事实源

示例：

- 仓库启动与导航 -> `README.md`
- 公共接口契约 -> `API.md`
- 系统分层与模块边界 -> `ARCH.md`
- 业务执行语义 -> `LOGIC.md`
- Prompt Workflow 细节 -> `capabilities/PROMPT_WORKFLOW.md`
- AI Gateway 细节 -> `capabilities/AI_GATEWAY.md`
- Plugin Runtime 细节 -> `capabilities/PLUGIN_RUNTIME.md`
- 当前 backlog -> `TODO.md`
- 设计/计划/评审过程 -> `.limcode/`
- 人类可读历史归档 -> `history/`

其他文档只做摘要与链接，不再复制大段正文。

### 规则 2：入口文档链接，参考文档定事实，过程文档记变化

- 入口文档回答“去哪里看”
- 参考文档回答“系统稳定是什么”
- 过程文档回答“这轮为什么这样改、改到哪一步了”
- 历史归档回答“这套文档体系是如何演进到现在的”

### 规则 3：状态与事实分离

以下两类内容应尽量分开：

- 稳定事实：接口、边界、语义、规范
- 状态信息：当前、本轮、阶段中、已完成、待迁移

如果一段内容主要依赖“当前 / 本轮 / 暂时 / 后续”这类语气，它通常不应长期停留在稳定参考文档中。

### 规则 4：命令说明集中维护

高密度命令、CLI 示例、测试矩阵不应长期堆在 `README.md` 中；统一迁移到 `guides/` 层维护，根文档只保留高频入口。

## 文档更新指引

当代码或行为变化时，优先判断应该更新哪一类文档：

- 改了启动方式 / 仓库入口 -> 更新 `README.md`
- 改了公共路由 contract / 错误码 -> 更新 `API.md`
- 改了模块边界 / 宿主关系 -> 更新 `ARCH.md`
- 改了业务规则 / 执行语义 -> 更新 `LOGIC.md`
- 改了 Prompt Workflow 细节 -> 更新 `capabilities/PROMPT_WORKFLOW.md`
- 改了 AI Gateway / invocation observability -> 更新 `capabilities/AI_GATEWAY.md`
- 改了 Plugin Runtime / runtime host / governance boundary -> 更新 `capabilities/PLUGIN_RUNTIME.md`
- 改了主题 contract -> 更新 `THEME.md`
- 改了 world pack 项目化规范 -> 更新 `WORLD_PACK.md`
- 改了当前优先级 -> 更新 `TODO.md`
- 做了设计、计划、评审、迁移说明 -> 更新 `.limcode/` 对应资产
- 需要长期保留的人类可读历史记录 -> 更新 `history/`

如果不确定落点，优先更新主事实源文档，再在入口文档中补链接，而不是反过来复制正文。

## 当前治理结论

如果遇到多份文档说法不一致：

- 接口以代码与 `packages/contracts` + `API.md` 为准
- 架构边界以 `ARCH.md` 为准
- 业务语义以 `LOGIC.md` 为准
- 专题高耦合细节以 `capabilities/` 为准
- 阶段性结论以最新 `.limcode/review/` / `.limcode/plans/` / `.limcode/progress.md` 为准
- 历史迁移与归档说明以 `history/` 为准
