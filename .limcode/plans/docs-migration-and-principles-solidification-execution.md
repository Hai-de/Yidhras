## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义 docs 迁移任务的验收标准与风险控制  `#plan-docs-acceptance`
- [x] 明确 docs 迁移范围、根目录保留文件、非范围与迁移顺序  `#plan-docs-scope`
- [x] 列出 docs 目录结构、文档搬迁、互链修复、索引整理与原则写入步骤  `#plan-docs-steps`
<!-- LIMCODE_TODO_LIST_END -->

# Docs 目录迁移与原则固化执行文档

## 目标

在 pnpm workspace 与 contracts/Zod 边界接入稳定后，独立执行一次文档重排：将适合的专题文档迁移到统一 `docs/` 目录，修复互链，并把已达成的工程原则正式固化到文档体系中。

本任务独立执行，避免与代码重构混在同一批 diff 中。

---

## 范围

### In Scope

- 新增统一的 `docs/` 目录结构
- 将适合的专题文档从根目录迁移到 `docs/`
- 维护根目录入口与索引
- 修复 README / AGENTS / 各文档之间的相互引用路径
- 将以下原则正式写入文档：
  - Zod schema 是 transport / contract 层资产，不直接等于业务规则实现
  - 共享 contract 优先服务 API 边界稳定，不追求第一轮覆盖后端全部内部模型
  - BigInt over HTTP 一律以 string 传输，前端按需显式转换
- 对旧交接/历史文档做归档或废弃标记

### Out of Scope

- 不修改业务代码
- 不继续推进 pnpm/workspace
- 不继续推进 contracts/Zod 接入实现
- 不做前端 UI 设计文档重写（除非仅涉及路径迁移）

---

## 根目录保留策略

建议根目录保留：
- `README.md`
- `AGENTS.md`
- `TODO.md`
- `LICENSE`

这些文件继续作为仓库入口层资产存在。

---

## 建议迁移到 `docs/` 的文档

优先建议迁移：
- `API.md`
- `ARCH.md`
- `LOGIC.md`
- 其他后续专题文档
- 历史性交接/专题说明文档（如未来还有类似 handoff 文档）

可根据需要建立子目录，例如：

```text
docs/
  architecture/
  api/
  logic/
  migration/
  history/
```

也可以先保守落地为扁平结构，再后续细分。

---

## 迁移原则

1. **根目录保留入口，不保留散乱专题文档**。
2. **迁移作为独立任务处理**，避免与代码实现 diff 混杂。
3. **路径迁移后先保证可读性和可导航性**，再追求更细的分层。
4. **文档内容以当前实现为准**，避免把历史意图继续伪装成现状。

---

## 实施步骤

### Step 1：建立 `docs/` 结构
根据实际规模，选择：

#### 保守版
```text
docs/
  API.md
  ARCH.md
  LOGIC.md
```

#### 分层版
```text
docs/
  api/API.md
  architecture/ARCH.md
  logic/LOGIC.md
```

推荐先保守版，降低路径调整成本。

### Step 2：迁移专题文档
- 将 `API.md`、`ARCH.md`、`LOGIC.md` 迁移至 `docs/`
- 如存在其他专题/历史文档，也同步整理

### Step 3：更新根 README 索引
在根 `README.md` 中新增文档索引区：
- Architecture
- API
- Logic
- TODO / Milestones
- Agent guidance

### Step 4：修复互链与引用
至少检查并更新：
- `README.md`
- `AGENTS.md`
- `apps/web/README.md`
- `TODO.md`
- 各 docs 之间互链

### Step 5：固化原则
将以下原则正式写入合适文档（建议 `ARCH.md` 或 docs 中专门的 conventions section）：
- Zod schema = transport/contract 资产
- 共享 contract 不追求第一轮覆盖全部内部模型
- BigInt over HTTP = string

### Step 6：处理历史文档
- 对已过时 handoff / 临时说明做：
  - 删除
  - 归档
  - 或标明 historical / obsolete

---

## 风险点

### 1. 路径迁移导致引用失效
需要系统检查所有文档中的相对路径。

### 2. 迁移与代码改造并行导致内容冲突
因此必须在代码主线稳定后单独执行。

### 3. 根目录完全搬空会降低入口可发现性
因此保留 `README.md` / `AGENTS.md` / `TODO.md` 作为顶层入口。

---

## 回滚点

- 如 docs 迁移导致路径混乱，可整体回滚该独立提交
- 根目录入口文档应始终保留，便于回退时不影响仓库可导航性

---

## 验收标准

### 必须满足
- `docs/` 目录已建立
- `API.md` / `ARCH.md` / `LOGIC.md` 已迁移或按新结构落位
- 根 `README.md` 已提供稳定文档索引
- 文档互链已修复
- 两条 Zod/contract 原则与 BigInt string 规则已正式写入文档
- 根目录仍保留入口文档：`README.md`、`AGENTS.md`、`TODO.md`

### 本次不要求
- 不要求修改业务代码
- 不要求新增更多技术文档生成体系

---

## 执行顺序建议

本任务应作为三条主线中的**第三条**最后执行：
1. pnpm / workspace 迁移
2. contracts + Zod 边界接入
3. docs 目录迁移与原则固化

这样文档内容可以直接反映重构后的稳定现实，而不是中间态。
