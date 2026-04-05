## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 建立 data/configw 配置骨架与 server 端统一配置加载入口（YAML + 深度合并 + Zod 校验）  `#phase-1-config-skeleton`
- [x] 将主启动链路接入统一配置中心，替换默认端口、preferred world pack 与 world pack 路径硬编码  `#phase-2-startup-integration`
- [x] 将 bootstrap world pack 模板外置到 data/configw/templates，并改造 bootstrap 逻辑读取模板文件  `#phase-3-bootstrap-template`
- [x] 收敛 e2e 与脚本中的默认 world pack 硬编码，使测试环境对齐配置中心  `#phase-4-test-hardcode-cleanup`
- [x] 补充 README/架构文档，说明 configw 职责、加载顺序、覆盖优先级与扩展约定  `#phase-5-docs-rollout`
<!-- LIMCODE_TODO_LIST_END -->

# 运行时配置中心与默认世界包配置化改造计划

## 1. 背景
当前项目中与默认世界包、world pack 路径、bootstrap 行为、启动参数相关的配置分散在多个模块中，存在以下问题：

- 默认 world pack 名称与目录在 `apps/server/src/index.ts`、`apps/server/src/world/bootstrap.ts`、部分 e2e 中分散硬编码。
- `resolveWorldPacksDir()` 在多个模块中重复实现，路径解析职责未收敛。
- `bootstrap.ts` 直接内嵌大段 world pack YAML 内容，内容与逻辑耦合。
- 测试与运行时默认值不统一，后续继续开发时容易产生配置漂移。

本计划目标是在 **`data/configw/`** 下建立统一的运行时配置中心，并以最小风险方式逐步替换现有硬编码点，为后续新增模块、环境切换、模板扩展和部署配置留出空间。

---

## 2. 目标

### 2.1 主要目标
1. 建立统一的运行时配置加载入口。
2. 将默认 world pack、world pack 根目录、bootstrap 模板位置等从代码硬编码迁移到 `data/configw`。
3. 通过 schema 校验和深度合并支持多环境配置。
4. 将 bootstrap world pack 模板内容外置为文件，避免继续在代码中嵌入大段 YAML。
5. 为后续 scheduler、feature flags、更多路径配置提供可扩展结构。

### 2.2 非目标
1. 本阶段不重构所有业务配置系统。
2. 本阶段不把 world pack 正文本身迁移到配置中心；world pack 仍然存放在 `data/world_packs/**`。
3. 本阶段不全面改造 web 端配置体系，仅确保 server 侧具备清晰可复用的配置中心。

---

## 3. 目标结构

### 3.1 目录结构
建议新增以下目录与文件：

```txt
data/
  configw/
    default.yaml
    development.yaml
    production.yaml
    test.yaml
    local.yaml               # 可选，本地覆盖，不提交或按需忽略
    templates/
      world-pack/
        death_note.yaml
```

### 3.2 配置模块结构
建议在 server 侧新增：

```txt
apps/server/src/config/
  runtime_config.ts
  schema.ts
  loader.ts
  merge.ts
```

如需控制变更范围，第一阶段也可先落地为：

```txt
apps/server/src/config/
  runtime_config.ts
```

并在后续迭代中拆分。

---

## 4. 配置模型设计

### 4.1 建议配置结构
以 `default.yaml` 为基准，建议包含以下顶层域：

```yaml
config_version: 1

app:
  name: "Yidhras"
  env: "development"
  port: 3001

paths:
  world_packs_dir: "data/world_packs"
  assets_dir: "data/assets"
  plugins_dir: "data/plugins"

world:
  preferred_pack: "death_note"
  bootstrap:
    enabled: true
    target_pack_dir: "death_note"
    template_file: "data/configw/templates/world-pack/death_note.yaml"
    overwrite: false

startup:
  allow_degraded_mode: true
  fail_on_missing_world_pack_dir: false
  fail_on_no_world_pack: false

scheduler:
  enabled: true

features:
  inference_trace: true
  notifications: true
```

