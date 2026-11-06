# 悬浮提示清理与风格判断

审计日期：2026-11-06。按当前工作区逐处检查，不沿用旧版“已有就是合规”的判定。依据为用户本次删除要求、DESIGN.md 的工具卡片/文字角色，以及实际组件源码。

## 判断与结果

- 应用自身的 200 处原生 title 触发点：删除 78 处说明性提示；其余 122 处简短名称、快捷键、路径或裁切补全迁移到显式 data-tooltip。应用控件不再写原生 title。
- 另有 8 处生成/第三方触发点：删除 6 处，保留 2 处并接入统一提示层。两组合计 **208 个触发站点，删除 84 个，保留 124 个**。循环实例不重复计数，渲染器不另计触发点。
- 截图中的 token 明细及其富内容渲染/CSS 已删除。总量、占比条和工具次数常显，点击与悬停不打开任何明细，也不占一个额外 Tab 焦点。计算口径与拖拽范围保留。
- 删除时间轴的独立浮动预览，保留刻度定位与完整时间线；删除帮助说明标签、问号光标及只为提示存在的图标。
- 保留的提示统一使用 14px 控件文字、card/ink-muted 表面文字、line-strong 单边界、control 圆角及共享阴影；不添加新的说明卡。显式数据属性不触发系统灰框，鼠标按下/离开不恢复原生 title。
- 原生 title 不受主题/字号/圆角控制，全部判定不合规；其简短内容只有符合上面条件时才进入统一提示层。ESLint 禁止应用 DOM 新增 title 属性。

## 独立与生成触发点

| 位置 | 风格判断 | 处理 |
| --- | --- | --- |
| TimelineBar 刻度预览 | 独立 fixed 定位、额外阴影卡、正文及“点击”说明；不是统一短提示 | 删除预览及相关说明关联，保留导航 |
| Markdown 探索高亮生成的 title | 原生提示，重复展开分支问题片段 | 删除；点击定位保留 |
| canvas-chat 回答引用生成的 title | 原生提示，引用正文再开一层说明 | 删除；引用标记及定位保留 |
| React Flow 放大 | 原生样式；加号已经表达动作 | 删除提示，保留可访问名称 |
| React Flow 缩小 | 原生样式；减号已经表达动作 | 删除提示，保留可访问名称 |
| React Flow 适配画布 | 原生样式不合规，图标需要简短名称 | 删除原生 title，保留统一短提示 |
| React Flow 交互锁定 | 原生样式不合规，需要标识锁定对象 | 删除原生 title，保留统一短提示 |
| React Flow 小地图 SVG title | 原生窗口，无信息增量 | 删除可视提示，保留 aria-label |

GlobalTooltip 只渲染显式 data-tooltip；不再代理、暂存或恢复任意 title。画布库的标签适配只观察自己的控件和小地图，保留库原有点击/缩放实现。Markdown 文件链接与图片的标题内容通过同一显式通道展示；任意用户导入的 HTML/图表内部结构不当作应用 UI 批量改写。海报标题、窗口标题、文档标题以及数据字段 title 均不属于本次删除对象。

## 点击后出现的功能表面

以下是源码层面的用途和样式核查，不能据此声称每个窗口已完成视觉验收。它们含有实际选择、编辑、确认、查看或任务状态，不是纯说明性气泡。

| 表面 / 组件 | 判断与处理 |
| --- | --- |
| 更多、项目列表、模型、目录、权限、详细程度 | 使用共享 card/line/control 与工具卡片；保留操作入口，删除其中长说明提示 |
| 回忆设置、节点菜单、对齐菜单、文件链接菜单、@引用候选 | 临时功能菜单，使用统一中性表面与控件文字；保留选项与关闭逻辑 |
| 上下文来源 NodeContextSources | 使用 panel 圆角、共享字号和边界，含来源定位和排序；保留 |
| 选区属性、连线属性、排版、分区导航、画布问答 | 工作面板，按既定工具停靠和活动位规则打开；保留 |
| 文件预览、材料阅读器、详情阅读面板 | 有明确读取对象的阅读表面，保留；删除内容上的泛说明提示 |
| 确认、配置、导入、角色、总览、分享、帮助和更新窗口 | 明确功能窗口，保留确认/取消、草稿及提交语义 |
| Toaster 操作结果与 LadderJobCard 任务进度 | 执行结果、失败或进度反馈，具有明确状态及可能的后续动作；保留；不将其当作鼠标解释卡 |

