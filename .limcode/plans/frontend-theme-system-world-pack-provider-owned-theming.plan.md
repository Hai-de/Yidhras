<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/agent-scheduler-phase-4-roadmap.md","contentHash":"sha256:06de9081f18ef7ad3f787bbfdc143fabbdb4ce5d2f7c4d129db670c111fa8759"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 明确平台默认主题、provider 自定义主题、fallback/validate/diagnostics 之间的职责边界  `#theme-contract-boundary`
- [x] 规划 README / ARCH / provider authoring guidelines / 示例主题文档同步与落地顺序  `#theme-docs-rollout`
- [x] 定义合法性校验、尺寸 clamp、fallback 与 diagnostics 的最小兜底政策，不替 provider 做风格审美修正  `#theme-fallback-policy`
- [x] 盘点现有默认主题 token、CSS 变量、semantic primitives 与 shell 布局，明确哪些已偏离类 VSCode 工作台风格  `#theme-plan-audit`
- [x] 规划平台官方默认黑色主题的视觉目标、token 调整方向与 UI polish 策略，使其回归类 VSCode 风格但不绑死 provider 视觉  `#theme-platform-default-vscode`
- [x] 要求 semantic primitives、shell 与 Nuxt UI bridge 只消费语义 token，不把平台默认类 VSCode 视觉写死进组件  `#theme-primitives-alignment`
- [x] 收敛 AppThemeDefinition / WorldPackThemeConfig 的稳定 contract，只保留平台承诺的少量高价值 token 与语义层  `#theme-provider-contract`
- [x] 规划 world-pack 提供者自带主题的声明/注册接入方式，避免长期依赖平台内部手工 registry  `#theme-provider-source`
<!-- LIMCODE_TODO_LIST_END -->

# Frontend Theme System - VSCode-like Platform Default Theme and Provider-Owned Custom Theming

## 1. 背景

近期前端 UI 已完成一轮新壳层与组件升级，当前界面在信息密度、圆角、阴影、分组卡片与顶部/底部控制条层次上，已经形成较完整的 Operator Console 形态；但从你提供的两张对比图来看，现状与“原来的类 VSCode 工作台风格”之间仍存在明确差异：

- 现状更偏 **rounded card dashboard**：圆角更大、阴影更明显、卡片感更重、页面分块更像独立面板集合
- 原风格更偏 **flat workbench / editor chrome**：边界更直、层级更薄、线框更明确、信息密度更高、顶部/侧边/底部像同一个工作台系统
- 现状虽然更“精致”，但弱化了原来那种 **终端 / IDE / 控制台式沉浸感**
- 若平台默认主题想回到类 VSCode 的黑色工作台风格，就不能只做“换一组颜色”，而需要同步调整 token、surface grammar、shell 节奏与 primitive 默认语义

同时，主题系统已经具备默认主题、CSS 变量、Tailwind 映射、runtime resolver、diagnostics 与 world-pack override 基线。如果继续推进，却没有明确 ownership，很容易出现一个问题：

- 平台为了把自己的 UI 美化回类 VSCode 风格，不小心把这个风格写成所有 world-pack 的强制 UI 语法

因此这份计划的目标不是“让所有主题都变成类 VSCode”，而是：

1. **把平台自己的默认黑色主题重新打磨成类 VSCode 工作台风格**
2. **明确这只是平台官方默认主题，而不是 world-pack 提供者的强制规范**
3. **让 world-pack 提供者能够在这个基础设施上自由改造成任意风格**
4. **平台只维护自己的主题、稳定 contract 与灵活的自定义方式，最多只提供少数兜底**

---

## 2. 总体目标

### 2.1 平台视觉目标

平台默认主题应回归以下类 VSCode 特征：

- 深色工作台底色，避免 dashboard 式大面积悬浮卡片感
- 以 **边框、分隔线、轻微亮度层级** 替代大圆角和重阴影
- 左 rail / 左 sidebar / 顶部 runtime bar / 底部 dock / 主 workspace 区域形成统一 workbench 语法
- 字体与标签节奏保留 operator / mono / technical console 感，但避免过度装饰导致可读性下降
- 页面标题、区块标题、筛选条、明细 panel、空状态都更像 IDE pane，而不是 marketing dashboard 卡片
- 默认黑色主题可继续演进为“平台官方主题”并长期维护

