# Database Operations / 数据库迁移与更换手册

本文档面向 **部署者 / 运维 / 本地环境维护者**，说明当前 Yidhras 服务端如何：

- 配置数据库路径；
- 执行 Prisma migration；
- 完成运行时初始化；
- 重置本地开发数据库；
- 在继续使用 Prisma 前提下，更换数据库文件位置或切换数据库后端时应注意什么。

> 适用范围：当前 `apps/server` 后端。
>
> 当前主事实：
> - ORM / migration 工具：Prisma
> - 默认 datasource：SQLite
> - Prisma schema：`apps/server/prisma/schema.prisma`
> - 默认本地数据库文件：`data/yidhras.sqlite`
>
> 本文档关注“部署与迁移操作”，不替代架构边界说明；架构边界请看 `../ARCH.md`。

---

## 1. 当前数据库形态

当前后端使用 Prisma，schema 定义在：

- `apps/server/prisma/schema.prisma`

其中 datasource 为：

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

也就是说：

- **Prisma 通过 `DATABASE_URL` 决定连接目标**；
- 当前仓库默认以 **SQLite** 方式运行；
- migration 通过 `prisma migrate deploy` 应用。

### 默认开发数据库位置

当前 `apps/server/.env` 中默认是：

```env
DATABASE_URL="file:../../../data/yidhras.sqlite"
```

从 `apps/server` 目录看，这会指向仓库根下的：

- `data/yidhras.sqlite`

相关的 SQLite sidecar 文件还可能包括：

- `data/yidhras.sqlite-wal`
- `data/yidhras.sqlite-shm`

---

## 2. 数据库相关环境变量

## 2.1 必需：`DATABASE_URL`

Prisma 连接数据库所必需。默认值见 `apps/server/.env`：`file:../../../data/yidhras.sqlite`。

> 注意：`file:` URL 的相对路径是**相对 Prisma 命令执行目录**来解析的。建议优先使用绝对路径或明确、稳定的相对路径，避免在不同 cwd 下造成“数据库实际落到别处”。

更换数据库文件位置的完整说明见第 8 节。

## 2.2 常见辅助变量

这些变量不直接决定 Prisma datasource，但会影响服务启动与初始化：

### `WORKSPACE_ROOT`

来自 `apps/server/src/config/loader.ts`。

作用：

- 显式指定工作区根目录；
- runtime config、world pack 路径、脚手架定位会依赖它。

不设置时，服务会向上查找：

- `pnpm-workspace.yaml`
- `.git`

来自动推断 workspace root。

### `WORLD_PACKS_DIR`

会覆盖 runtime config 中的 `paths.world_packs_dir`。

作用：

- 指定 world pack 读取位置；
- 不改变 Prisma 连接目标，但影响初始化和启动健康检查。

### `PORT`

会覆盖 runtime config 中的 `app.port`。

影响 server 监听端口，与数据库无直接关系。

### `data/configw/*.yaml`

配置优先级链的事实源与完整字段说明见 [`ARCH.md`](../ARCH.md) 第 2.4 节。简要结论：**env > yaml > code default**。

与数据库 / runtime 稳定性直接相关的 config 字段包括路径、SQLite pragma、scheduler 策略等；experimental multi-pack runtime 的配置与启用约束见 [`ARCH.md`](../ARCH.md) 第 3.3.1 节。

影响范围简述：

- server 启动节奏
- SQLite 锁等待与 checkpoint 行为
- scheduler 运行、单实体 single-flight、tick 级吞吐节奏与 operator 观测体验

---

## 3. 推荐启动顺序

新环境推荐：

```bash
pnpm install
pnpm prepare:runtime
pnpm dev:server
pnpm dev:web
```

`prepare:runtime` 会依次执行 `prisma migrate deploy` → `init:runtime` → `seed:identity`。

更细粒度的命令说明见 [`COMMANDS.md`](./COMMANDS.md) 第 3.4 节。

---

## 4. 单独执行数据库迁移

如果你只想应用 migration，而不做运行时初始化，可进入 `apps/server` 执行：

```bash
pnpm exec prisma migrate deploy
```

或在仓库根目录：

```bash
pnpm --filter yidhras-server exec prisma migrate deploy
```

### 适用场景

- 已有数据库，只想升级 schema；
- 运行时 scaffold/world pack 不需要重复初始化；
- CI / 部署阶段只做 migration apply。

### 不建议直接跳过的情况

如果是全新环境，通常不要只做 migration，因为还需要：