## 逐项清单

编号对应修改前的源码站点。用文件名与文案/表达式定位，避免删除后的行号漂移。下表的“保留”均指统一提示层，不保留原生 title。

### 主工具栏

| # | 位置 | 原文案 / 表达式 | 判断与措施 |
| --- | --- | --- | --- |
| 1 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1706 行 | 设置首问的回答角色 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 2 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1872 行 | 新建提问节点：连入材料作为上下文 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 3 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1880 行 | 新建便笺：连线后进入下游上下文 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 4 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1887 行 | 新建文件节点：连线后进入下游上下文 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 5 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1894 行 | 新建分区框：组织画布，不进入上下文 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 6 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1930 行 | 把这个范式变成可运行的对话画布（在你动手之前不会有任何生成） | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 7 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1963 行 | 按依赖顺序重跑所有陈旧节点（先确认，逐个追加新版本） | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 8 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1975 行 | 凝练进行中（第 {i}/{n} 段）· 点击查看 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 9 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1993 行 | 只读视图 | 保留：仅响应式图标态显示名称；改为 data-tooltip。 |
| 10 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 1999 行 | 画布内搜索（Ctrl/⌘F） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 11 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2008 行 | 导出画布 (.json) | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 12 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2016 行 | 获取 ThoughtDAG | 保留：仅响应式图标态显示名称；改为 data-tooltip。 |
| 13 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2033 行 | 分区导航 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 14 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2066 行 | 问画布：基于全图大纲回答 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 15 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2077 行 | 画布内搜索（Ctrl/⌘F） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 16 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2099 行 | 排版设计 | 保留：仅响应式图标态显示名称；改为 data-tooltip。 |
| 17 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2162 行 | 隐藏注释（分区框与未连线的材料） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 18 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2170 行 | 默认开启：滚轮和触控板双指滑动平移画布，节点正文内滚动阅读。按住 Ctrl/⌘ 滚动或捏合，始终以画布可视区域中心缩放，鼠标位于节点内也有效。关闭后普通滚轮缩放。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 19 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2199 行 | 凝练：让模型检查全图，建议哪些轮次可以降低颗粒度 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 20 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2230 行 | 复制只读链接：打开的人只能浏览，不能修改 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 21 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2248 行 | 导出带时间戳的画布操作记录 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 22 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2292 行 | 管理跨画布保留的记忆 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 23 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2306 行 | 在 Harness 的「插件」页重新添加 {pkg}，然后重启 Harness / 在终端运行：{cmd} | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 24 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2340 行 | 撤销 (Cmd+Z) | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 25 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2348 行 | 重做 (Cmd+Shift+Z) | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 26 | [src/App.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/App.tsx) · 原 2555 行 | 定位并打开最后活跃的节点 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |

### 画布、节点与材料

