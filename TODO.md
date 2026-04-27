# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 梳理当前代码实现

- [ ] 实现部分 docs/ENHANCEMENTS.md 文件中列出的高价值内容
### AI 网关模块盲点修复 (基于代码审计发现)

- [x] 启用 tool calling 入口：`task_service.ts` 中硬编码 `tools:[]` + `tool_policy:{mode:'disabled'}`，已有方案，详见 `.limcode/design/ai-tool-calling-enablement.md` — **已完成（Phase 1–3，165 tests）**

- [ ] Streaming/SSE 支持：**全项目盲点** — gateway 和旧 inference 链路均为 req→full response，`openai.ts` 适配器无 `stream:true`，无 SSE/EventSource 能力，择日处理

### 世界包多包运行时 (World-Pack Multi-Runtime)

- [x] 共享 materialization 接口抽取：`pack_materializer.ts` + `runtime_activation.ts` 重构 + `PackRuntimeRegistryService.load()` 接入 — 详见 `.limcode/design/experimental-pack-runtime-materialization.md`
- [x] Experimental pack step API：`POST /api/experimental/runtime/packs/:packId/step` — 独立时钟推进
- [x] Unload 清理增强：删除 runtime.sqlite + storage-plan.json + pluginRuntimeRegistry 缓存
- [ ] Plugin discovery for experimental packs：当前 `discoverPackLocalPlugins` 只在 active activation 调用，实验性 pack 加载不触发 — 需要 `packFolderName` 定位目录
- [ ] `bootstrap_list` 启动模式：`runtime.multi_pack.start_mode` 和 `bootstrap_packs` 配置已存在，启动逻辑未实现 — 留钩子
- [ ] Scheduler 多包隔离：`experimental_scheduler_runtime.ts` 当前只给 `partition_id` 加前缀，未真正按 pack 隔离数据 — 需深重构
- [ ] 实验性 pack 卸载无 scheduler worker 通知：当前只清理数据和缓存，未通知 scheduler 停止相关 workers


## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。