### 2.2 主题 ownership 目标

- 平台拥有且只维护：**官方默认主题**
- world-pack 提供者拥有：**自己的品牌 / 世界观 / UI 语言 / 包内主题**
- 平台提供：
  - 稳定 token contract
  - runtime resolve / apply / diagnostics
  - validate / clamp / fallback
  - semantic primitives 的消费接口
  - 少量 fallback 与示例
- 平台不提供：
  - 大而全的主题审美指导
  - 自动把 provider 主题“修正得更像平台主题”
  - 大量官方预制主题长期维护负担

---

## 3. 当前现状判断

基于当前代码基线：

- `DEFAULT_APP_THEME` 已是平台默认视觉源头，位于 `apps/web/lib/theme/default-theme.ts`
- `tokens.css` 只承担最小 CSS variable fallback，方向正确
- `theme-default.css` 中 panel / overlay / grid 已存在默认 surface 语义
- `tailwind.config.ts` 已将大量颜色、字体、圆角、阴影、布局 token 暴露给业务层消费
- `plugins/theme.ts` 已具备 worldPack 变化时的主题重应用能力
- README 已说明 Nuxt UI 只是基础设施层，不接管整站风格

但从视觉结果看，当前默认主题仍存在这些与类 VSCode 工作台风格不一致的地方：

1. **surface 过于卡片化**
   - `radius.md/lg` 偏大
   - `shadow.panel/elevated` 过强
   - panel surface 更像漂浮卡片而不是 dock/pane
2. **层级更像 dashboard，不像 workbench**
   - 顶栏、边栏、主区块、dock 虽已齐备，但视觉语法没有完全统一
   - 页面内大量区域仍以“卡片集合”表达，而不是“编辑器 pane / sidebar section / inspector section”表达
3. **默认 token 仍然偏精致 UI，不够 console / IDE 化**
   - 边框、分隔线、hover、active、focus 的工作台语义可能还不够明确
   - 一些 technical label 的节奏不错，但容器几何仍偏 rounded modern web app
4. **若直接继续做美化，风险是把平台默认风格写死在 primitives 中**
   - 这样 provider 即使 override token，也仍被平台几何和结构风格绑住

---

## 4. 核心原则

### 4.1 Platform-owned default, provider-owned identity

- 平台默认黑色主题 = 平台自己的官方工作台主题
- world-pack 主题 = provider 自己的表达层
- 两者不是主从审美关系，而是“平台提供默认值，provider 可完全接管”

### 4.2 VSCode-like 只约束平台默认主题，不约束 provider

- “类 VSCode”是平台默认主题的视觉目标
- 它不应升级成 `WorldPackThemeConfig` 的隐形审查标准
- provider 可做更硬核、更奇异、更拟物、甚至更明亮的风格，只要满足最小 contract

### 4.3 Semantic primitives 只绑定语义，不绑定平台审美细节

- `AppPanel` 应绑定 panel / elevated / border / density / tone 等语义
- 不应把“平台默认 8px 圆角 + 某阴影 + 某大写标签 spacing”写成不可摆脱的组件形状
- shell 与 feature 页面也应尽量经由 token / variant / semantic role 获取样式，而非散落固定 class

### 4.4 Minimal fallback only

平台只在以下场景介入：

- 缺失字段
- 非法 CSS 值
- 布局尺寸越界
- 明确会导致界面失控的值

平台不介入：

- 是否“够美”
- 是否“像平台默认风格”
- 是否“适合某个世界观”

### 4.5 Few official fallbacks, not many bundled themes

- 平台长期维护的重点应是一个高质量默认黑色主题
- 最多只保留极少量兜底/示例，不演变成官方主题商店
- 复杂主题生态交给 world-pack 提供者

---

## 5. 计划范围

### 包含

- 平台默认主题回归类 VSCode 工作台风格的规划
- 默认 token、surface grammar、shell polish 的调整方向
- provider-owned theming 边界说明
- `AppThemeDefinition` / `WorldPackThemeConfig` contract 收敛方向
- world-pack 主题接入机制规划
- fallback / validate / diagnostics 的职责约束
- primitives / shell / Nuxt UI bridge 与主题原则的对齐
- 相关 README / docs / authoring guidelines 的同步计划