| # | 位置 | 原文案 / 表达式 | 判断与措施 |
| --- | --- | --- | --- |
| 73 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 403 行 | `{staleTitle}` | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 74 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 418 行 | `{badgeTitle}` | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 75 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 451 行 | 这个节点由原树的一段轮次蒸馏而来。点击高亮并跳到原段。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 76 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 461 行 | `{staleTitle}` | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 77 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 469 行 | 已归档：可见但不进入任何上下文 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 78 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 488 行 | `{data.appliedRole}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 79 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 505 行 | ``{`${label}${pinNote}`}`` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 80 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 554 行 | 回到阅读器第 {n} 页，展开这条对话 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 81 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 653 行 | 继续编辑草稿 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 82 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 764 行 | 把这一步扇出为预配的角色分支，何时展开由你决定 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 83 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 807 行 | 立即重新评审 / 重新生成 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 84 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 817 行 | 复制回答 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 85 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 825 行 | 继续编辑草稿 / 编辑回答 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 86 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 833 行 | 在这个节点的上下文中 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 87 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 838 行 | 生成这个版本的模型。生成时记录，之后切换全局模型也不会混淆答案的出处。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 88 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 844 行 | 这一轮接在同一个 Agent 会话上，只发送了问题 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 89 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 850 行 | 在终端打开这个会话 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 90 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 857 行 | 这个版本的回答由模型网关联网搜索后生成。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 91 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 862 行 | 这个版本的生成时间 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 92 | [ThoughtNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtNode.tsx) · 原 891 行 | 生成失败不覆盖历史：切回之前的版本 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 93 | [ThoughtEdgeView.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ThoughtEdgeView.tsx) · 原 129 行 | 编辑连线 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 94 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 126 行 | 移除命令 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 95 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 410 行 | 在终端打开时使用的终端 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 96 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 567 行 | 归档（从列表隐藏，数据保留） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 97 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 600 行 | 还原并打开 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 98 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 691 行 | ``{`⑂ ${threadForks.get(card.sessionId)}`}`` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 99 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 706 行 | `{home.name}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 100 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 725 行 | 选入合并 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 101 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 733 行 | 导入为画布 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 102 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 736 行 | 重新镜像（丢弃画布修改） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 103 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 746 行 | 挂载到画布… | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 104 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 756 行 | 在 App 中打开（{name}） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 105 | [SessionAtlas.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SessionAtlas.tsx) · 原 765 行 | 在终端打开 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 106 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 230 行 | 未命名节点 | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 107 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 243 行 | 生成合并摘要后删除原节点 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 108 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 244 行 | 把圈选节点中你标过的高光串成一段带引用的文字 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 109 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 245 行 | 归档选中节点（淡化显示、排除出上下文、可恢复） | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 110 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 246 行 | 用当前选中的模型为选中的节点更新四层摘要；文件、便签和短回答自动跳过，进度在右下角，随时可停 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 111 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 264 行 | 创建所选对象的副本，保留选区内部连线，不复制跨出选区的连线。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 112 | [SelectionToolbar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionToolbar.tsx) · 原 265 行 | 将选中节点导出为 Markdown 文档 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 113 | [SelectionArrangeMenu.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionArrangeMenu.tsx) · 原 53 行 | 至少需要 {n} 个独立对象 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 114 | [SelectionArrangeMenu.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/SelectionArrangeMenu.tsx) · 原 124 行 | 请选中节点来创建分区，当前选区已包含分区框 / 按当前所选节点范围创建分区并开启区域联动，保留节点位置与连线 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 115 | [ProjectSwitcher.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ProjectSwitcher.tsx) · 原 110 行 | `{active?.name}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 116 | [ProjectSwitcher.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ProjectSwitcher.tsx) · 原 136 行 | 源会话未在本机发现——镜像以档案模式运行，源出现后自动恢复监听 / 此画布订阅 {runner} 会话的更新，点击在地图中查看 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 117 | [ProjectSwitcher.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ProjectSwitcher.tsx) · 原 208 行 | 归档（从列表隐藏，数据保留） | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 118 | [ProjectSwitcher.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ProjectSwitcher.tsx) · 原 262 行 | 关掉窗口后应用在后台继续运行，正在生成的回答不会中断。从托盘图标打开或退出。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 119 | [ParadigmNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ParadigmNode.tsx) · 原 73 行 | `{t(labelKey as Parameters<typeof t>[0])}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 120 | [NodeTokenUsage.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeTokenUsage.tsx) · 原 91 行 | `{fallback}` | 删除：用户明确指定；独立明细卡使用 10px 圆角、无边框及强阴影，偏离共享卡片轮廓。 |
| 121 | [NodeOverview.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeOverview.tsx) · 原 30 行 | `{source \|\| name}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 122 | [NodeOverview.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeOverview.tsx) · 原 34 行 | `{meta}` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 123 | [NodeMetadataEditor.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeMetadataEditor.tsx) · 原 130 行 | `{name}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 124 | [NodeMetadataEditor.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeMetadataEditor.tsx) · 原 133 行 | `{previewText}` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 125 | [NodeHighlightsSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeHighlightsSection.tsx) · 原 41 行 | 删除高亮 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 126 | [NodeHighlightsSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeHighlightsSection.tsx) · 原 52 行 | `{hint}` | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 127 | [NodeDetailsButton.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeDetailsButton.tsx) · 原 14 行 | 查看详情 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 128 | [DiagnosticsPanel.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/DiagnosticsPanel.tsx) · 原 78 行 | 定位 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 129 | [DiagnosticsPanel.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/DiagnosticsPanel.tsx) · 原 88 行 | 删除此连线 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 130 | [DiagnosticsPanel.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/DiagnosticsPanel.tsx) · 原 107 行 | 诊断图结构 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 131 | [ConversationLink.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ConversationLink.tsx) · 原 26 行 | `{value.target.path}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 132 | [ConversationLink.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ConversationLink.tsx) · 原 27 行 | 在文件夹中显示 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 133 | [ConversationLink.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ConversationLink.tsx) · 原 86 行 | ``{target ? `${target.path}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ''}` : ''}` : props.title}`` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 134 | [ConversationLink.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ConversationLink.tsx) · 原 110 行 | `{target.path}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 135 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 269 行 | 摘取出处：点击回到原文这一页 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 136 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 277 行 | 尚未连线，只是画布材料。向某个节点连一条线，它就会进入该节点的上下文。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 137 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 294 行 | 阅读并提问 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 138 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 305 行 | 打开链接 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 139 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 328 行 | `{nodeNameSource}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 140 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 331 行 | `{data.recallSource.file}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 141 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 417 行 | 查看 / 编辑提取内容：下游上下文读到的就是这段文本 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 142 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 427 行 | 用视觉模型提取这张图的内容（物体、文字、图表结构），作为图片的伴随文本进入下游上下文 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 143 | [ContentNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ContentNode.tsx) · 原 471 行 | `{att.name}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 144 | [ConnectionProperties.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ConnectionProperties.tsx) · 原 117 行 | 定位：{name} | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 145 | [CanvasDetailControl.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/CanvasDetailControl.tsx) · 原 25 行 | 未命名节点 | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 146 | [CanvasDetailControl.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/CanvasDetailControl.tsx) · 原 59 行 | 全局详细程度 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 147 | [CanvasChat.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/CanvasChat.tsx) · 原 121 行 | `{n ? nodeLabel(n.data, lang) : undefined}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 148 | [CanvasChat.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/CanvasChat.tsx) · 原 148 行 | ``{t(`chat.sug${k}Q`)}`` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 149 | [CanvasChat.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/CanvasChat.tsx) · 原 181 行 | ``{t(`chat.sug${k}Q`)}`` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 150 | [CanvasChat.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/CanvasChat.tsx) · 原 187 行 | 整张画布 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 151 | [NodeContextMenu.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeContextMenu.tsx) · 原 86 行 | 生成完成后可重命名节点。 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 152 | [NodeContextMenu.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeContextMenu.tsx) · 原 104 行 | 同一问题生成一个平行的兄弟节点（各自可发展下游；配合节点模型覆盖可做模型对比） | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 153 | [NodeContextMenu.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/NodeContextMenu.tsx) · 原 136 行 | 复制此节点的上下文，粘贴进任意 CLI 新会话；那个会话被索引后作为支线挂回此节点。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 154 | [FrameSettings.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/FrameSettings.tsx) · 原 74 行 | `{t(colorLabels[name as keyof typeof colorLabels])}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 155 | [FrameSettings.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/FrameSettings.tsx) · 原 104 行 | 按当前完整包含的对象调整边界，保留留白和内容位置；空分区保持原样。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 156 | [FrameNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/FrameNode.tsx) · 原 122 行 | 分区标题… | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 157 | [FrameNode.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/FrameNode.tsx) · 原 131 行 | 已联动：拖动分区会带动完整落在框内的节点，框外节点保持原位。点击关闭，仅移动分区框 / 未联动：拖动只移动分区框，方便调整范围。点击开启后，完整落在框内的节点随框移动 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 158 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 865 行 | `{shownTitle}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 159 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 908 行 | 在页面上拖一个矩形，把这块区域摘到画布：成为独立图像素材，带页码出处；连进问题即交给视觉模型 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 160 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 920 行 | 用视觉模型把图片读成伴随文本（图中文字会被转录）。写入提取文本视图，可编辑；下游上下文读到的就是它。已有伴随文本会被覆盖。 / 没有可用的视觉模型，无法自动理解图片。连接一个带视觉能力的模型即可（工具栏模型菜单 → 配置模型 API；GLM-4V Flash 有免费档）。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 161 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 933 行 | 把整份材料整理成一篇简短直观的中文导读，(p.N) 页码可点击跳回原文。使用当前选中的模型读全文。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 162 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 954 行 | 没有可用的视觉模型，无法自动理解图片。连接一个带视觉能力的模型即可（工具栏模型菜单 → 配置模型 API；GLM-4V Flash 有免费档）。 / 用视觉模型把每页图像重排为可读的 Markdown，公式转成 KaTeX。结果写入提取副本，可以编辑，下游上下文读到的就是它。 / 这份 PDF 没有页面图像，无法识别。请确认代理端装有 poppler，然后重新上传文件。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 163 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 968 行 | 编辑提取副本。外部 OCR 工具输出的 Markdown 可以直接贴进来。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 164 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 980 行 | 停靠到画布左侧 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 165 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 1029 行 | 恢复适应宽度 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 166 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 1167 行 | 在画布上定位 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 167 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 1269 行 | 在画布上定位 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 168 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 1315 行 | 摘到画布：这段文字成为独立素材节点，带页码出处 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 169 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 1343 行 | `{shownTitle}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 170 | [MaterialReader.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/MaterialReader.tsx) · 原 1563 行 | `{a.question}` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 171 | [Markdown.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/Markdown.tsx) · 原 144 行 | 查看图表 / 查看源码 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 172 | [Markdown.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/Markdown.tsx) · 原 214 行 | `{path}` | 删除：图片内层重复触发，文件链接本身仍可查看完整路径。 |

