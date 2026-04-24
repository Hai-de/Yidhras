## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] P0-1：InferenceContext 配置 Schema 设计 — 定义 inference_context.yaml 的 Zod Schema，覆盖 variable layers、transmission profile、policy summary 三大硬编码区域  `#icc-plan-p0-1`
- [x] P0-2：配置加载基础设施 — 实现 `src/inference/context_config.ts`（loader + merger + cache），机制对标 `runtime_config.ts`，文件路径 `data/configw/inference_context.yaml`  `#icc-plan-p0-2`
- [x] P0-3：`buildInferenceVariableContext` 配置化重构 — 从硬编码 6 层改为读取配置中的 `variable_layers` 定义，支持覆盖/追加/禁用默认层  `#icc-plan-p0-3`
- [x] P0-4：`buildTransmissionProfile` 配置化重构 — 将 SNR 阈值、drop chance 映射、explicit policy 处理规则提取到配置  `#icc-plan-p0-4`
- [x] P0-5：`buildPolicySummary` 配置化重构 — 将 access policy 评估的 resource、action、fields 列表提取到配置  `#icc-plan-p0-5`
- [x] P1-1：`PackScopedInferenceContextBuilder` 接线 — 在 `buildForPack` 中注入配置对象，确保所有配置化子模块能读取到当前激活的配置  `#icc-plan-p1-1`
- [x] P1-2：默认配置文件模板 — 提供 `data/configw/templates/inference_context.default.yaml`，文档化所有可配置项  `#icc-plan-p1-2`
- [x] P1-3：单元测试覆盖 — 测试配置加载、合并、缺省回退、Schema 校验失败场景  `#icc-plan-p1-3`
- [x] P1-4：集成验证 — 运行 `pnpm typecheck` + server 单元测试，确认运行时行为不变  `#icc-plan-p1-4`
- [ ] P2-1：部署级配置基础设施 — 扩展 `context_config.ts` 支持 `getInferenceContextConfig(deploymentId?)`、per-deployment 缓存、`inference_context.d/{id}.yaml` 加载  `#icc-plan-p2-1`
- [ ] P2-2：`context_builder.ts` 接入 deployment_id — `buildForPack` 读取 `YIDHRAS_DEPLOYMENT_ID` 并显式传递给下游配置消费函数  `#icc-plan-p2-2`
- [ ] P2-3：部署级配置单元测试 — 覆盖加载、合并、缓存隔离、缺省回退、环境变量仍覆盖部署级  `#icc-plan-p2-3`
- [ ] P2-4：集成验证 — 运行 `pnpm typecheck` + server 单元测试  `#icc-plan-p2-4`
<!-- LIMCODE_TODO_LIST_END -->

# InferenceContext 配置化分发计划

## 1. 问题诊断

### 1.1 硬编码的变量层构建

`context_builder.ts` 中 `buildInferenceVariableContext` 函数硬编码了 6 个 `PromptVariableLayer`：

```typescript
// system、app、pack、runtime、actor、request — 全部写死在代码中
```

- 世界包作者无法调整变量层的 namespace、values、alias_values
- 无法添加自定义层（如 `plugin`、`operator_override`）
- 无法调整 `alias_precedence` 顺序
- 无法禁用某个默认层

### 1.2 硬编码的传输策略

`buildTransmissionProfile` 中的阈值和计算逻辑全部硬编码：

```typescript
const actorSNR = agentSnapshot?.snr ?? 0.5;
const basePolicy = readRestricted ? 'best_effort' : actorSNR < 0.3 ? 'fragile' : 'reliable';
const dropChance = explicitDropChance ?? (basePolicy === 'fragile' ? 0.35 : basePolicy === 'best_effort' ? 0.15 : 0);
```

- SNR 阈值 `0.3`、drop chance `0.35` / `0.15` 不可调
- 政策映射规则不可调
- 无法为世界包定义自定义传输策略模板

### 1.3 硬编码的访问策略字段

`buildPolicySummary` 中评估的 resource、action、fields 列表写死：

```typescript
await service.evaluateFields({ identity, resource: 'social_post', action: 'read', attributes }, ['id', 'author_id', ...]);
```

- 只能评估 `social_post`，无法配置其他 resource
- 字段列表不可扩展
- 无法定义自定义 policy 规则集

### 1.4 与世界包配置的关系