### 不包含

- 本次不直接批量重写所有页面视觉实现
- 本次不承诺一次性提供完整 manifest/API 主题协议产品化
- 本次不把平台扩展成支持无限细粒度官方 token catalog
- 本次不将平台维护多个完整官方主题系列作为主目标

---

## 6. 推荐实施主线

## 主线 A：先定默认主题的视觉语法，再改 token

### 目标

先统一“平台默认类 VSCode 工作台风格到底是什么”，避免后续只做颜色替换。

### 要点

输出一组默认视觉判断标准：

- 圆角更小：`sm` 保留轻微圆角，`md/lg` 收紧，必要处接近直角
- 阴影减弱：默认依赖边框和层级亮度，不依赖大面积投影
- 面板关系更明确：sidebar / pane / inspector / dock / toolbar 同属 workbench，而不是互相独立卡片
- 分割线更明确：工作区之间更像 IDE pane split
- hover / active / selected / focus 更偏工具型状态表达
- typography 继续保留 console 感，但应提升标题层次与正文可读性平衡

### 产出

- 默认主题视觉原则清单
- 默认黑色主题 token 调整候选表
- 需要修改的 shell / primitive 默认表现清单

---

## 主线 B：把平台默认主题收敛为“官方主题”，而不是“平台美学总规范”

### 目标

明确平台官方主题与 provider 主题不是同一层职责。

### 要点

平台维护：

- `DEFAULT_APP_THEME`
- CSS variable contract
- 解析器 / 校验器 / fallback / diagnostics
- semantic primitives 的可消费语义层

provider 维护：

- 自己的颜色系统
- 容器几何（圆角、边界、阴影倾向）
- 组件 tone、交互反馈、氛围表达
- 必要时自己的 shell / page 风格延展

### 产出

- ownership 边界说明
- README / ARCH / plan 中的一致表述

---

## 主线 C：收敛稳定 token contract，避免把“类 VSCode 细节”扩成平台硬要求

### 目标

保持 contract 稳定、少量、高价值。

### 建议保留的长期稳定层

1. **core colors**
   - app / panel / elevated / overlay
   - border strong / muted
   - text primary / secondary / muted / inverse
   - state success / warning / danger / info / accent
2. **typography**
   - sans / mono
   - 如后续要扩，优先用少量 density / size role，而不是铺开大量字号 token
3. **shape & surface**
   - radius
   - border width
   - shadow
4. **layout**
   - rail width / sidebar width / dock heights / page paddings / gaps
5. **few component semantics**
   - 例如 panel blur 等少量必要 token

### 不建议过早承诺的方向

- 大量平台专属 decorative token
- 过细的每组件 every-state token catalog
- 把类 VSCode 特定表现拆成大量 provider 必填字段

### 产出

- contract 保留项 / 审慎扩展项列表
- 后续 token 增长 guardrails

---

## 主线 D：规划 world-pack provider 自带主题的接入方式

### 目标

让 theme ownership 真正落到 provider，而不是继续依赖平台内部 registry。

### 方向

在当前 `resolveThemeWithDiagnostics()` + world pack lookup 基线上，规划支持以下接入来源：

- pack manifest 中声明主题配置
- pack 前端注册插件在加载时注册主题
- pack metadata / runtime payload 中附带主题片段
- 平台 registry 仅作为临时最小基线与 fallback

### 原则

- 平台负责发现与解析
- provider 负责提供主题内容
- 平台不应要求每次 provider 新主题都必须改平台源码

### 产出

- 主题来源优先级草案
- provider 注册/声明路径草案
- 平台 registry 的降级定位说明

---

## 主线 E：让 primitives / shell / Nuxt UI bridge 完全服从 token 语义

### 目标

即使平台默认主题改回类 VSCode 风格，provider 依然可以自由换风格。

### 重点审视对象

- `components/ui/*` semantic primitives
- `features/shell/components/*`
- 页面标题栏、过滤条、detail panel、dock 容器
- Nuxt UI bridge 的 default props / class 映射

### 约束