### 4.2 设计原则
- **按域组织**：避免单层大量平铺字段。
- **路径使用相对 workspace 根路径**：由统一配置模块负责解析绝对路径。
- **先覆盖最关键项**：world、paths、startup；后续再扩展 scheduler、feature flags。
- **保留版本号**：为未来配置结构演进留接口。

---

## 5. 配置加载与覆盖策略

### 5.1 加载顺序
建议采用以下优先级：

1. 代码内置默认值
2. `data/configw/default.yaml`
3. `data/configw/{APP_ENV}.yaml`
4. `data/configw/local.yaml`
5. 环境变量覆盖

其中：
- `APP_ENV` 缺省时可回退到 `NODE_ENV`，最终默认 `development`
- 运行期仅允许 `runtime_config` 模块读取 `process.env`
- 业务模块统一通过 `getRuntimeConfig()` 读取配置，不直接访问 `process.env`

### 5.2 深度合并
必须使用深度合并，而不是浅覆盖。原因：
- 环境文件通常只覆盖少量字段
- 若使用浅覆盖，会破坏嵌套结构完整性

### 5.3 Schema 校验
建议使用现有依赖 `zod` 对最终合并结果进行校验，保证：
- 必填字段存在
- 端口、布尔值、路径字符串等类型正确
- world bootstrap 配置字段完整
- 配置错误在启动期即失败或显式告警

---

## 6. 服务端代码改造范围

### 6.1 新增统一配置入口
新增 `apps/server/src/config/runtime_config.ts`，对外提供：

- `getRuntimeConfig()`：返回已校验的配置对象
- `resolveWorkspacePath(relativePath)`：将配置路径转换为绝对路径
- `getWorldPacksDir()`：从配置而不是硬编码中解析目录
- `getPreferredWorldPack()`：返回运行时默认 world pack

可选扩展：
- 配置缓存
- 启动时打印关键配置快照

### 6.2 替换硬编码点
至少替换以下模块：

1. `apps/server/src/index.ts`
   - `port`
   - `preferredWorldPack`
   - `worldPacksDir`

2. `apps/server/src/world/bootstrap.ts`
   - 不再内嵌 YAML 字符串
   - 改为读取 `world.bootstrap.template_file`
   - 使用 `world.bootstrap.target_pack_dir`
   - 依据 `enabled / overwrite` 决定行为

3. `apps/server/src/app/runtime/startup.ts`
   - 移除重复的目录解析逻辑
   - 统一依赖配置中心或公共路径解析函数

4. `apps/server/src/core/world_pack_runtime.ts`
   - 移除重复 `resolveWorldPacksDir()`
   - 改为复用统一配置入口

### 6.3 Bootstrap 模板外置
新增：

`data/configw/templates/world-pack/death_note.yaml`

由 `bootstrap.ts` 在目标 world pack 缺失时复制到：

`data/world_packs/<target_pack_dir>/config.yaml`

### 6.4 测试与脚本适配
逐步收敛以下位置的默认值：
- 各类 e2e 中 `process.env.WORLD_PACK ?? 'cyber_noir'`
- 依赖默认 world pack 名的测试桩数据
- 任何假定 world pack 目录名固定的脚本

本阶段可以优先做两件事：
1. 将直接读取默认包名的测试改为读取统一 helper
2. 将仍需保留的默认值改为与配置中心一致，而不是散落魔法字符串

---

## 7. 实施阶段

### Phase 1：建立配置中心骨架
- 创建 `data/configw/default.yaml`
- 创建 `data/configw/development.yaml`、`test.yaml`（可最小内容）
- 创建 `apps/server/src/config/runtime_config.ts`
- 实现 YAML 读取、深度合并、Zod 校验、环境变量覆盖
- 提供统一 API：`getRuntimeConfig()`

**验收标准：**
- server 可在无额外改造时成功读取配置
- 启动时可打印关键配置快照
- 配置文件错误时能给出清晰报错

