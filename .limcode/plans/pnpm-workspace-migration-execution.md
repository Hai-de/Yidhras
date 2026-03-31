## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义迁移验收标准与执行顺序  `#plan-pnpm-acceptance`
- [x] 明确 pnpm/workspace 迁移范围、非范围、风险与回滚点  `#plan-pnpm-scope`
- [x] 列出根 package.json、pnpm-workspace.yaml、脚本/CI/启动脚本/文档更新步骤  `#plan-pnpm-steps`
<!-- LIMCODE_TODO_LIST_END -->

# pnpm / Workspace 迁移执行文档

## 目标

将当前仓库从以 `npm --prefix apps/*` 为主的分散式管理，迁移为 **pnpm workspace** 管理模式，为后续 `packages/contracts` 纯契约包接入提供基础设施。

本次任务只建立 workspace 与命令基线，不引入 Zod、不新增 contracts 包、不进行 docs 目录迁移。

---

## 范围

### In Scope

- 新增根目录 `package.json`
- 新增 `pnpm-workspace.yaml`
- 建立 workspace 包边界：
  - `apps/*`
  - `packages/*`
- 引入根级 `pnpm-lock.yaml`
- 删除/停止使用 npm lockfile（各 app 下 `package-lock.json`）
- 将常用开发命令切换到 pnpm 风格
- 更新启动脚本：
  - `start-dev.sh`
  - `start-dev.bat`
- 更新 CI：
  - `.github/workflows/server-smoke.yml`
- 更新包管理器相关文档与命令说明：
  - `README.md`
  - `AGENTS.md`
  - `apps/web/README.md`
  - 如有必要同步 `apps/server/package.json` / `apps/web/package.json` 的脚本描述

### Out of Scope

- 不引入 `zod`
- 不引入 `zod-validation-error`
- 不创建 `packages/contracts`
- 不修改 API 契约
- 不进行 response/runtime schema 校验
- 不迁移 `API.md` / `ARCH.md` / `LOGIC.md` 到 `docs/`

---

## 设计原则

1. **先铺地基，再接 contracts**：workspace 先稳定，后续纯契约包才能自然接入。
2. **命令入口尽量统一到根目录**：减少 `--prefix` 心智负担。
3. **不在本次任务中混入业务改造**：避免 diff 爆炸。
4. **保证回滚简单**：如 workspace 方案未跑通，可先回退到原 app 内独立包模式。

---

## 建议产物

### 1. 根目录 `package.json`
建议内容方向：
- `private: true`
- `packageManager: "pnpm@<version>"`
- 根 scripts，例如：
  - `dev:server`
  - `dev:web`
  - `dev`
  - `build`
  - `lint`
  - `typecheck`
  - `smoke:server`

### 2. 根目录 `pnpm-workspace.yaml`
建议：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 3. 锁文件
- 生成根级 `pnpm-lock.yaml`
- 删除：
  - `apps/server/package-lock.json`
  - `apps/web/package-lock.json`

### 4. 启动脚本
- 将 `start-dev.sh` / `start-dev.bat` 中的 `npm install --prefix ...`、`npm run ... --prefix ...` 改为 pnpm workspace 命令
- 优先采用 workspace filter 风格，例如：
  - `pnpm --filter yidhras-server dev`
  - `pnpm --filter web dev`
  或统一根脚本转发

### 5. CI
- 安装 pnpm
- 使用 Node + pnpm cache
- 将 smoke / prepare / install 命令切换为 pnpm

---

## 实施步骤

### Step 1：建立 workspace 根配置
- 新增根 `package.json`
- 新增 `pnpm-workspace.yaml`
- 确认 `apps/server/package.json` 与 `apps/web/package.json` 的 `name` 字段可用于 filter

### Step 2：安装与锁文件切换
- 在根执行 pnpm install
- 生成根 `pnpm-lock.yaml`
- 删除 app 内 `package-lock.json`
- 验证 node_modules 布局与依赖安装正常

### Step 3：统一根脚本
建议至少提供：
- `pnpm dev:server`
- `pnpm dev:web`
- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm smoke:server`

如果需要并发运行，可后续补充，但本次不强制引入额外任务编排工具。

### Step 4：迁移启动脚本
- 更新 `start-dev.sh`
- 更新 `start-dev.bat`
- 确保开发者不必再依赖 `npm --prefix`

### Step 5：迁移 CI
- 更新 `.github/workflows/server-smoke.yml`
- 将 install / prepare / smoke 命令切换至 pnpm
- 验证 workflow 逻辑仍与当前 runtime prepare 流程一致

### Step 6：更新文档
至少更新：
- `README.md`
- `AGENTS.md`
- `apps/web/README.md`

说明：
- 包管理器已从 npm 切换为 pnpm
- workspace 已启用
- 原先 `npm --prefix ...` 命令如仍保留，只能作为迁移说明，不再作为主路径

---

## 风险点

### 1. 脚本路径/命令习惯失效
现有 README、AGENTS、启动脚本、CI 很多命令默认 npm，需要全链路同步。

### 2. 依赖提升行为变化
pnpm 的依赖隔离更严格，可能暴露隐式依赖问题。

### 3. CI 缓存与安装逻辑变化
若 workflow 只替换 install 命令但未正确 setup pnpm，会导致失败。

### 4. 开发者本地习惯成本
需要明确：今后主路径是 `pnpm`，不是 `npm`。

---

## 回滚点

若迁移失败，回滚最小集合为：
- 删除根 `package.json`（若仅用于 workspace）与 `pnpm-workspace.yaml`
- 恢复 app 内 lockfile 或回退到 npm install
- 恢复 `start-dev.*` 和 CI 命令

注意：建议将 workspace 迁移作为独立提交，便于整体回滚。

---

## 验收标准

### 必须满足
- 能在根目录执行 `pnpm install`
- 能在根目录执行后端/前端开发命令
- 能在根目录执行 lint/typecheck/build（至少能正确转发）
- `start-dev.sh` / `start-dev.bat` 可用
- `.github/workflows/server-smoke.yml` 已切换到 pnpm
- 文档主命令已切换为 pnpm
- app 内 npm lockfile 已移除

### 不要求本次满足
- 不要求引入 contracts
- 不要求 Zod 接入
- 不要求 docs 目录重组

---

## 执行顺序建议

本任务应作为三条主线中的**第一条**先执行：
1. pnpm / workspace 迁移
2. contracts + Zod 边界接入
3. docs 目录迁移与原则固化

这样后续 `packages/contracts` 可直接建立在 workspace 基础上。