当前世界包 `config.yaml`（`constitution_schema.ts`）已包含 `ai`、`prompts`、`variables` 等配置段，但 **InferenceContext 的组装过程完全不读取这些配置**。`buildInferenceContext` 是一个封闭的黑盒，世界包作者只能通过间接方式（如在 `variables` 中定义值，然后被 `pack` 变量层读取）影响推理上下文。

---

## 2. 目标

> 让 InferenceContext 的组装过程从"封闭黑盒"变为"配置驱动"，世界包作者和运维人员可以通过 YAML 配置文件调整推理上下文的构造方式，而无需修改代码。

具体目标：

1. **显性依赖**：所有影响 InferenceContext 组装的参数都暴露在配置中
2. **分层覆盖**：内置默认值 → 文件覆盖 → 环境变量覆盖 → 世界包局部覆盖
3. **向后兼容**：未提供配置文件时，行为与当前完全一致（100% 兼容）
4. **类型安全**：使用 Zod Schema 验证配置，TypeScript 类型推导完整
5. **最小侵入**：不改动 `InferenceContext` / `ActorResolvable` 等核心类型定义

---

## 3. 配置 Schema 设计

### 3.1 文件位置

```
data/configw/
  default.yaml              # runtime config（已有）
  local.yaml                # runtime config 本地覆盖（已有）
  inference_context.yaml     # ← 新增：InferenceContext 配置
  templates/
    inference_context.default.yaml  # ← 新增：配置模板与文档
```

### 3.2 顶层结构

```yaml
# inference_context.yaml
config_version: 1

variable_context:
  alias_precedence: [system, app, pack, runtime, actor, request]
  strict_namespace: false
  layers:
    system:
      enabled: true
      values:
        name: Yidhras
        timezone: Asia/Shanghai
      alias_values:
        system_name: "{{name}}"
        timezone: "{{timezone}}"
    app:
      enabled: true
      values:
        startup_health: "{{app.startup_health}}"
      alias_values:
        startup_level: "{{app.startup_health.level}}"
    pack:
      enabled: true
      values:
        metadata: "{{pack.metadata}}"
        variables: "{{pack.variables}}"
        prompts: "{{pack.prompts}}"
        ai: "{{pack.ai}}"
      alias_values:
        world_name: "{{pack.metadata.name}}"
        pack_id: "{{pack.metadata.id}}"
    runtime:
      enabled: true
      values:
        current_tick: "{{runtime.current_tick}}"
        pack_state: "{{runtime.pack_state}}"
        pack_runtime: "{{runtime.pack_runtime}}"
        world_state: "{{runtime.pack_state.world_state}}"
        owned_artifacts: "{{runtime.pack_state.owned_artifacts}}"
        latest_event: "{{runtime.pack_state.latest_event}}"
      alias_values:
        current_tick: "{{runtime.current_tick}}"
        world_state: "{{runtime.pack_state.world_state}}"
    actor:
      enabled: true
      values:
        identity_id: "{{actor.identity.id}}"
        identity_type: "{{actor.identity.type}}"
        display_name: "{{actor.display_name}}"
        role: "{{actor.role}}"
        binding_ref: "{{actor.binding_ref}}"
        agent_id: "{{actor.agent_id}}"
        agent_snapshot: "{{actor.agent_snapshot}}"
      alias_values:
        actor_name: "{{actor.display_name}}"
        actor_role: "{{actor.role}}"
        actor_id: "{{actor.agent_id ?? actor.identity.id}}"
    request:
      enabled: true
      values:
        task_type: agent_decision
        strategy: "{{request.strategy}}"
        attributes: "{{request.attributes}}"
        agent_id: "{{request.agent_id}}"
        identity_id: "{{request.identity_id}}"
        idempotency_key: "{{request.idempotency_key}}"
      alias_values:
        strategy: "{{request.strategy}}"
        task_type: agent_decision

transmission_profile:
  defaults:
    snr_fallback: 0.5
    delay_ticks_fallback: "1"
  thresholds:
    fragile_snr: 0.3
  drop_chances:
    fragile: 0.35
    best_effort: 0.15
    reliable: 0.0
  policies:
    read_restricted_base: best_effort
    low_snr_base: fragile
    default_base: reliable

policy_summary:
  evaluations:
    - resource: social_post
      action: read
      fields:
        - id
        - author_id
        - content
        - created_at
        - content.private.preview
        - content.private.raw
    - resource: social_post
      action: write
      fields:
        - content
```

