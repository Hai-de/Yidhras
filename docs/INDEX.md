# Documentation Index / 文档导航

`docs/` 是 Yidhras 的文档导航与稳定参考入口。

> 目标：让读者先判断"该去哪看"，再进入对应文档；避免同一组事实在多个文件中长期重复维护。

## 1. 入口文档层

用于第一次进入仓库的读者，强调项目定位、最小启动路径与导航。

| 文档 | 定位 |
|------|------|
| [README.md](../README.md) | 仓库入口、最小启动方式、高频命令 |
| [AGENTS.md](../AGENTS.md) | 协作规则、工程约束、文档治理原则 |
| [TODO.md](../TODO.md) | backlog 与优先级 |

## 2. 架构与语义层

系统全局结构、边界定义与业务执行规则。三者各有独立视角，互不重复：

| 文档 | 视角 | 定位 |
|------|------|------|
| [ARCH.md](ARCH.md) | 结构 | 系统分层、模块边界、宿主关系、依赖方向、持久化归属 |
| [ARCH_DIAGRAM.md](ARCH_DIAGRAM.md) | 视觉 | Mermaid 全局结构图、调用流、状态机（图 + 简短图注） |
| [LOGIC.md](LOGIC.md) | 行为 | 业务执行主线、语义规则、权限模型、projection 可见性 |

阅读建议：先看 ARCH_DIAGRAM 建立全局印象 → ARCH 理解边界 → LOGIC 理解执行规则。

## 3. 接口规范层

系统对外承诺的形式接口与合约。

| 文档 | 定位 |
|------|------|
| [specs/API.md](specs/API.md) | 公共 HTTP contract、错误码、调用边界 |
| [specs/THEME.md](specs/THEME.md) | 前端主题 token contract、解析链路、调试入口 |
| [specs/WORLD_PACK.md](specs/WORLD_PACK.md) | world-pack 项目化、README 标配、发布规范 |
| [apps/web/README.md](../apps/web/README.md) | 前端应用范围、结构与开发约束 |

## 4. 子系统层

深入子系统的高耦合细节，每个专题有独立职责边界。

| 文档 | 定位 |
|------|------|
| [subsystems/PROMPT_WORKFLOW.md](subsystems/PROMPT_WORKFLOW.md) | Prompt Workflow Runtime：prompt 组装管道、profile、section draft |
| [subsystems/PROMPT_SLOT_CONFIGURATION.md](subsystems/PROMPT_SLOT_CONFIGURATION.md) | Prompt Slot 配置指南：声明式 YAML slot 定义、模板语法、自定义 slot |
| [subsystems/AI_GATEWAY.md](subsystems/AI_GATEWAY.md) | AI Gateway：任务路由、模型调度、调用观测、弹性层 |
| [subsystems/BEHAVIOR_TREE.md](subsystems/BEHAVIOR_TREE.md) | Behavior Tree InferenceProvider：确定性行为树配置、注册、求值、装饰器与限制 |
| [subsystems/PLUGIN_RUNTIME.md](subsystems/PLUGIN_RUNTIME.md) | Plugin Runtime：pack-local 插件生命周期、治理、前后端承接 |
| [subsystems/STRUCTURED_PARSER.md](subsystems/STRUCTURED_PARSER.md) | Structured Parser：可配置模板解析引擎、修饰符链、块语法、DataCleaner 适配 |

## 5. 操作手册层

以命令和操作步骤为核心，不是架构论述。

| 文档 | 定位 |
|------|------|
| [guides/COMMANDS.md](guides/COMMANDS.md) | 工作区 / server / web 命令、测试矩阵、脚手架 |
| [guides/CONFIGURATION.md](guides/CONFIGURATION.md) | ConfigW 配置系统：分层合并、域索引、环境变量、AI 模型注册表、世界包配置 |
| [guides/DB_OPERATIONS.md](guides/DB_OPERATIONS.md) | 数据库迁移、初始化、路径更换 |
| [guides/PLUGIN_OPERATIONS.md](guides/PLUGIN_OPERATIONS.md) | 插件治理 HTTP API / GUI 流程 |
| [guides/SNAPSHOT.md](guides/SNAPSHOT.md) | 世界包快照系统：存档/恢复的原理、API 与使用工作流 |

## 6. 过程资产

`.limcode/` 下存放阶段性计划、评审、设计与历史归档，不是长期稳定事实源。过程资产不在 `docs/` 中重复维护。
