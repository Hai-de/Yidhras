# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

- [ ] 更新前端接入新的 `/:packId/api/...` 路由前缀
- [ ] 已经开发了不少功能，是时候更新一下api接口了，前端很长一段时间基本没有更新，到时候基本是大翻新，在大翻新前可以升级或者重构对外暴露的api接口

### 梳理当前代码实现

- [ ] 实现部分 docs/ENHANCEMENTS.md 文件中列出的高价值内容

### AI 网关模块盲点修复 (基于代码审计发现)

- [ ] Streaming/SSE 支持：**全项目盲点** — gateway 和旧 inference 链路均为 req→full response，`openai.ts` 适配器无 `stream:true`，无 SSE/EventSource 能力，择日处理

### 世界包多包运行时 (World-Pack Multi-Runtime)

- [x] Scheduler Docker 式容器隔离 — 每个 pack 物理上完全独立的 scheduler（已完成 4 Phase）
- [x] Simulation loop 多包 tick — `PackSimulationLoop` per-pack 5 步循环 + `MultiPackLoopHost` 管理
- [x] 移除 active pack 单例依赖 — `packScope` + `PackScopeResolver` + `/:packId/` 路由前缀已就位；旧字段标记 `@deprecated`
- [x] 实验性 pack 卸载 scheduler worker 清理 — `MultiPackLoopHost.stopLoop()` 在 unload 时调用
- [ ] Plugin discovery for experimental packs：当前 `discoverPackLocalPlugins` 只在 active activation 调用，实验性 pack 加载不触发
- [ ] `bootstrap_list` 启动模式：`runtime.multi_pack.start_mode` 和 `bootstrap_packs` 配置已存在，启动逻辑未实现
- [ ] `listStatuses` stub 修复：`index.ts` 的 `listStatuses: () => []` 未接入 `DefaultPackRuntimeRegistryService` 的已实现方法

### Scheduler 隔离后续清理

以下为设计文档中 Phase 4 延后项，不影响当前功能：

- [ ] `scheduler_observability.ts` 读路径从 Prisma 迁移至 `SchedulerStorageAdapter`（当前写路径已迁移，读路径仍查 Prisma）
- [ ] Prisma schema 中 8 个 deprecated `Scheduler*` 模型删除（需 observability 读路径迁移完成后执行）
- [ ] `AppContext` 旧单例字段（`activePack`、`clock`、`paused`、`activePackRuntime`）最终移除
- [ ] `ARCH_DIAGRAM.md` 图更新为 per-pack loop 架构

## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。