### 3.3 Zod Schema（TypeScript 侧）

```typescript
// src/inference/context_config_schema.ts
const inferenceContextConfigVersionSchema = z.number().int().positive();

const variableLayerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  values: z.record(z.string(), z.unknown()).default({}),
  alias_values: z.record(z.string(), z.unknown()).optional()
}).strict();

const variableContextConfigSchema = z.object({
  alias_precedence: z.array(z.string()).optional(),
  strict_namespace: z.boolean().optional(),
  layers: z.record(z.string(), variableLayerConfigSchema).optional()
}).strict();

const transmissionProfileConfigSchema = z.object({
  defaults: z.object({
    snr_fallback: z.number().min(0).max(1).optional(),
    delay_ticks_fallback: z.string().optional()
  }).strict().optional(),
  thresholds: z.object({
    fragile_snr: z.number().min(0).max(1).optional()
  }).strict().optional(),
  drop_chances: z.object({
    fragile: z.number().min(0).max(1).optional(),
    best_effort: z.number().min(0).max(1).optional(),
    reliable: z.number().min(0).max(1).optional()
  }).strict().optional(),
  policies: z.object({
    read_restricted_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional(),
    low_snr_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional(),
    default_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional()
  }).strict().optional()
}).strict();

const policyEvaluationConfigSchema = z.object({
  resource: z.string(),
  action: z.string(),
  fields: z.array(z.string())
}).strict();

const policySummaryConfigSchema = z.object({
  evaluations: z.array(policyEvaluationConfigSchema).optional()
}).strict();

export const inferenceContextConfigSchema = z.object({
  config_version: inferenceContextConfigVersionSchema,
  variable_context: variableContextConfigSchema.optional(),
  transmission_profile: transmissionProfileConfigSchema.optional(),
  policy_summary: policySummaryConfigSchema.optional()
}).strict();

export type InferenceContextConfig = z.infer<typeof inferenceContextConfigSchema>;
```

---

## 4. 配置加载机制

### 4.1 加载顺序（与 runtime config 一致）

```
内置默认值  →  data/configw/inference_context.yaml  →  环境变量覆盖
```

### 4.2 环境变量映射

| 环境变量 | 配置路径 | 类型 |
|---|---|---|
| `ICC_SNR_FALLBACK` | `transmission_profile.defaults.snr_fallback` | number |
| `ICC_FRAGILE_SNR` | `transmission_profile.thresholds.fragile_snr` | number |
| `ICC_FRAGILE_DROP_CHANCE` | `transmission_profile.drop_chances.fragile` | number |
| `ICC_BEST_EFFORT_DROP_CHANCE` | `transmission_profile.drop_chances.best_effort` | number |
| `ICC_POLICY_STRICT_NAMESPACE` | `variable_context.strict_namespace` | boolean |

### 4.3 模块设计

```
src/inference/
  context_config_schema.ts    # Zod Schema
  context_config.ts           # 加载器、合并器、缓存、getter
```

`context_config.ts` 接口：

```typescript
export const getInferenceContextConfig = (): InferenceContextConfig;
export const resetInferenceContextConfigCache = (): void;
export const buildInferenceContextConfigSnapshot = (): Record<string, unknown>;
```

---

## 5. 与现有代码的集成点

### 5.1 `buildInferenceVariableContext`

**当前**：函数内部硬编码 6 个 `createPromptVariableLayer(...)` 调用。

**变更后**：
1. 读取 `getInferenceContextConfig().variable_context`
2. 遍历配置的 `layers`，对每个 `enabled: true` 的层，用配置中的 `values` / `alias_values` 构建 `PromptVariableLayer`
3. 对于包含模板表达式（如 `"{{pack.metadata}}"`）的值，在构建时从当前运行时对象中解析
4. 如果配置未提供某层，回退到硬编码默认行为

**关键设计**：值的模板表达式不是字符串替换，而是 **构建时求值**。例如 `"{{pack.metadata}}"` 表示"将运行时 `pack.metadata` 对象作为值放入"。这需要一个轻量级的模板解析器。

### 5.2 `buildTransmissionProfile`

**当前**：硬编码阈值和计算逻辑。

**变更后**：
1. 读取 `getInferenceContextConfig().transmission_profile`
2. 用配置值替换所有魔法数字
3. 如果配置未提供某项，使用函数内的常量默认值

### 5.3 `buildPolicySummary`

