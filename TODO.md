# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 梳理当前代码实现
- [ ] 实现部分 docs/ENHANCEMENTS.md 文件中列出的高价值内容

### AI 网关模块盲点修复 (基于代码审计发现)
- [ ] 清理死代码：确认并删除 `ai_invocation_query.ts`（未被任何文件引用，与 `ai_invocations.ts` 重复 ~335 行）
- [ ] 清理空目录：`ai/schemas/` 目录为空，填充或移除
- [ ] 补全 `model_routed` 公共 contract：`inferenceStrategySchema` 目前只允许 `mock|rule_based`，gateway 路径无法通过公开 API 触发（确认设计意图或修复）
- [ ] 启用 tool calling 入口：`task_service.ts` 中硬编码 `tools:[]` + `tool_policy:{mode:'disabled'}`，需要提供开启路径
- [ ] 评估 streaming/SSE 需求：gateway 当前零流式支持，所有调用均为 req→full response
- [ ] 增加观测写入降级策略：`context` 为 null 时调用记录静默丢失，至少应输出 warn 日志；Prisma 写入失败不应阻断 gateway 响应
- [ ] 引入熔断器/速率限制/指数退避：当前仅简单 `retry_limit`，无 circuit breaker、rate limiter、backoff
- [ ] 注册表热加载：`resetAiRegistryCache()` 存在但无 file watcher 调用，修改 `ai_models.yaml` 需重启
- [ ] 补充测试覆盖：`registry.ts`（YAML 加载/合并）、`task_decoder.ts`（schema 校验/alias/unwrap）、`observability.ts`（Prisma 写入）、OpenAI adapter 集成测试、HTTP 路由契约测试
- [ ] 梳理三层 AI 目录边界：`domain/inference/`（仅 1 文件）、`inference/`、`ai/` 三者关系需文档化或重构
- [ ] 删除旧 `token_budget_trimmer`



## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。