- runtime config scaffold
- bootstrap world pack
- identity seed

所以新环境通常还是应优先：

```bash
pnpm prepare:runtime
```

---

## 5. 运行时初始化步骤说明

数据库迁移之外，当前服务启动还依赖以下初始化动作。

## 5.1 `init:runtime`

命令：

```bash
pnpm --filter yidhras-server init:runtime
```

对应实现：

- `apps/server/src/init/prepare_runtime.ts`

职责：

- 确保 runtime config scaffold 存在、bootstrap world pack 已准备；
- 输出 runtime config snapshot（便于确认最终生效值）与初始化报告。

snapshot 中会包含 `app_port`、`world_packs_dir`、`sqlite_*`、`scheduler_*` 等运行参数。如需调优，参见 [`ARCH.md`](../ARCH.md) 第 2.4 节与 [`COMMANDS.md`](./COMMANDS.md) 第 2.6 节。

## 5.2 `seed:identity`

命令：

```bash
pnpm --filter yidhras-server seed:identity
```

对应实现：

- `apps/server/src/db/seed_identity.ts`

职责：

- upsert 系统 identity / agent identity；
- 创建基础 policy；
- 创建基础 identity binding / atmosphere node；
- 让最小运行链路可工作。

> 当前 seed 是“确保基础记录存在”的思路，不是面向生产多租户/复杂回填的通用数据导入器。

---

## 6. 本地开发数据库重置

如果你是在本地开发环境，想完全重建默认 SQLite 数据库，可使用：

```bash
pnpm --filter yidhras-server reset:dev-db
```

对应实现：

- `apps/server/src/init/reset_dev_db.ts`

这个脚本会：

1. 检查是否仍有 server 进程在运行；
2. 删除默认开发数据库文件：
   - `data/yidhras.sqlite`
   - `data/yidhras.sqlite-wal`
   - `data/yidhras.sqlite-shm`
3. 重新执行：
   - `prisma migrate deploy`
   - `init:runtime`
   - `seed:identity`

### 什么时候可以用

- 本地开发环境状态混乱；
- migration 试验后想重来；
- 你明确知道当前数据库没有需要保留的数据。

### 什么时候不要用

- 生产环境；
- 任何你还想保留现有数据的环境；
- 自定义了 `DATABASE_URL` 指向别的数据库文件，但仍误以为它会自动重置该文件。

> 注意：当前 `reset:dev-db` 针对的是默认工作区数据库文件 `data/yidhras.sqlite`，不是任意 `DATABASE_URL` 目标。
> 如果你已经改了 `DATABASE_URL`，请不要假设这个脚本会帮你删除新路径下的数据库文件。

---

## 7. 部署者最小操作手册

## 7.1 全新 SQLite 环境

推荐顺序：

1. 配置 `DATABASE_URL`
2. 安装依赖
3. 执行 `pnpm prepare:runtime`
4. 启动 server

示例：

```bash
cp apps/server/.env.example apps/server/.env   # 如果你自己维护环境文件
# 编辑 DATABASE_URL
pnpm install
pnpm prepare:runtime
pnpm dev:server
```

如果你不单独维护 `.env`，也可以直接在 shell 中注入：

```bash
DATABASE_URL="file:/srv/yidhras/yidhras.sqlite" pnpm --filter yidhras-server prepare:runtime
DATABASE_URL="file:/srv/yidhras/yidhras.sqlite" pnpm --filter yidhras-server start
```

## 7.2 已有数据库升级

如果数据库文件已存在，且你只是部署新版本：

```bash
pnpm --filter yidhras-server exec prisma migrate deploy
pnpm --filter yidhras-server start
```

如果你不确定 runtime scaffold / bootstrap 是否已准备，也可直接：

```bash
pnpm prepare:runtime
```

## 7.3 仅修复 identity seed

如果 schema 已经是最新，只想补基础 identity：

```bash
pnpm --filter yidhras-server seed:identity
```

---

## 8. 数据库文件位置更换

当前第一阶段数据库边界治理的目标之一，是“继续用 Prisma，但让迁移/更换更容易”。

对部署者来说，**最现实、最低风险的“更换”首先是更换数据库文件位置**，而不是立刻切换 ORM。

## 8.1 更换 SQLite 文件路径

你只需要修改：

- `DATABASE_URL`

例如从默认：

```env
DATABASE_URL="file:../../../data/yidhras.sqlite"
```

改成：

```env
DATABASE_URL="file:/srv/yidhras/db/prod.sqlite"
```

然后执行：