**当前**：硬编码 `social_post` read/write 评估。

**变更后**：
1. 读取 `getInferenceContextConfig().policy_summary.evaluations`
2. 遍历 evaluations 数组，对每个条目调用 `service.evaluateFields`
3. 将结果聚合为 `InferencePolicySummary`
4. 如果配置未提供，回退到当前硬编码行为

### 5.4 `createPackScopedInferenceContextBuilder`

在 `buildForPack` 开头调用 `getInferenceContextConfig()`，将配置对象传递给下游函数。由于配置 getter 是全局单例，也可以不传递、让各函数自行读取。

---

## 6. 模板值解析器设计

配置中的 `values` 和 `alias_values` 可能包含模板表达式，需要一个小型解析器在构建时求值。

### 6.1 表达式语法

| 表达式 | 含义 |
|---|---|
| `"{{pack.metadata}}"` | 从运行时 `pack.metadata` 取值 |
| `"{{actor.display_name}}"` | 从运行时 `actor.display_name` 取值 |
| `"{{actor.agent_id ?? actor.identity.id}}"` | 带默认值回退 |
| `"Yidhras"` | 普通字符串字面量（非模板） |
| `true` / `123` | 非字符串值直接传递 |

### 6.2 实现策略

为避免引入复杂模板引擎，采用约定：
- 只有 `string` 类型的值才检查是否以 `"{{"` 开头并以 `"}}"` 结尾
- 内部使用简单的路径解析（如 `pack.metadata` → `runtimeObjects.pack.metadata`）
- 不支持嵌套表达式或复杂逻辑，保持极简

解析器位置：`src/inference/context_config_resolver.ts`

---

## 7. 实施步骤

### Phase 0：基础设施

1. 创建 `src/inference/context_config_schema.ts` — Zod Schema
2. 创建 `src/inference/context_config.ts` — 加载器 + 合并器 + getter
3. 创建 `data/configw/templates/inference_context.default.yaml` — 默认配置模板
4. 在 `src/inference/context_builder.ts` 中引入 `getInferenceContextConfig()`

### Phase 1：逐个配置化

5. 重构 `buildInferenceVariableContext` — 使用配置的 variable layers
6. 重构 `buildTransmissionProfile` — 使用配置的 thresholds / drop_chances
7. 重构 `buildPolicySummary` — 使用配置的 evaluations

### Phase 2：验证与收尾

8. 运行 `pnpm typecheck`
9. 运行 server 单元测试
10. 更新相关文档

---

## 8. 验收标准

- [ ] 未提供 `inference_context.yaml` 时，所有行为与重构前 100% 一致
- [ ] 提供自定义配置后，`buildInferenceVariableContext` 生成的 `PromptVariableContext` 反映配置变更
- [ ] `buildTransmissionProfile` 的阈值和 drop chance 可从配置调整
- [ ] `buildPolicySummary` 的 resource/action/fields 可从配置调整
- [ ] Zod Schema 对非法配置给出明确错误
- [ ] 环境变量可覆盖配置项
- [ ] 单元测试覆盖配置加载、合并、缺省、校验失败场景
- [ ] `pnpm typecheck` 通过
- [ ] server 单元测试全部通过（或仅预存失败）

---

## 9. 风险与规避

| 风险 | 影响 | 规避措施 |
|---|---|---|
| 模板表达式解析过于复杂 | 引入不必要的 DSL 复杂度 | 限制表达式语法：仅支持 `{{path}}` 和 `{{path ?? fallback}}` |
| 配置与代码不同步 | 配置项改名但文档未更新 | Schema 版本号 + 运行时校验，拒绝未知字段（`.strict()`） |
| 性能下降 | 每次推理都读取文件 | 使用全局缓存，仅在启动时或 `reset` 时重新加载 |
| 向后兼容破坏 | 旧部署无配置文件导致行为变更 | 所有配置项都有硬编码默认值，配置文件是可选的 |

---

## 10. 相关文档

- `docs/LOGIC.md` — InferenceContext 组装逻辑（需更新以反映配置化）
- `docs/WORLD_PACK.md` — 世界包配置说明（需新增 inference_context 配置段）
- `.limcode/design/inference-context-interface-decomposition-design.md` — 接口拆分设计（已完成）

---

## Phase 2：部署级配置（Deployment-Level Config）

### 背景与动机

Phase 1 完成后，InferenceContext 配置体系支持三级加载链：

