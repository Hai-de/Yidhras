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
- [ ] `bootstrap_list` 启动模式：`runtime.multi_pack.start_mode` 和 `bootstrap_packs` 配置已存在，启动逻辑未实现 — 留钩子
- [ ] Scheduler 多包隔离：`experimental_scheduler_runtime.ts` 当前只给 `partition_id` 加前缀，未真正按 pack 隔离数据 — 需深重构
- [ ] 实验性 pack 卸载无 scheduler worker 通知：当前只清理数据和缓存，未通知 scheduler 停止相关 workers


## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。