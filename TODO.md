# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 梳理当前代码实现
- [ ] 实现部分 docs/ENHANCEMENTS.md 文件中列出的高价值内容
- [ ] mock 和 rule_based 是开发/测试用的本地 provider，判断一下项目目前是否还需要她们
### AI 网关模块盲点修复 (基于代码审计发现)

- [~] 启用 tool calling 入口：`task_service.ts` 中硬编码 `tools:[]` + `tool_policy:{mode:'disabled'}`，已有方案，详见 `.limcode/design/ai-tool-calling-enablement.md`
- [ ] Streaming/SSE 支持：**全项目盲点** — gateway 和旧 inference 链路均为 req→full response，`openai.ts` 适配器无 `stream:true`，无 SSE/EventSource 能力，择日处理
- [x] 引入熔断器/速率限制/指数退避：**全项目盲点** — 当前仅简单 `retry_limit` 循环，无 circuit breaker、rate limiter、exponential backoff（`gateway.ts` 重试间零延迟，`openai.ts` 不处理 429 Retry-After，旧 inference 无 API 级重试）
- [x] 补充测试覆盖：`registry.ts`（YAML 加载/合并）、`task_decoder.ts`（schema 校验/alias/unwrap）、`observability.ts`（Prisma 写入）、OpenAI adapter 集成测试、HTTP 路由契约测试 — 择日处理



## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。