```
内置默认值 → 站点级文件 → 环境变量
```

这无法满足未来以下场景：

1. **多用户/多租户隔离**：不同用户需要独立的 inference context 配置（如不同的 SNR 阈值、变量层定义）
2. **多包并发运行**：系统同时加载多个世界包，每个包实例可能需要不同的传输策略或策略评估字段
3. **同包多部署**：同一个世界包（如 `cyberpunk-city`）可以被部署为 `prod`、`dev`、`staging` 等多个实例，各自有不同的推理上下文配置（如 dev 环境使用更宽松的 drop chance，prod 环境使用更严格的策略）

这些场景的共同点是：**配置需要绑定到「部署实例」而非「世界包」或「站点」**。世界包 `config.yaml` 是打包时静态的，站点级配置是全局的，都无法表达「同一个包在不同部署中行为不同」的需求。

### 设计原则

- **新增一层，不破坏现有链**：部署级配置插入在站点级与环境变量之间
- **向后 100% 兼容**：无 `deployment_id` 时，行为与 Phase 1 完全一致
- **Schema 复用**：部署级配置文件与站点级使用完全相同的 Zod Schema，不引入新字段
- **懒加载 + 隔离缓存**：per-deployment 配置文件按需加载并缓存，各 deployment 缓存互不干扰
- **最小侵入**：不改动 `InferenceContext` / `ActorResolvable` 等核心类型，只扩展配置加载器和 builder 接线

### 更新后的加载链

```
L1: BUILTIN_DEFAULTS     (src/inference/context_config.ts 内嵌)
  ↓ deepMerge
L2: SITE_CONFIG          (data/configw/inference_context.yaml)
  ↓ deepMerge
L3: DEPLOYMENT_CONFIG    (data/configw/inference_context.d/{deployment_id}.yaml)  ← 新增
  ↓ deepMerge
L4: ENV_OVERRIDES        (ICC_* 环境变量)
```

合并规则与 Phase 1 一致：深层合并，上层覆盖下层同路径值。

### 文件路径约定

```
data/configw/
  inference_context.yaml                    # L2: 站点级（已有）
  inference_context.d/                      # L3: 部署级配置目录（新增）
    prod.yaml
    dev.yaml
    staging.yaml
    alice.yaml                              # 也可以是用户/租户级，由 deployment_id 语义决定
```

**解析规则**：
- `deployment_id` 只能包含 `[a-zA-Z0-9_-]`，其他字符视为非法，直接拒绝加载
- 配置文件名：`{deployment_id}.yaml`
- 如果文件不存在，不产生错误，直接回退到 L2（站点级）
- 目录 `inference_context.d/` 本身不存在时，同样静默回退

### API 变更

#### `src/inference/context_config.ts`

```typescript
// 当前接口
export const getInferenceContextConfig = (): InferenceContextConfig;

// 新接口 —— 支持按 deployment 获取
export const getInferenceContextConfig = (deploymentId?: string): InferenceContextConfig;

// 新增：按 deployment 查询实际加载的文件路径（调试/观测用）
export const getInferenceContextConfigLoadedFile = (deploymentId?: string): string | null;

// 扩展：清除全部缓存，或仅清除指定 deployment 的缓存
export const resetInferenceContextConfigCache = (deploymentId?: string): void;
```

#### 缓存实现策略

当前实现使用全局单例：

```typescript
let configCache: InferenceContextConfigCache | null = null;
```

扩展为两级缓存结构：

```typescript
interface ConfigCacheEntry {
  config: InferenceContextConfig;
  loadedFile: string | null;
}

let globalCache: ConfigCacheEntry | null = null;               // L1+L2 的缓存（无 deployment 时）
const deploymentCaches = new Map<string, ConfigCacheEntry>();  // L1+L2+L3 的缓存
```

**加载流程**（以 `getInferenceContextConfig('prod')` 为例）：

1. 检查 `deploymentCaches.get('prod')`，命中则返回其 `config`
2. 若未命中，先获取 `globalCache`（或重新计算 L1+L2）
3. 构造部署级文件路径：`data/configw/inference_context.d/prod.yaml`
4. 若文件存在，读取并解析为 YAML；不存在则视为空对象 `{}`
5. 将 `globalCache.config` 与部署级内容通过 `deepMergeAll` 合并
6. 用 `inferenceContextConfigSchema.parse()` 校验合并结果
7. 将结果存入 `deploymentCaches.set('prod', { config, loadedFile })`
8. **最后**：实时读取 L4 环境变量（`buildEnvironmentOverrides()`）并与缓存中的 config 再次合并，返回最终配置

