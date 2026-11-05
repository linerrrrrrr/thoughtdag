# 悬停提示清单：阅读详情与画布问答

审计范围：`src/components/focus-panel/`、`src/components/CanvasChat.tsx`、`src/lib/canvas-chat.ts`。以源码中的提示定义计数，不按循环产生的实例数量计数。共 **47 处**，包括 1 处传给 Markdown 的探索标记提示和 2 处 HTML 字符串提示；条件分支文案归入同一处。

整改结果：**删除 11 处；将 1 处数据前移常显；3 处改为仅实际溢出时显示；2 处按内容差异精简；保留 30 处**。删除视觉提示的图标按钮保留或补充 `aria-label`。删除提示不改变关闭、发送、编辑、排序、选择及草稿逻辑。

## 判断与整改规则

- **外观及位置足够辨认：** 面板右上 X、输入末尾发送、回答旁复制与铅笔、列表上移/下移、运行时停止方块、省略号菜单。删除提示，但保留无障碍名称。
- **仍需解释：** 同样的 X 在召回条目中表示“排除上下文”，在画布问答中表示“恢复整张画布范围”；书本打开阅读器、图钉设置工作目录、刷新箭头重新生成、垃圾桶删除当前版本等有业务范围差异，保留短提示。
- **可见文字不能代替规则：** 引用深度、附件继承覆盖、工具记录传递、高亮过滤、模型来源等说明提供额外语义，保留。
- **不重复完整可见正文：** 节点名称和角色全文只在被裁剪时补全。已主动缩写成末两段的工作目录仍需完整路径，不能仅检查 CSS 溢出。
- **数字必须可解释：** 建议词原先只在悬停显示裸数字，改为常显括号命中数，复用已有说明文字。

## 完整逐处清单

“原位置”使用审计开始时的源码行号，方便对应原实现；修改后可按 key 或 `data-*` 标识定位。表格里的“保留”表示内容有补充价值，不代表所有提示都应在所有状态下显示。

