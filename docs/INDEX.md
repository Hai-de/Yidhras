# Documentation Index / 文档导航

`docs/` 是 Yidhras 的文档导航与稳定参考入口。

> 目标：让读者先判断"该去哪看"，再进入对应文档；避免同一组事实在多个文件中长期重复维护。

## 1. 入口文档层

用于第一次进入仓库的读者，强调项目定位、最小启动路径与导航。

| 文档 | 定位 |
|------|------|
| [README.md](../README.md) | 仓库入口、最小启动方式、高频命令 |
| [AGENTS.md](../AGENTS.md) | 协作规则、工程约束、文档治理原则 |
| [TODO.md](../TODO.md) | 当前 backlog 与优先级 |

## 2. 稳定参考层

用于长期参考，尽量只写相对稳定的事实与边界。

| 文档 | 定位 |
|------|------|
| [API.md](API.md) | 公共 HTTP contract、错误码、调用边界 |
| [ARCH_DIAGRAM.md](ARCH_DIAGRAM.md) | 系统全局结构图、模块关系图、调用流 |
| [ARCH.md](ARCH.md) | 系统分层、模块边界、宿主关系、依赖方向 |
| [LOGIC.md](LOGIC.md) | 业务规则、执行主线、领域语义 |
| [THEME.md](THEME.md) | 前端主题 contract、解析链路、调试入口 |
| [WORLD_PACK.md](WORLD_PACK.md) | world pack 项目化、README 标配、发布规范 |
| [ENHANCEMENTS.md](ENHANCEMENTS.md) | 延后增强项重定向入口；实际内容在 [backlog](../.limcode/enhancements-backlog.md) |
| [apps/web/README.md](../apps/web/README.md) | 前端应用范围、结构与开发约束 |

## 3. 专题能力层

深入子系统的高耦合细节，每个专题有独立职责边界。

| 文档 | 定位 |
|------|------|
| [capabilities/PROMPT_WORKFLOW.md](capabilities/PROMPT_WORKFLOW.md) | Prompt Workflow Runtime：prompt 组装管道、profile、section draft |
| [capabilities/PROMPT_SLOT_CONFIGURATION.md](capabilities/PROMPT_SLOT_CONFIGURATION.md) | Prompt Slot 配置指南：声明式 YAML slot 定义、模板语法、自定义 slot |
| [capabilities/AI_GATEWAY.md](capabilities/AI_GATEWAY.md) | AI Gateway：任务路由、模型调度、调用观测 |
| [capabilities/PLUGIN_RUNTIME.md](capabilities/PLUGIN_RUNTIME.md) | Plugin Runtime：pack-local 插件生命周期、治理、前后端承接 |

## 4. 操作手册层

以命令和操作步骤为核心，不是架构论述。

| 文档 | 定位 |
|------|------|
| [guides/COMMANDS.md](guides/COMMANDS.md) | 工作区 / server / web 命令、测试矩阵、脚手架 |
| [guides/DB_OPERATIONS.md](guides/DB_OPERATIONS.md) | 数据库迁移、初始化、路径更换 |
| [guides/PLUGIN_OPERATIONS.md](guides/PLUGIN_OPERATIONS.md) | 插件治理 CLI / GUI / API 流程 |
| [guides/SNAPSHOT.md](guides/SNAPSHOT.md) | 世界包快照系统：存档/恢复的原理、API 与使用工作流 |

## 5. 过程资产层

`.limcode/` 下存放阶段性计划、评审、设计，不是长期稳定事实源。详见 [`.limcode/README.md`](../.limcode/README.md)。

| 文档 | 定位 |
|------|------|
| [design/](../.limcode/design/) | 当前活跃/参考设计草案 |
| [plans/](../.limcode/plans/) | 当前活跃/参考执行计划与任务拆解 |
| [review/](../.limcode/review/) | 当前活跃/参考评审记录 |
| [archive/](../.limcode/archive/) | 已完成过程资产与历史草案归档 |
| [progress.md](../.limcode/progress.md) | 里程碑进度记录 |

## 6. 历史归档

| 文档 | 定位 |
|------|------|
| [history/INDEX.md](history/INDEX.md) | 人类可读历史归档索引 |
