# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus


- [ ] 处理跨语言的 IPC 通信损耗问题，Node.js 宿主和 Rust 之间通过 stdio 标准输入输出 + JSON-RPC 进行通信的。在海量 Agent 高频交互的每一步（Step），都要经历 JSON 序列化、跨进程通信、反序列化，**在理论上**性能损耗巨大。目前有以下方案作为备选（尚未评估项目具体情况）：
      - 替换 JSON 为二进制协议
      - 调研并引入 FlatBuffers 或 Cap'n Proto。通过“零拷贝（Zero-copy）”反序列化，Rust 接收到字节流后几乎不需要消耗 CPU 去解析，直接按偏移量读取内存即可。
      - 引入 UDS (Unix Domain Sockets) 或 Named Pipes：将通信管道从 stdio 升级为 UDS（Linux/macOS）或命名管道（Windows）
      - 把自定义的 JSON-RPC 替换为基于 UDS 的 gRPC 通信。Rust (tonic 库) 和 Node.js 对 gRPC 支持极好，自带流式控制（Streaming）和高效的 Protobuf 序列化
      - 在 TS 侧（WorldEnginePort）和 Rust 侧（WorldEngineSidecarClient）实现一层状态缓存机制。每次通信只传递“发生变更的数据”（Deltas / Patches），而非全量对象。
      - Batching（批处理）：将单次 Tick 中散落的多个 queryState 或 prepareStep 请求，合并为一个大的 Batch 请求，一次性通过 IPC 发送，减少 IPC 的系统调用次数。
      - 使用 napi-rs 编译为 Node Native Addon：将 Rust 引擎直接编译为 .node 动态链接库，Node.js 直接在同一进程内存空间内调用 Rust 函数。利用 Rust 的 catch_unwind 机制，可以在 Rust 边界捕获 panic，并将其转化为 Node.js 的 Error 抛出，依然能实现容错隔离，同时获得性能提升。
      - 引入 mmap (内存映射)。Node.js 和 Rust 进程映射同一块内存区域，Node.js 把数据写到内存，发信号（Event/Socket）告诉 Rust 去读。真正的数据传输开销变成了 0。
- [ ] 更新前端接入新的 `/:packId/api/...` 路由前缀
- [ ] 已经开发了不少功能，是时候更新一下api接口了，前端很长一段时间基本没有更新，到时候基本是大翻新，在大翻新前可以升级或者重构对外暴露的api接口

### 梳理当前代码实现

- [ ] 实现部分 docs/ENHANCEMENTS.md 文件中列出的高价值内容

### AI 网关模块盲点修复 (基于代码审计发现)

- [ ] Streaming/SSE 支持：**全项目盲点** — gateway 和旧 inference 链路均为 req→full response，`openai.ts` 适配器无 `stream:true`，无 SSE/EventSource 能力，择日处理

## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。