| # | 原位置 | 原提示 / key | 判断与已落实措施 |
| --- | --- | --- | --- |
| 1 | `CanvasChat.tsx:121` | 引用编号对应的 `nodeLabel`；找不到节点时退回编号 | 编号本身不能说明引用内容。保留真实节点完整名；找不到节点时移除重复编号提示。 |
| 2 | `CanvasChat.tsx:139` | `common.close`：关闭 | X 与面板位置清楚。删除提示，改为 `aria-label`。 |
| 3 | `CanvasChat.tsx:148` | 空状态建议的 `chat.sugOverviewQ / LocateQ / GroundsQ / CompareQ / ProgressQ`：总览、定位、溯源、比对、进展对应的完整问句 | 短标签不能说明完整输入内容，保留问句预览。点击仍只填草稿。 |
| 4 | `CanvasChat.tsx:181` | 有对话时同组 `chat.sug*Q` 完整问句 | 同上，保留。此处是另一套渲染位置。 |
| 5 | `CanvasChat.tsx:187` | `chat.focusAll`：整张画布 | X 在这里更改提问范围，并非关闭窗口；保留，避免仅凭形状误判。 |
| 6 | `CanvasChat.tsx:201` | `chat.send`：发送 | 输入框末端的发送按钮位置与图标明确。删除提示，保留 `aria-label`。 |
| 7 | `AgentSessionLine.tsx:31` | `agent.effortTitle`：本轮实际思考强度来自运行时记录 | `effort` 值本身不能说明其来源，保留。 |
| 8 | `AgentSessionLine.tsx:33` | 完整 `cwd` 路径 | 可见值只取末两段；保留完整路径，不能错误地仅按 CSS 是否溢出判断。 |
| 9 | `AgentSessionLine.tsx:34` | `agent.continuedTitle`：接在同一会话，只发送问题 | “接续”标签没有展示实际发送语义，保留。 |
| 10 | `AgentSessionLine.tsx:36` | `agent.openDir`：打开目录 | 文件夹图标可能用于选择或打开目录。保留短动作名，补 `aria-label`。 |
| 11 | `AgentSessionLine.tsx:41` | `agent.openInTerminal`：在终端打开这个会话 | 终端图标不能说明是恢复当前会话，保留，补 `aria-label`。 |
| 12 | `AgentSessionLine.tsx:49` | `agent.useAsCwd`：设为这张画布的工作目录 | 图钉也可能表示收藏或置顶；保留实际作用，补 `aria-label`。 |
| 13 | `AttachmentsSection.tsx:164` | 自有附件 `attach.openReader`：在阅读器中打开 | 书本图标不能单独说明打开对象与位置，保留，补 `aria-label`。 |
| 14 | `AttachmentsSection.tsx:208` | 继承附件 `attach.openReader` | 同上，保留并补 `aria-label`。 |
| 15 | `AttachmentsSection.tsx:223` | `attach.titleExcludedUpstream / titleReIncluded / titleInclude / titleExclude`：上游排除、覆盖恢复、包含和排除上下文 | 按钮正文主要表达当前状态，提示解释点击后的作用与继承关系，保留全部状态。 |
| 16 | `ContextChainSection.tsx:33` | `memory.rowTitle`：记忆如何进入系统层，点击管理 | 记忆标签与数量不能说明注入规则，保留。 |
| 17 | `ContextChainSection.tsx:76` | `node.staleBadge`：上游已变 | 黄色点没有可读语义，保留状态说明。 |
| 18 | `ContextChainSection.tsx:141` | `edge.depthToggleTitle`：单节点引用与续接上文的上下文范围 | 符号和短标签无法说明材料、附件、祖先是否传递，保留。 |
| 19 | `ContextChainSection.tsx:174` | `chain.toolsInTitle`：本轮工具记录已传入本问，可回来源侧栏关闭 | 数量标签不能表达传递来源及管理入口，保留。 |
| 20 | `ContextOrderSection.tsx:54` | `panel.ctxOrderUp`：整块提前 | 有序列表中的向上箭头可辨，删除提示，保留 `aria-label`。 |
| 21 | `ContextOrderSection.tsx:63` | `panel.ctxOrderDown`：整块置后 | 有序列表中的向下箭头可辨，删除提示，保留 `aria-label`。 |
| 22 | `HeaderActions.tsx:82` | `actions.stop`：停止 | 运行状态下的红色停止方块可辨，删除提示，保留 `aria-label`。 |
| 23 | `HeaderActions.tsx:91` | `panel.more`：更多操作 | 省略号菜单可辨，删除提示，保留原 `aria-label / aria-expanded`。 |
| 24 | `HeaderActions.tsx:106` | `fanout.entryTitle`：多个角色并行盲答或持续评审 | 短菜单项没有说明两类工作模式，保留额外说明。 |
| 25 | `HeaderActions.tsx:109` | `actions.regenBranchTitle`：生成平行兄弟节点，可独立发展下游 | 与原地重新生成结果不同，保留，避免误判影响范围。 |
| 26 | `HeaderActions.tsx:115` | `actions.exportTitle`：将本节点的上下文链导出为 Markdown | 可见“导出 Markdown”未说明导出包含上游，保留范围说明。 |
| 27 | `HeaderActions.tsx:118` | `actions.copyTitle`：以 Markdown 复制本节点上下文链 | 可见菜单文案未完整表达复制范围，保留。 |
| 28 | `HandoffLine.tsx:33` | `handoff.toggleTitle`：切换后下游已有回答会标为上游已变 | 当前传递状态与正文说明没有说明失效标记后果，保留。 |
| 29 | `HighlightsSection.tsx:72` | `highlight.hintTag / hintFilter`：添加重点标记 / 下游只收到高亮部分 | 两个短选项背后有上下文差异，保留两种说明。 |
| 30 | `HighlightsSection.tsx:86` | `highlight.exploreTitle`：就高亮内容追问 | “探索”可作用于正文选区或所有高亮，此处补充作用范围，保留。 |
| 31 | `focus-panel/index.tsx:143` | `getNodeNameSource` 完整节点名 | 完整可见时重复。添加 `data-tooltip-overflow`，仅被裁剪时显示。 |
| 32 | `focus-panel/index.tsx:150` | `panel.close`：关闭详情 | X 可辨，删除提示，保留现有 `aria-label`。 |
| 33 | `QuestionSection.tsx:150` | `actions.editQuestion`：编辑问题 | 问题旁的铅笔与编辑位置明确，删除提示，保留 `aria-label`。 |
| 34 | `RecallSection.tsx:75` | `i.file`：召回内容的原始文件路径 | 可见标签仅有来源和日期，保留路径信息。 |
| 35 | `RecallSection.tsx:83` | `panel.recallInclude / recallExclude`：重新带入 / 不带入上下文 | X 在这里是排除上下文，并非删除原始记录；保留并补 `aria-label`。 |
| 36 | `RelatedSection.tsx:142` | `x.description`：主题说明 | 主题短名不包含范围说明，保留。 |
| 37 | `RelatedSection.tsx:151` | `s.count`：无单位的裸数字 | 原提示难以理解且不易比较。删除提示；显示 `+ 词 (n)`，并复用 `panel.relatedSuggested` 常显说明括号为索引命中数。 |
| 38 | `RoleLine.tsx:36` | 只读角色 `effective` 全文 | 完整可见时重复。添加 `data-tooltip-overflow`，仅被裁剪时显示。 |
| 39 | `RoleLine.tsx:41` | 可编辑角色 `effective + role.edit` | 文字样式已表明可点击；全文仅被裁剪时显示。提示去掉重复“修改”，以 `aria-label` 保留动作与角色名。 |
| 40 | `ResponseSection.tsx:57` | `node.exploredHere` + 分支问题前 80 字 | 标记说明文本已有探索分支及跳转目标，保留。该定义由 Markdown 生成真正的 tooltip。 |
| 41 | `ResponseSection.tsx:280` | `common.regenerate`：重新生成 | 刷新箭头可能表示重载，而这里会再次调用模型，保留并补 `aria-label`。 |
| 42 | `ResponseSection.tsx:287` | `actions.copyResponse`：复制回答 | 回答操作行中的复制图标与对象明确。删除提示，保留 `aria-label`。 |
| 43 | `ResponseSection.tsx:303` | `actions.editResponse`：编辑回答 | 回答旁铅笔图标与对象明确。删除提示，保留 `aria-label`。 |
| 44 | `ResponseSection.tsx:313` | `node.generatedByTitle` + 模型与思考强度 | 补充“记录于生成时、不会随全局模型切换”的来源规则，保留。 |
| 45 | `ResponseSection.tsx:326` | `common.deleteVersion`：删除此版本 | 垃圾桶可能被误解为删除整个节点；保留版本范围并补 `aria-label`。 |
| 46 | `lib/canvas-chat.ts:177` | 无法解析引用的 `?` | 内容已带问号，提示只重复问号。删除。 |
| 47 | `lib/canvas-chat.ts:181` | 显示编号时提示完整名；显示节点名时反而提示编号 | 保留编号到节点名的映射；统一仅在显示值与完整名不同的时候提示完整名，避免重复和无意义编号。 |

## 验证

- 本范围 ESLint 已通过：`npx eslint src/components/focus-panel src/components/CanvasChat.tsx src/lib/canvas-chat.ts`。
- 3 个 `data-tooltip-overflow` 定义依赖共享 `GlobalTooltip` 的实际溢出判断，由主审计统一实现与浏览器验证。
- 未修改 i18n；建议词命中数解释复用既有中英文文案。
- `CanvasChat.tsx` 原有未提交变更已保留，仅修改相关提示属性。
