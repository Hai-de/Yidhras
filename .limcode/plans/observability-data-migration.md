# 可观测性 + 数据迁移实施计划

> 基于: `.limcode/design/generic-capability-development-draft.md` §八、§十
> 决策: Prometheus 独立端口, dump 输出 stdout, 数据迁移手动 CLI
> 状态: 全部完成 ✓

---

## A. Prometheus 指标 ✓

### A1. 依赖 + 配置 ✓
- `prom-client` 已安装
- `RuntimeConfig_DomainSchema` 增加 `metrics_port` (默认 9090)
- 环境变量 `OBSERVABILITY_METRICS_PORT` 覆盖

### A2. 指标 + 端点 ✓
- `apps/server/src/observability/metrics.ts` — 7 个指标: tick_duration, tick_total, inference_duration, inference_total, action_intents_dispatched, plugins_active, sidecar_health
- `apps/server/src/observability/metrics_server.ts` — 独立 HTTP server，`GET /metrics` 返回 prometheus 格式

### A3. 埋点 ✓
- `PackSimulationLoop` — 每步 `recordTickCompleted()`
- `action_dispatcher_runner.ts` — dispatch 成功/失败/丢弃时 `recordActionIntentDispatched()`
- AI gateway 埋点未实施（函数退出点过多，需更深层集成）

### A4. 启动 ✓
- `index.ts` — HTTP server 启动后 `startMetricsServer(metricsPort)`

## B. 边车健康暴露 ✓

- `system.ts` health API — 查询 `worldEngine.getHealth()` 并附加 `sidecars` 字段

## C. 运行时 Dump CLI ✓

- `apps/server/src/cli/dump_cli.ts` — 直接 DB 读取，JSON 到 stdout
- 脚本: `pnpm --filter yidhras-server sim:dump <packId> --type agent|relation|memory|all`

## D. 数据迁移 ✓

### D1. Schema ✓
- `constitution_schema.ts` — `worldPackConstitutionSchema` 增加 `schema_version: z.number().int().nonnegative().default(0)`

### D2. 迁移注册表 ✓
- `apps/server/src/packs/migrations/registry.ts` — `migrateConfig()` 链式执行迁移

### D3. CLI ✓
- `apps/server/src/cli/migrate_pack_cli.ts` — 加载 config → 检测版本 → 执行迁移 → 备份 + 写回
- 脚本: `pnpm --filter yidhras-server db:migrate-pack <packId> [--target-version <n>]`