### 模型与通用界面

| # | 位置 | 原文案 / 表达式 | 判断与措施 |
| --- | --- | --- | --- |
| 27 | [ui/WaitingPill.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/WaitingPill.tsx) · 原 20 行 | 有 Agent 在等你回答或批准，点这里去那个节点 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 28 | [ui/TopicsPanel.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/TopicsPanel.tsx) · 原 136 行 | `{x.description}` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 29 | [ui/TopicsPanel.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/TopicsPanel.tsx) · 原 148 行 | `{p.description}` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 30 | [ui/TimelineBar.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/TimelineBar.tsx) · 原 106 行 | 打开完整时间线 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 31 | [ui/ThoughtMapDialog.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ThoughtMapDialog.tsx) · 原 494 行 | 导出 (.png) | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 32 | [ui/ShareDialog.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ShareDialog.tsx) · 原 75 行 | 导出完整画布 (.json) | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 33 | [ui/SearchToggles.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/SearchToggles.tsx) · 原 62 行 | 当前模型经浏览器直连（保护它的思考流），此通道不支持搜索工具。OpenRouter 通道的模型或桌面版可用搜索。 / 联网搜索：模型自行判断何时搜索 / 联网搜索已关闭 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 34 | [ui/SearchToggles.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/SearchToggles.tsx) · 原 75 行 | 当前模型经浏览器直连（保护它的思考流），此通道不支持搜索工具。OpenRouter 通道的模型或桌面版可用搜索。 / 学术检索（arXiv + Semantic Scholar）：模型自行判断何时检索 / 学术检索已关闭 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 35 | [ui/RoleTemplateChips.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/RoleTemplateChips.tsx) · 原 22 行 | ``{tpl.prompt.length > 140 ? `${tpl.prompt.slice(0, 140)}…` : tpl.prompt}`` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 36 | [ui/RecallResults.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/RecallResults.tsx) · 原 78 行 | `{h.kind === 'memory' ? h.file : h.open}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 37 | [ui/RecallChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/RecallChip.tsx) · 原 70 行 | `{title}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 38 | [ui/RecallChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/RecallChip.tsx) · 原 79 行 | 回忆：发送时用问题里的词，去本机的对话与记忆里查原话带进上下文 / 回忆已关。开了以后，发送时会查过去的对话与记忆 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 39 | [ui/RecallChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/RecallChip.tsx) · 原 98 行 | 回忆时给判断模型看多少条候选。轻量：关键词命中里最好的 40 条，逐条读全文再判。深挖：命中里的 2,000 条，先判开头，过关的再读全文，每问约十几秒、几美分。全量：索引里的每一条对话都判，不看关键词，按索引大小计时计价。没有判断模型时只有轻量。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 40 | [ui/RecallChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/RecallChip.tsx) · 原 104 行 | 带进提问的输入 token 上限。省 4k：一份档案加五到八条对话；标准 12k：两份档案加二十来条；多带 40k：判断模型认为相关的全部带上。窗口小的模型另按窗口的四成封顶。有判断模型按相关度填，没有按排序填。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 41 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 148 行 | 配置模型 API / 模型：跟随全局 / 模型：对新的生成生效 / 未配置模型 | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 42 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 178 行 | 这一组的模型由各个 Agent 的命令行自己报告。找不到你期待的模型？多半是那个命令行版本旧了，更新它，再点刷新。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 43 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 197 行 | ``{st.error ? `${hint}\n${st.error}` : hint}`` | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 44 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 236 行 | `{m.name}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 45 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 273 行 | 刷新模型列表：重新向已配置的服务商获取 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 46 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 300 行 | 判断模型带来什么<br>• 回忆更准：按相关度挑过去的对话，宽泛的问题只带档案<br>• 地图徽章更可信：决策、转向、排除、待解由校准过的概率判定<br>• 少打扰：「上游已变」只在改动真影响回答时亮<br>• 记忆更干净：值得记的才写进画像和档案<br>• 搜索更宽容：打错的词纠正到你说过的词<br>每次判断约半秒。关掉后全部退回规则，功能不变。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 47 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 327 行 | 下一轮 Agent 思考多深，用的是这家命令行自己的档位。默认沿用它自己的设置。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 48 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 425 行 | 联网搜索用哪个服务端引擎。何时搜索仍由模型判断，这里决定搜得多好。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 49 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 465 行 | 常驻长期记忆：模型安静地记住关于你的持久事实，并在相关时使用。每次写入都会自我宣告；所有条目在管理器中统一维护。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 50 | [ui/ModelPicker.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ModelPicker.tsx) · 原 481 行 | 由哪个模型识读粘贴的图片、识别扫描页。自动模式优先最强，可能也最贵。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 51 | [ui/MemoryPage.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/MemoryPage.tsx) · 原 65 行 | 导出 (.json) | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 52 | [ui/MemoryPage.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/MemoryPage.tsx) · 原 87 行 | 改写自：{t} | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 53 | [ui/MemoryPage.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/MemoryPage.tsx) · 原 199 行 | 看这一轮 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 54 | [ui/MaterialsOverviewModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/MaterialsOverviewModal.tsx) · 原 132 行 | 在画布上定位这个节点 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 55 | [ui/MaterialsOverviewModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/MaterialsOverviewModal.tsx) · 原 137 行 | 在画布上定位这个节点 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 56 | [ui/MaterialsOverviewModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/MaterialsOverviewModal.tsx) · 原 144 行 | 在阅读器中打开 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 57 | [ui/JudgeSettings.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/JudgeSettings.tsx) · 原 65 行 | 判断模型带来什么<br>• 回忆更准：按相关度挑过去的对话，宽泛的问题只带档案<br>• 地图徽章更可信：决策、转向、排除、待解由校准过的概率判定<br>• 少打扰：「上游已变」只在改动真影响回答时亮<br>• 记忆更干净：值得记的才写进画像和档案<br>• 搜索更宽容：打错的词纠正到你说过的词<br>每次判断约半秒。关掉后全部退回规则，功能不变。 | 删除：帮助说明或诊断段落另起小窗口，产生额外层级；同时清理无作用的帮助图标/焦点。 |
| 58 | [ui/HighlightsOverviewModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/HighlightsOverviewModal.tsx) · 原 131 行 | 在画布上定位这个节点 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 59 | [ui/HighlightsOverviewModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/HighlightsOverviewModal.tsx) · 原 136 行 | 在画布上定位这个节点 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 60 | [ui/HighlightsOverviewModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/HighlightsOverviewModal.tsx) · 原 174 行 | 把全部高光导出为 Markdown 清单 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 61 | [ui/HighlighterButton.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/HighlighterButton.tsx) · 原 21 行 | 荧光笔已开启，可连续划选；再次点击或按 Esc 退出 / 开启荧光笔，划选文字即可高亮 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 62 | [ui/CondenseDialog.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/CondenseDialog.tsx) · 原 119 行 | 正在后台凝练：关闭此窗口不会中断，工具栏图标显示进度。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 63 | [ui/CondenseDialog.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/CondenseDialog.tsx) · 原 130 行 | 重新检测全图的候选段（本地计算，不调用模型） | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 64 | [ui/ApiKeyModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ApiKeyModal.tsx) · 原 281 行 | 修改模型：重新获取完整列表，已选的保持勾选，重新点选后保存即更新 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 65 | [ui/ApiKeyModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ApiKeyModal.tsx) · 原 414 行 | `{m.contextLength.toLocaleString()}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 66 | [ui/ApiKeyModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ApiKeyModal.tsx) · 原 419 行 | 支持图片理解 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 67 | [ui/ApiKeyModal.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/ApiKeyModal.tsx) · 原 423 行 | 这个模型能看图？点击切换 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 68 | [ui/AgentRerunButton.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/AgentRerunButton.tsx) · 原 30 行 | 用同一个模型以 Agent 方式重跑这个节点，它可以执行工具。新答案作为新版本保存。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 69 | [ui/AgentPermissionChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/AgentPermissionChip.tsx) · 原 95 行 | 权限 | 保留：仅响应式图标态显示名称；改为 data-tooltip。 |
| 70 | [ui/AgentPermissionChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/AgentPermissionChip.tsx) · 原 116 行 | `{a}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 71 | [ui/AgentPermissionChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/AgentPermissionChip.tsx) · 原 117 行 | 取消放行 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 72 | [ui/AgentCwdChip.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/ui/AgentCwdChip.tsx) · 原 89 行 | 工作目录 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |

### 详情面板

| # | 位置 | 原文案 / 表达式 | 判断与措施 |
| --- | --- | --- | --- |
| 173 | [focus-panel/RoleLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/RoleLine.tsx) · 原 36 行 | `{effective}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 174 | [focus-panel/RoleLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/RoleLine.tsx) · 原 41 行 | `{effective}` | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 175 | [focus-panel/ResponseSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ResponseSection.tsx) · 原 217 行 | 重新生成 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 176 | [focus-panel/ResponseSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ResponseSection.tsx) · 原 226 行 | 复制回答 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 177 | [focus-panel/ResponseSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ResponseSection.tsx) · 原 235 行 | 编辑回答 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 178 | [focus-panel/ResponseSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ResponseSection.tsx) · 原 245 行 | 生成这个版本的模型。生成时记录，之后切换全局模型也不会混淆答案的出处。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 179 | [focus-panel/RelatedSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/RelatedSection.tsx) · 原 142 行 | `{x.description}` | 删除：正文、摘要或描述全文不属于简短提示，避免大块文字跟随悬停。 |
| 180 | [focus-panel/RecallSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/RecallSection.tsx) · 原 75 行 | `{i.file}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 181 | [focus-panel/RecallSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/RecallSection.tsx) · 原 83 行 | 重新带进上下文 / 不带进上下文 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 182 | [focus-panel/index.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/index.tsx) · 原 142 行 | 未命名节点 | 保留：仅裁切时补全名称；改为 data-tooltip，使用统一文字、表面和边框。 |
| 183 | [focus-panel/HeaderActions.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/HeaderActions.tsx) · 原 106 行 | N 个角色视角：并行盲答一次，或作为评审者持续跟随 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 184 | [focus-panel/HeaderActions.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/HeaderActions.tsx) · 原 109 行 | 同一问题生成一个平行的兄弟节点（各自可发展下游；配合节点模型覆盖可做模型对比） | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 185 | [focus-panel/HeaderActions.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/HeaderActions.tsx) · 原 115 行 | 将本节点的上下文链导出为 Markdown 文档 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 186 | [focus-panel/HeaderActions.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/HeaderActions.tsx) · 原 118 行 | 以 Markdown 复制本节点的上下文链 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 187 | [focus-panel/HandoffLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/HandoffLine.tsx) · 原 33 行 | 切换后，下游已有的回答会标为上游已变 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 188 | [focus-panel/ContextChainSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ContextChainSection.tsx) · 原 33 行 | 记忆开启时,这些条目随每次普通生成进入系统层。点击管理。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 189 | [focus-panel/ContextChainSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ContextChainSection.tsx) · 原 76 行 | 上游已变 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 190 | [focus-panel/ContextChainSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ContextChainSection.tsx) · 原 141 行 | 单节点引用只传递来源节点的本轮问答。续接上文会沿用对话、材料与附件。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 191 | [focus-panel/ContextChainSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/ContextChainSection.tsx) · 原 174 行 | 这一轮的工具记录传进了本问的上下文。在那一轮的侧栏里可以关掉。 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 192 | [focus-panel/AttachmentsSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AttachmentsSection.tsx) · 原 164 行 | 在阅读器中打开 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 193 | [focus-panel/AttachmentsSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AttachmentsSection.tsx) · 原 209 行 | 在阅读器中打开 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 194 | [focus-panel/AttachmentsSection.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AttachmentsSection.tsx) · 原 225 行 | 已被上游排除，点击重新包含 / 已重新包含（覆盖上游），点击恢复上游排除 / 包含进上下文 / 从上下文排除 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 195 | [focus-panel/AgentSessionLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AgentSessionLine.tsx) · 原 31 行 | 这一轮实际使用的思考强度，来自运行时自己的记录 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 196 | [focus-panel/AgentSessionLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AgentSessionLine.tsx) · 原 33 行 | `{cwd}` | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 197 | [focus-panel/AgentSessionLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AgentSessionLine.tsx) · 原 34 行 | 这一轮接在同一个 Agent 会话上，只发送了问题 | 删除：教学性、解释性或重复状态文案占用悬浮层；功能和必要的可访问名称保留。 |
| 198 | [focus-panel/AgentSessionLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AgentSessionLine.tsx) · 原 36 行 | 打开目录 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 199 | [focus-panel/AgentSessionLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AgentSessionLine.tsx) · 原 41 行 | 在终端打开这个会话 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |
| 200 | [focus-panel/AgentSessionLine.tsx](https://github.com/linerrrrrrr/thoughtdag/blob/main/src/components/focus-panel/AgentSessionLine.tsx) · 原 49 行 | 设为这张画布的工作目录 | 保留：简短动作名、范围、快捷键或完整路径；改为 data-tooltip，禁止原生窗口。 |

## 验证范围

- npm run build、npm run lint、npm run design:check、git diff --check 均通过；90 个受管设计 token 一致。构建保留现有大包及静态/动态导入提示。
- test-tooltip-ui：保留短提示的显隐、裁切补全、键盘与组合输入、点击后不重新弹出、无原生 title、无 token/时间轴预览、时间线定位与总览通过。
- test-node-status-ui：总量与占比口径、工具次数、零值/缺失思考、标题/总量/工具/占比条拖拽、Tab 跳过静态信息、中英文 × 深浅主题 × 窄卡片通过。
- test-toolbar-responsive-ui：60 组窗口宽度/语言/阅读面板组合，以及缩放阅读面板、搜索、菜单收纳、焦点恢复、Agent 设置、只读与范式工具栏通过。
- test-conversation-gui-ui：节点/阅读面板显示、名称摘要草稿、显式保存、取消、复制/编辑/重新生成短提示、高亮列表与删除通过。
- 已查看深色中文和浅色英文窄卡片截图，token 区域无明细浮层，正文与工具栏布局正常。源码清单覆盖全部扫描站点；视觉回归覆盖上述代表场景，不宣称逐一打开了所有窗口。

截图及记录位于 local-tests/tooltip-cleanup/、local-tests/node-status/、local-tests/toolbar-responsive/、local-tests/conversation-gui/after/。浏览器回归使用独立临时数据并拦截 API，未调用真实模型或修改用户画布。
