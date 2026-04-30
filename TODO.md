# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus


- [ ] 正式实现多包世界运行时
- [ ] 已经开发了不少功能，是时候更新一下api接口了，前端很长一段时间基本没有更新，到时候基本是大翻新，在大翻新钱可以升级或者重构对外暴露的api接口




### 梳理当前代码实现

- [ ] 实现部分 docs/ENHANCEMENTS.md 文件中列出的高价值内容

### AI 网关模块盲点修复 (基于代码审计发现)


- [ ] Streaming/SSE 支持：**全项目盲点** — gateway 和旧 inference 链路均为 req→full response，`openai.ts` 适配器无 `stream:true`，无 SSE/EventSource 能力，择日处理

### 世界包多包运行时 (World-Pack Multi-Runtime)

- [ ] Plugin discovery for experimental packs：当前 `discoverPackLocalPlugins` 只在 active activation 调用，实验性 pack 加载不触发 — 需要 `packFolderName` 定位目录
- [ ] `bootstrap_list` 启动模式：`runtime.multi_pack.start_mode` 和 `bootstrap_packs` 配置已存在，启动逻辑未实现 — 本轮实现"读配置 + 逐个 load + 留钩子"，暂不打破现有 active pack 依赖
- [ ] `listStatuses` stub 修复：`index.ts:188` 的 `listStatuses: () => []` 未接入 `DefaultPackRuntimeRegistryService` 的已实现方法
- [ ] 实验性 pack 卸载无 scheduler worker 通知：当前只清理数据和缓存，未通知 scheduler 停止相关 workers — 通过 `onBeforeUnload` hook 注入 scheduler 清理逻辑
- [ ] **移除 active pack 单例依赖**：`simulation_loop.ts`、`runtime_kernel_service.ts`、大量 routes/services 假定存在唯一 activePack — 需全面重构，在 scheduler Docker 式隔离完成后处理 (`bootstrap_list` 真正运作的前置条件)
- [ ] **Simulation loop 多包 tick**：当前 loop 只 tick active pack — 需 per-pack 调度循环，在 Scheduler Docker 式容器隔离完成后处理
- [ ] **Scheduler Docker 式容器隔离**：每个 pack 物理上完全独立的 scheduler — 详见 `.limcode/design/scheduler-docker-isolation-design.md`，单独实施


## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。