**关键设计**：L4 环境变量不进入缓存。每次 `getInferenceContextConfig()` 调用都实时应用环境变量覆盖，保证运维紧急调整立即生效，无需重启或清缓存。

#### `src/inference/context_builder.ts` 集成方案

当前 `buildForPack` 内部各函数（`buildTransmissionProfile`、`buildPolicySummary`、`buildInferenceVariableContext`）直接调用无参 `getInferenceContextConfig()`。引入 `deploymentId` 后，需要在不破坏现有调用点的前提下，将 deployment 感知传递到这些函数。

**推荐方案：显式传递 Config 对象（最小魔法）**

在 `buildForPack` 中一次性获取配置，然后作为参数显式传递给下游函数。各函数签名增加可选的 `config` 参数，未传入时回退到 `getInferenceContextConfig()` 以保持兼容：

```typescript
// buildForPack 中
const deploymentId = process.env.YIDHRAS_DEPLOYMENT_ID;
const config = getInferenceContextConfig(deploymentId);

const policySummary = await buildPolicySummary(context, resolvedActor.identity, attributes, config);
const transmissionProfile = buildTransmissionProfile(
  resolvedActor.actor_ref,
  resolvedActor.agent_snapshot,
  policySummary,
  attributes,
  config
);
const variableContext = buildInferenceVariableContext({
  context, pack, strategy, attributes,
  resolvedActor, packState, packRuntime, requestInput: input, currentTick,
  config  // 新增
});
```

下游函数内部：

```typescript
const buildTransmissionProfile = (
  actorRef: InferenceActorRef,
  agentSnapshot: InferenceAgentSnapshot | null,
  policySummary: InferencePolicySummary,
  attributes: Record<string, unknown>,
  config?: InferenceContextConfig  // 新增可选参数
): InferenceTransmissionProfile => {
  const tpConfig = (config ?? getInferenceContextConfig()).transmission_profile;
  // ... 其余逻辑不变
};
```

**不推荐的替代方案**：使用 `AsyncLocalStorage` 隐式传递 `deploymentId`。虽然可以避免修改函数签名，但引入了 `async_hooks` 的复杂性和心智负担，与项目「显性依赖」的设计理念冲突。

### deployment_id 来源策略

| 来源 | 优先级 | 说明 | 实施阶段 |
|---|---|---|---|
| `AppContext.deploymentId`（未来） | 最高 | 运行时/调度器在初始化 `AppContext` 时注入，表达当前处理哪个部署实例 | Phase 2.2（配合多包运行时架构） |
| `input.deployment_id`（未来） | 次高 | API 调用方在 `BuildInferenceContextForPackInput` 中显式传递 | Phase 2.2 |
| `YIDHRAS_DEPLOYMENT_ID` 环境变量 | 过渡 | 当前最容易实现的方案，零侵入现有类型系统 | Phase 2.1 |
| 无 / `undefined` | 回退 | 行为与 Phase 1 完全一致，100% 向后兼容 | 默认 |

**Phase 2.1 先落地过渡方案**：`buildForPack` 从 `process.env.YIDHRAS_DEPLOYMENT_ID` 读取 deploymentId，传入 `getInferenceContextConfig()`。这样不需要改动 `AppContext` 或 API 契约，可以独立交付和验证。

### Schema 兼容性

部署级配置文件与站点级使用**完全相同的 Zod Schema**（`inferenceContextConfigSchema`）。不引入新字段，只利用深层合并覆盖需要的值。

示例 `data/configw/inference_context.d/dev.yaml`：

```yaml
config_version: 1

transmission_profile:
  defaults:
    snr_fallback: 0.8
  drop_chances:
    fragile: 0.1
    best_effort: 0.05

variable_context:
  layers:
    request:
      enabled: true
      values:
        task_type: agent_decision_debug
```

此配置会覆盖站点级的 `snr_fallback`、`fragile` / `best_effort` drop chance，以及 `request` 层的 `task_type`。其余字段（如 `thresholds.fragile_snr`、`policy_summary.evaluations`）完整继承自下层。

### 实施步骤

#### Phase 2.1：基础设施扩展（零侵入过渡方案）