```bash
pnpm --filter yidhras-server exec prisma migrate deploy
pnpm --filter yidhras-server start
```

如果是全新文件：

```bash
pnpm prepare:runtime
```

## 8.2 更换时要确认的事项

请确认：

1. 新路径所在目录可写；
2. 启动用户对目录与文件有权限；
3. 旧数据库文件没有仍在被运行中的 server 占用；
4. 你的备份/快照策略也一起更新；
5. 如果用了相对路径，执行目录变化不会导致实际文件位置漂移。

---

## 9. 更换数据库后端时的现实说明

当前仓库在 Prisma schema 中使用的是：

```prisma
provider = "sqlite"
```

这意味着：

- **简单改一个 `DATABASE_URL`，不能直接切到 PostgreSQL/MySQL**；
- 真正切换数据库后端时，至少还需要：
  1. 修改 `schema.prisma` 中 datasource provider；
  2. 重新生成 Prisma Client；
  3. 重新处理 migration；
  4. 检查 SQLite 特有假设（文件路径、锁、sidecar 文件、开发脚本等）。

### 当前建议

第一阶段已经把 repository/store 边界收口得更清晰了，但**部署者层面的推荐做法仍然是：优先继续使用 Prisma + SQLite，只调整数据库文件位置、迁移顺序和初始化流程**。

如果你真要切换数据库后端，建议至少做这些准备：

- 单独立项；
- 先确认 `schema.prisma` 是否能无损迁移；
- 审查所有与 SQLite 文件语义耦合的脚本：
  - `reset_dev_db.ts`
  - `SimulationManager.prepareDatabase()` 中的 SQLite pragma
  - 各类“database is locked”相关经验和重试逻辑
- 在测试环境做完整迁移演练，而不是直接在现有环境上改。

---

## 10. 常见坑 / 排障说明

## 10.1 `Run prisma migrate deploy before ...`

当前多个子系统会在缺表时给出明确错误，例如：

- plugin tables
- context overlay tables
- memory block tables

如果你看到类似报错：

- `Run prisma migrate deploy before using pack-local plugins`
- `Run prisma migrate deploy before creating overlay entries`
- `Run prisma migrate deploy before using long memory blocks`

说明通常不是业务错误，而是：

- 数据库 schema 还没迁移到当前版本。

优先执行：

```bash
pnpm --filter yidhras-server exec prisma migrate deploy
```

如果是新环境，再补：

```bash
pnpm prepare:runtime
```

## 10.2 SQLite `database is locked`

这是 SQLite 常见问题，尤其在：

- 多进程同时写；
- dev server 未停就删库；
- 长事务未释放；
- 文件位于不稳定挂载路径；
- 某些工具占用数据库文件。

建议：

1. 确认只有一个主 server 进程在操作该 SQLite 文件；
2. 本地重置数据库前先停掉 dev server；
3. 不要把 SQLite 文件放在网络盘/同步盘等高风险位置；
4. 生产场景如果写入并发继续升高，应评估是否需要单独立项迁移数据库后端。

## 10.3 修改了 `DATABASE_URL`，但看起来没生效

常见原因：

- 修改的是错误的 `.env` 文件；
- shell 里已有同名环境变量覆盖；
- 使用了相对路径，但以不同 cwd 执行；
- 你修改了数据库文件路径，但 `reset:dev-db` 仍然只操作默认 `data/yidhras.sqlite`。

建议检查：

- `apps/server/.env`
- shell 当前环境变量
- server 启动日志中的 runtime config snapshot
- 实际生成的数据库文件路径

## 10.4 `prepare:runtime` 跑完了但启动仍失败

请依次检查：

1. `DATABASE_URL` 是否可写；
2. `WORLD_PACKS_DIR` / runtime config 是否正确；
3. world pack bootstrap 是否成功；
4. `seed:identity` 是否执行成功；
5. 当前数据库 schema 是否与当前代码版本匹配。

可以拆开执行定位：

```bash
pnpm --filter yidhras-server exec prisma migrate deploy
pnpm --filter yidhras-server init:runtime
pnpm --filter yidhras-server seed:identity
pnpm --filter yidhras-server start
```

---

## 11. 相关文档

- 命令入口矩阵：[`COMMANDS.md`](./COMMANDS.md)
- 架构边界与配置优先级：[`ARCH.md`](../ARCH.md)
- World Pack 规范：[`WORLD_PACK.md`](../WORLD_PACK)
- 文档导航：[`INDEX.md`](../INDEX.md)