- 组件内部不得把平台默认的圆角、阴影、背景深度写死
- 视觉结构尽量抽象成：tone / density / emphasis / surface / selected / focus / active
- 允许平台默认主题通过 token 得到“类 VSCode”结果
- 也允许 provider 通过覆盖 token 得到完全不同的结果

### 产出

- primitive 约束清单
- shell 组件待对齐区域清单
- Nuxt UI bridge 的轻依赖策略说明

---

## 主线 F：定义 validate / clamp / fallback / diagnostics 的最小兜底政策

### 目标

平台只做承载层，不做审美监管者。

### 平台应做

- 校验 CSS color / CSS length / shadow / blur 等值是否合法
- 对布局相关值做安全 clamp
- 缺失字段从平台默认主题回退
- diagnostics 在开发期输出可读 warning

### 平台不应做

- 自动把 provider 颜色修正成平台常用色系
- 自动提升/降低圆角、阴影以“更好看”
- 对 provider 主题做“类 VSCode 合规化”处理

### 产出

- diagnostics 分类与输出策略
- fallback 触发条件说明
- provider-facing debug 指南

---

## 主线 G：文档与 rollout

### 目标

让后续实现与协作都围绕同一原则推进。

### 需要同步的文档

- `apps/web/README.md`
- `docs/ARCH.md`
- 必要时新增 provider theme authoring guide
- 当前 plan 与后续 Phase 3/主题相关 plan

### 建议文档内容

- 平台默认主题的职责
- provider 可控制的层级与自由度
- 少量稳定 token 的含义
- fallback / diagnostics 行为
- 简单 provider 主题示例

---

## 7. 建议推进顺序

1. **先确认平台默认类 VSCode 视觉基线**
   - 明确要恢复哪些几何与层级特征
2. **再确认 ownership / contract 边界**
   - 避免后续实现把平台风格硬编码到 provider contract
3. **然后推进 token 与 primitive 对齐**
   - 先改默认 token 与 primitive 消费方式
4. **最后再补 provider 接入与文档**
   - 让 provider 能顺滑接入自己的主题

---

## 8. 验收标准

完成本计划后，应能明确满足以下条件：

1. 已明确“类 VSCode”仅是平台默认黑色主题的视觉目标，而非 provider 强制规范
2. 已形成平台默认主题的调整方向：更小圆角、更弱阴影、更强边界、更统一 workbench shell
3. 已明确平台只维护自己的默认主题与少量兜底，不维护大量官方主题
4. 已明确 world-pack provider 拥有主题主导权，可自由定义自己的视觉风格
5. 已明确 `AppThemeDefinition` / `WorldPackThemeConfig` 的稳定 contract 应保持精简
6. 已明确 primitives / shell / Nuxt UI bridge 不得把平台默认类 VSCode 风格写死到实现中
7. 已明确 fallback / validate / diagnostics 只做最小安全网，不做审美矫正
8. 已规划文档与 provider authoring guideline 的同步路线

---

## 9. 风险与注意事项

### 风险 1：把“恢复原风格”误做成全站硬编码回退

如果直接在组件里回写旧样式，而不经过 token / semantic layer，会让 provider 后续几乎无法接管主题。

### 风险 2：平台默认主题与 contract 混在一起

如果把平台默认类 VSCode 的细节写进 contract，provider 就会被迫遵守平台审美结构。

### 风险 3：过度追求主题扩展性，反而把 contract 做得过大

平台真正需要的是“稳定、少量、可组合”的 contract，而不是一套无限增长的 token catalog。

### 风险 4：过强 fallback 让 provider 以为平台在审核设计

fallback / diagnostics 必须清楚表达“我只处理非法值和缺失值”，而不是“我觉得你的主题不够好看”。

---

## 10. 完成标志

当以下语义被团队一致接受并在后续实现中贯彻时，本计划可视为完成：

- 平台拥有一个长期维护的官方默认黑色主题，视觉上回归类 VSCode 工作台风格
- world-pack provider 可以基于同一套基础设施自由定义自己的主题
- 平台只维护默认主题、contract、runtime 应用链路与少量 fallback
- semantic primitives / shell / Nuxt UI bridge 都服从 token 语义，而不是偷渡平台默认视觉
- provider 无需修改平台核心源码，也能以更自然的方式声明/接入自己的主题