### Phase 2：配置接入主启动链路
- 改造 `apps/server/src/index.ts`
- 改造 `apps/server/src/app/runtime/startup.ts`
- 改造 `apps/server/src/core/world_pack_runtime.ts`
- 删除重复路径解析逻辑

**验收标准：**
- 默认端口、world pack 目录、preferred pack 均由配置驱动
- 代码中不再出现重复 `resolveWorldPacksDir()` 实现

### Phase 3：Bootstrap 模板外置
- 新增 `data/configw/templates/world-pack/death_note.yaml`
- 改造 `apps/server/src/world/bootstrap.ts`
- 将 world pack 初始化内容改为读取模板文件
- 支持 `enabled / overwrite / target_pack_dir / template_file`

**验收标准：**
- `bootstrap.ts` 中不再保留大段 world pack YAML 字符串
- 缺少目标 world pack 时可正确生成配置文件
- 已存在 world pack 时按 overwrite 策略行为正确

### Phase 4：测试与遗留硬编码收口
- 清理 e2e 中与默认 world pack 相关的硬编码
- 将测试默认配置与 `data/configw/test.yaml` 对齐
- 校正文档和示例脚本

**验收标准：**
- 测试中的默认包名不再依赖历史值 `cyber_noir`
- 测试环境切换默认包只需修改测试配置文件

### Phase 5：文档与扩展预留
- 更新 `README.md` / `docs/ARCH.md` / 必要的开发文档
- 说明 `data/configw` 的职责、优先级和本地覆盖机制
- 为未来 scheduler、feature flags、更多目录项预留扩展约定

**验收标准：**
- 开发者能根据文档理解如何新增配置项
- 后续模块能沿用同一配置模型，不再自行发明配置入口

---

## 8. 风险与应对

### 风险 1：配置入口引入后，旧路径逻辑与新逻辑并存
**应对：**
- 以 `Phase 2` 为明确收口点
- 同步删除旧的重复目录解析函数或令其转调统一入口

### 风险 2：测试依旧依赖旧默认值导致不稳定
**应对：**
- 先统一测试 helper 或环境配置
- 对仍需保留常量的测试用例做集中清理

### 风险 3：环境变量与 YAML 配置来源冲突，导致行为不易理解
**应对：**
- 明确记录优先级
- 启动日志打印关键字段的最终生效值与来源

### 风险 4：未来配置项越来越多，单文件膨胀
**应对：**
- 第一阶段维持单入口文件
- 当配置域明显增多时，再平滑拆分为 `schema.ts / loader.ts / merge.ts`

---

## 9. 验证方案

### 9.1 功能验证
- 本地正常启动 server
- world pack 目录存在时正常初始化
- 删除默认 world pack 后执行 bootstrap，确认模板复制行为正确
- 调整 `preferred_pack` 后确认系统选包行为正确

### 9.2 配置验证
- 故意写错 `default.yaml` 字段类型，确认启动期报错明确
- 使用 `APP_ENV=test` 启动，确认读取 `test.yaml`
- 使用环境变量覆盖 `PORT` 与 `WORLD_PACK`，确认覆盖生效

### 9.3 回归验证
- 至少执行 smoke / 关键 e2e
- 验证运行时健康检查、world pack 检测、模拟初始化逻辑未被破坏

---

## 10. 建议落地顺序
为降低风险，建议严格按以下顺序实施：

1. 先建配置中心，不立即大面积替换业务逻辑
2. 再接入启动链路与路径解析
3. 再外置 bootstrap 模板
4. 最后清理测试与遗留硬编码

这样可以保证每一步都可单独验证，避免一次性大改造成问题难以定位。

---

## 11. 预期结果
计划完成后，项目将具备以下能力：

- 默认世界包、路径与启动策略全部通过 `data/configw` 配置化管理
- server 各模块不再自行硬编码默认 world pack 或目录路径
- bootstrap world pack 模板从代码中抽离，内容维护更自然
- 多环境运行与测试默认值统一，有利于持续开发
- 为未来新增 scheduler 配置、feature flags、更多资源目录提供统一扩展入口
