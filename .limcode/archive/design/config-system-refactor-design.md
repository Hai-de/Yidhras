# 配置系统改造 设计

> 状态: 已实现
> 关联 TODO: 拆分配置文件 / 增量更新 / 安全分级 / 备份机制

## 1. 背景

Yidhras 的配置系统在本次改造前存在四个结构性缺陷：

1. **单文件臃肿**: `default.yaml` 202 行覆盖 13 个域，`schema.ts` 和 `BUILTIN_DEFAULTS` 同样单文件承载，新增配置域需要同时修改三处
2. **配置漂移**: `ensureRuntimeConfigScaffold()` 只做文件不存在时的首次复制，不处理模板更新后的增量 key 传播 — `config_version` 字段完全未使用
3. **无安全分级**: `jwt_secret` 和 `logging.level` 在修改层面被视为同等风险，没有热重载 / 重启 / 确认的分级控制
4. **无备份**: 没有 CLI、API、脚本或任何备份机制

## 2. 核心设计原则

1. 域拆分优先 — 每个配置域独立管理，模板、默认值、Zod schema 三位一体在同一文件
2. 向后兼容 — 旧版单文件 `default.yaml` 继续可用，新装和已有安装平滑过渡
3. 安全分级渐进 — 元数据标注不改变 Zod 验证行为，tier 仅在 API 写入和热重载时生效
4. 备份自包含 — 备份 CLI 不依赖运行中的服务器，直接操作文件系统 + JSON 元数据

## 3. 架构变更

### 3.1 文件结构

```
apps/server/src/config/
  domains/                    # 新增 — 按域拆分的配置模块
    index.ts                  # 组装 RuntimeConfigSchema + BUILTIN_DEFAULTS
    app.ts                    # 每个导出: Schema + DEFAULTS
    paths.ts
    operator.ts
    plugins.ts
    world.ts
    startup.ts
    sqlite.ts
    logging.ts
    clock.ts
    world_engine.ts
    scheduler.ts
    prompt_workflow.ts
    runtime.ts
    features.ts
  schema.ts                   # 改为从 domains/ 重导出（保持旧导入兼容）
  runtime_config.ts           # BUILTIN_DEFAULTS 改为从 domains/ 导入
  manifest.ts                 # 新增 — 模板默认值加载
  migration.ts                # 新增 — 配置漂移检测与迁移
  tiers.ts                    # 新增 — 安全分级定义与查询
  watcher.ts                  # 新增 — conf.d/ 文件变更监听与热重载

apps/server/templates/configw/
  conf.d/                     # 新增 — 拆分后的 YAML 模板
    app.yaml
    paths.yaml
    operator.yaml
    ...

apps/server/src/app/
  services/
    config.ts                 # 新增 — 配置读写服务（含脱敏）
    config_backup.ts          # 新增 — 备份服务（tar.gz + JSON 元数据）
  routes/
    config.ts                 # 新增 — 配置 API (GET/PATCH /api/config)
    config_backup.ts          # 新增 — 备份 API (CRUD /api/config/backups)

apps/server/src/cli/
  config_backup_cli.ts        # 新增 — 备份 CLI (create/list/restore/delete/cleanup)

packages/contracts/src/
  config_backup.ts            # 新增 — 备份相关 Zod schema
```

### 3.2 加载链变更

```
层 0: BUILTIN_DEFAULTS (从 domains/ 导入)
层 1: conf.d/*.yaml (新布局) 或 default.yaml (旧布局兼容)
层 2: {env}.yaml (环境覆写)
层 3: local.yaml (本地覆写)
层 4: 环境变量 (最高优先级)
```

加载时新增配置漂移检测：对比用户配置与 `apps/server/templates/configw/conf.d/` 模板，检测缺失 key 并日志告警。

### 3.3 配置安全分级

| Tier | 含义 | 热重载 | 写操作行为 | 示例域 |
|------|------|--------|-----------|--------|
| `safe` | 可热重载 | 是 | 即时生效 | logging, features |
| `caution` | 需确认 | 否 | 写入文件，下次请求生效 | scheduler agent limit |
| `dangerous` | 需重启 | 否 | 写入文件，提示重启 | sqlite, world_engine |
| `critical` | 需操作员确认 | 否 | 写入文件，强制重启 | operator (jwt/密码) |

### 3.4 备份系统

- **元数据**: `data/backups/config/backups.json`，不依赖 Prisma
- **归档格式**: `tar.gz`（使用系统 `tar` 命令，零依赖）
- **保留策略**: `max_count: 20`, `max_age_days: 30`（硬编码默认值，后续可配）
- **CLI 命令**: `pnpm config:backup create|list|info|restore|delete|policy|cleanup`
- **API 端点**: `POST/GET/DELETE /api/config/backups`, `GET .../download`, `POST .../restore`, `POST .../cleanup`

## 4. API 端点

### 4.1 配置管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/config` | 操作员 | 完整配置（敏感字段脱敏） |
| GET | `/api/config/domains` | 操作员 | 列出所有域及其 tier |
| GET | `/api/config/:domain` | 操作员 | 单个域配置 |
| PATCH | `/api/config/:domain` | root | 更新域配置（tier 控管行为） |

### 4.2 配置备份

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/config/backups` | root | 创建备份 |
| GET | `/api/config/backups` | 操作员 | 列出备份 |
| GET | `/api/config/backups/:id` | 操作员 | 备份详情 |
| GET | `/api/config/backups/:id/download` | root | 下载备份文件 |
| DELETE | `/api/config/backups/:id` | root | 删除备份 |
| POST | `/api/config/backups/:id/restore` | root | 恢复备份 (?force=true) |
| GET | `/api/config/backup-policy` | 操作员 | 获取保留策略 |
| POST | `/api/config/backups/cleanup` | root | 触发保留策略清理 |

## 5. CLI 命令

```bash
pnpm config:backup create [--name <name>]
pnpm config:backup list [--limit <n>]
pnpm config:backup info <id>
pnpm config:backup restore <id> [--force]
pnpm config:backup delete <id>
pnpm config:backup policy
pnpm config:backup cleanup
pnpm config:backup --help
```

## 6. 向后兼容性

- 旧版单文件 `data/configw/default.yaml` 继续工作：若 `conf.d/` 目录不存在，回退到单文件加载
- `schema.ts` 的 `RuntimeConfig` 和 `RuntimeConfigSchema` 导出路径不变，所有现有 import 无需修改
- `BUILTIN_DEFAULTS` 值完全保持一致，仅存储位置从 `runtime_config.ts` 移动到 `domains/`

## 7. 实施状态

- [x] Phase 1: 拆分配置文件（14 个域模块 + YAML 模板 + 脚手架更新）
- [x] Phase 2: 增量更新（manifest.ts + migration.ts + drift 检测集成）
- [x] Phase 3: 配置安全分级（tiers.ts + watcher.ts + 配置 API）
- [x] Phase 4: 备份 CLI + API（service + routes + CLI + contracts）
- [x] 备份保留策略从 `conf.d/backup.yaml` 读取（替换硬编码）
- [x] 配置更新 API 审计日志集成（`UPDATE_CONFIG` action → `OperatorAuditLog`）
- [x] `data/configw/default.yaml` 原地迁移为 `conf.d/` 布局
- [x] watcher 增加 mtime+size 脏文件检测，跳过无实际变更的事件
- [x] 设计文档同步

## 8. 后续工作

- [ ] 配置热重载的细粒度控制：按域拆分 `RuntimeConfigCache`，仅失效受影响的缓存片段（远期优化）
- [ ] 备份可视化前端：在 operator 面板中直接查看/创建/恢复备份