1. **修改 `src/inference/context_config.ts`**：
   - 重构缓存为 `globalCache` + `deploymentCaches: Map<string, ConfigCacheEntry>`
   - `getInferenceContextConfig(deploymentId?: string)`：按上述加载流程实现
   - `getInferenceContextConfigLoadedFile(deploymentId?: string)`：返回实际加载的文件路径（含 L2 和 L3）
   - `resetInferenceContextConfigCache(deploymentId?: string)`：支持清除全部或指定 deployment 缓存
   - 新增 `getDeploymentConfigPath(deploymentId: string): string` 辅助函数，内部校验 deployment_id 格式

2. **修改 `src/inference/context_builder.ts`**：
   - `buildForPack` 中读取 `process.env.YIDHRAS_DEPLOYMENT_ID`，调用 `getInferenceContextConfig(deploymentId)`
   - 将获取到的 `config` 显式传递给 `buildTransmissionProfile`、`buildPolicySummary`、`buildInferenceVariableContext`
   - 修改上述三个函数签名，增加可选 `config?: InferenceContextConfig` 参数，未传入时回退到无参 `getInferenceContextConfig()`

#### Phase 2.2：验证与测试

3. **新增单元测试**（`tests/unit/inference_context_config_deployment.spec.ts`）：
   - 部署级配置文件加载与深层合并正确性
   - 无部署级文件时 100% 回退到站点级
   - 不同 `deployment_id` 返回不同且正确的配置
   - 缓存隔离：修改/清除一个 deployment 的缓存不影响其他 deployment 和 globalCache
   - 环境变量（`ICC_*`）仍能覆盖部署级配置（验证 L4 始终最高）
   - 非法 `deployment_id`（含路径遍历字符）被拒绝加载
   - 无 `YIDHRAS_DEPLOYMENT_ID` 时行为与 Phase 1 完全一致

4. **运行质量门禁**：
   - `pnpm typecheck`
   - server 单元测试全部通过

### 验收标准

- [ ] 提供 `data/configw/inference_context.d/{id}.yaml` 并设置 `YIDHRAS_DEPLOYMENT_ID={id}` 后，InferenceContext 组装使用该部署级配置
- [ ] 无部署级配置文件时，100% 回退到站点级配置（行为与 Phase 1 一致）
- [ ] 不设置 `YIDHRAS_DEPLOYMENT_ID` 时，100% 回退到 Phase 1 行为
- [ ] 多个 `deployment_id` 的配置缓存相互隔离，清除一个不影响其他
- [ ] 环境变量（`ICC_*`）仍能覆盖部署级配置（L4 优先级保持最高）
- [ ] 非法 `deployment_id`（如 `../../../etc/passwd`）被安全拒绝，不引发文件遍历
- [ ] `pnpm typecheck` 通过
- [ ] server 单元测试全部通过（或仅预存失败）

### 风险与规避

| 风险 | 影响 | 规避措施 |
|---|---|---|
| 缓存膨胀（大量 deployment） | 内存持续增长 | 引入 LRU 上限（如最多保留 100 个 deployment 缓存）；或改为不缓存 L3、每次重新读取文件 |
| `deployment_id` 注入方式与多包运行时架构冲突 | 返工 | Phase 2.1 先用环境变量解耦，不改动 `AppContext` / `input` 类型；Phase 2.2 再平滑迁移到 `AppContext.deploymentId` |
| 文件路径遍历攻击 | 安全风险 | 严格校验 `deployment_id` 仅允许 `[a-zA-Z0-9_-]`，拒绝任何含 `/`、`.`、`\\` 的输入 |
| 下游函数签名变更遗漏 | 编译错误 | `typecheck` 把关；所有调用点都在同一文件 `context_builder.ts` 内，易于人工审查 |

### 未来扩展（非 Phase 2 范围）

- **世界包级配置（Pack-Level）**：在世界包 `config.yaml` 中增加 `inference_context` 段，作为 L1.5（介于内置默认值与站点级之间）。包作者可以打包默认的 inference context 配置，所有部署该包的实例继承，再被站点级/部署级覆盖。
- **用户级配置（User-Level）**：当多用户系统成型后，`inference_context.d/{user_id}.yaml` 可以作为用户个性化配置的载体，与 deployment 级并存或合并。
- **动态运行时覆盖（Runtime Override）**：通过管理 API 实时推送配置覆盖（不入文件、不重启），作为 L4.5 插入在环境变量之上，用于紧急灰度调整。
