# 悬停提示审计：画布、节点与材料阅读

审计日期：2026-11-05。范围为 `src/components/` 顶层组件，排除主清单中的 ProjectSwitcher、CanvasChat、CanvasDetailControl、DiagnosticsPanel、SearchBar。共 **22 个文件、123 个原始源码站点**；循环仅算一个站点，动态取值按同一站点列出。Markdown 运行时生成引用 `title` 也计入。行号是整改前定位，当前文件可能因新增入口顺延。

## 判断与整改

- 外观足以识别：关闭 X、折叠箭头、调宽/调高/角部手柄、缩放加减、代码/回答复制、明确发送与停止。移除视觉提示，保留可访问名称。删除节点的 X 与普通关闭不同，保留“删除”。
- 文字已经足够：节点/线条模式、搜索开关和合并摘要无需重复说明。当前选区工具栏始终显示类型与命中数，原有纯图标选择器已移除；日期仍保留“当前版本生成时间”，避免与创建时间混淆。
- 有新增信息：来源、陈旧、上下文、归档、模型与版本、禁用原因、复杂批量处理、Token 组成保留。
- 内容补全：CSS 截断的名称、摘要和文件名仅溢出时出现；主动缩写和 basename 仍保留全文，避免误用 CSS 溢出判断。
- 大范围遮挡：整张极简卡片重复提示移除，集中到名称；便笺正文“双击编辑”改由头部编辑按钮承接；整幅图像的长提取文本改由已有提取内容入口查看。

## 落实统计

| 处理 | 原站点数 |
| --- | ---: |
| 移除 | 17 |
| 保留 | 75 |
| 条件保留：溢出或已缩写 | 3 |
| 条件保留：仅溢出 | 9 |
| 移除；保留可访问名称 | 14 |
| 改为常显说明 | 1 |
| 移除；补选中语义 | 2 |
| 条件保留：存在草稿 | 2 |

另新增 **1 个无悬停提示的编辑按钮**：便笺头部铅笔图标，以 `content.editNote`（编辑便笺）提供可访问名称。它复用原编辑函数和会话草稿，保留正文双击；替代原正文整块提示。角色插入说明改为常显文字。

## 逐处清单

### BatchEdgeInspector.tsx

源文件：[BatchEdgeInspector.tsx](../../src/components/BatchEdgeInspector.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 76 | `common.close`：关闭 | 移除：关闭 X 已明确；保留 aria-label。 |

### ContentNode.tsx

源文件：[ContentNode.tsx](../../src/components/ContentNode.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 195 | `glyph.file`：文件；`glyph.link`：链接；`glyph.note`：便签 | 移除：整张极简卡片重复弹出内容；名称已有专用完整内容入口。 |
| 270 | `content.clipSourceTitle`：摘取出处：点击回到原文这一页 | 保留：页码来源跳转的用途并不由来源短名直接说明。 |
| 278 | `content.unlinkedTitle`：尚未连线，只是画布材料。向某个节点连一条线，它就会进入该节点的上下文。 | 保留：未连线状态影响下游上下文，需要解释。 |
| 286 | `reader.open`：阅读并提问 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 297 | `content.linkOpen`：打开链接 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 319 | `{nodeNameSource}` | 条件保留：溢出或已缩写：名称完整显示时不重复；主动缩写时保留原文。 |
| 322 | `{data.recallSource.file}` | 保留：显示来源摘要，提示补充完整文件路径。 |
| 347 | `content.noteEditTitle`：双击编辑 | 移除：正文整块悬停遮挡阅读；改为头部编辑便笺入口，保留双击。 |
| 399 | `{att.extractedText ? att.extractedText.slice(0, 400) : undefined}` | 移除：整幅图片悬停长段提取文本遮挡；已有提取内容按钮可展开。 |
| 410 | `content.editExtractTitle`：查看 / 编辑提取内容：下游上下文读到的就是这段文本 | 保留：提取副本决定下游模型所读内容，说明有独立价值。 |
| 420 | `content.reExtractTitle`：用视觉模型提取这张图的内容（物体、文字、图表结构），作为图片的伴随文本进入下游上下文 | 保留：提取会调用视觉模型并写入伴随文本，不能从重试图标判断。 |
| 463 | `{att.name}` | 条件保留：仅溢出：仅文件名实际截断时展示完整名称。 |

### ConversationLink.tsx

源文件：[ConversationLink.tsx](../../src/components/ConversationLink.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 26 | `{value.target.path}` | 条件保留：仅溢出：完整路径仅实际截断时补全。 |
| 27 | `local.reveal`：在文件夹中显示 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 28 | `common.close`：关闭 | 移除：关闭 X 已明确；保留 aria-label。 |
| 86 | `{target ? `${target.path}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ''}` : ''}` : props.title}` | 保留：链接可显示别名；完整目标路径和行列位置是补充信息。 |
| 110 | `{target.path}` | 保留：菜单只显示 basename，完整路径仍需保留。 |

### EdgeInspector.tsx

源文件：[EdgeInspector.tsx](../../src/components/EdgeInspector.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 126 | `common.close`：关闭 | 移除：关闭 X 已明确；保留 aria-label。 |
| 134 | `edgeEditor.locateNode`：定位：{name} | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 168 | `edgeEditor.delete`：删除连线 | 移除：垃圾桶位于连线编辑器，删除对象明确；保留 aria-label。 |

### FrameNode.tsx

源文件：[FrameNode.tsx](../../src/components/FrameNode.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 122 | `frame.titlePlaceholder`：分区标题… | 条件保留：仅溢出：分区名称仅实际截断时补全。 |
| 131 | `frame.carryOn`：已联动：拖动分区会带动完整落在框内的节点，框外节点保持原位。点击关闭，仅移动分区框；`frame.carryOff`：未联动：拖动只移动分区框，方便调整范围。点击开启后，完整落在框内的节点随框移动 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |

### FrameSettings.tsx

源文件：[FrameSettings.tsx](../../src/components/FrameSettings.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 74 | `{t(colorLabels[name as keyof typeof colorLabels])}` | 保留：色块有外观，但颜色名称有助于低色辨识用户。 |
| 104 | `frame.fitHint`：按当前完整包含的对象调整边界，保留留白和内容位置；空分区保持原样。 | 保留：适配范围、位置不变与空分区行为不能由按钮名称推断。 |

### Markdown.tsx

源文件：[Markdown.tsx](../../src/components/Markdown.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 89 | `common.copyCode`：复制代码 | 移除；保留可访问名称：复制图标位于代码块右上角，作用明确；补 aria-label。 |
| 144 | `md.diagramView`：查看图表；`md.diagramSource`：查看源码 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 214 | `{path}` | 保留：图像来源路径为额外信息。 |
| 219 | `{path}` | 保留：仅显示 basename 的图片链接需要完整路径。 |
| 317 | `em.title (generated mark title)` | 保留：探索标记只显示短引用；原节点标题是补充信息。 |

### MaterialReader.tsx

源文件：[MaterialReader.tsx](../../src/components/MaterialReader.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 812 | `reader.switchMaterial`：切换材料 | 移除；保留可访问名称：标题旁下拉箭头已说明切换材料；保留 aria-label。 |
| 833 | `{shownTitle}` | 条件保留：仅溢出：材料名称仅实际截断时补全。 |
| 876 | `reader.clipTitle`：在页面上拖一个矩形，把这块区域摘到画布：成为独立图像素材，带页码出处；连进问题即交给视觉模型 | 保留：矩形摘录、独立素材与出处语义需要说明。 |
| 888 | `reader.imageRecognizeTitle`：用视觉模型把图片读成伴随文本（图中文字会被转录）。写入提取文本视图，可编辑；下游上下文读到的就是它。已有伴随文本会被覆盖。；`content.noVisionModel`：没有可用的视觉模型，无法自动理解图片。连接一个带视觉能力的模型即可（工具栏模型菜单 → 配置模型 API；GLM-4V Flash 有免费档）。 | 保留：识别用途、覆盖既有提取内容以及无视觉模型原因需要说明。 |
| 901 | `reader.digestTitle`：把整份材料整理成一篇简短直观的中文导读，(p.N) 页码可点击跳回原文。使用当前选中的模型读全文。 | 保留：整份材料导读的范围和模型调用不能由短按钮完整表达。 |
| 922 | `content.noVisionModel`：没有可用的视觉模型，无法自动理解图片。连接一个带视觉能力的模型即可（工具栏模型菜单 → 配置模型 API；GLM-4V Flash 有免费档）。；`reader.recognizeTitle`：用视觉模型把每页图像重排为可读的 Markdown，公式转成 KaTeX。结果写入提取副本，可以编辑，下游上下文读到的就是它。；`reader.noImages`：这份 PDF 没有页面图像，无法识别。请确认代理端装有 poppler，然后重新上传文件。 | 保留：缺模型/图像的禁用原因与识别副本用途需要说明。 |
| 936 | `reader.editText`：编辑提取副本。外部 OCR 工具输出的 Markdown 可以直接贴进来。 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 944 | `reader.expand`：展开全屏 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 948 | `reader.dock`：停靠到画布左侧 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 952 | `panel.close`：关闭面板 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 995 | `reader.imageZoomOut`：缩小 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 997 | `reader.imageZoomFit`：恢复适应宽度 | 保留：百分比只显示当前值，点击恢复适应宽度不是明显含义。 |
| 999 | `reader.imageZoomIn`：放大 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 1042 | `reader.locate`：在画布上定位 | 移除：画布文字与定位图标组合已说明作用。 |
| 1130 | `reader.locate`：在画布上定位 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 1137 | `reader.threadClose`：收起答案栏 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 1232 | `reader.locate`：在画布上定位 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 1278 | `reader.saveAsNote`：摘到画布：这段文字成为独立素材节点，带页码出处 | 保留：便笺图标不能独自说明摘录与页码出处。 |
| 1302 | `reader.stripExpand`：展开原文（收起节点面板） | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 1306 | `{shownTitle}` | 条件保留：仅溢出：材料名称仅实际截断时补全。 |
| 1308 | `reader.expand`：展开全屏 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 1311 | `panel.close`：关闭面板 | 移除；保留可访问名称：展开、关闭、加减缩放或折叠箭头已有明确外观；用 aria-label 保留操作名称。 |
| 1330 | `panel.resizeTitle`：拖动调整宽度 · 双击恢复默认 | 移除；保留可访问名称：边界手柄及调宽光标足够；保留可访问说明。 |
| 1526 | `{a.question}` | 保留：批注气泡只显示图标，提示补全其问题内容。 |

### NodeContextMenu.tsx

源文件：[NodeContextMenu.tsx](../../src/components/NodeContextMenu.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 86 | `ctx.renameBusy`：生成完成后可重命名节点。 | 保留：保留生成期间不可改名的原因。 |
| 104 | `actions.regenBranchTitle`：同一问题生成一个平行的兄弟节点（各自可发展下游；配合节点模型覆盖可做模型对比） | 保留：重新生成实际创建平行兄弟节点，需要区分。 |
| 136 | `exp.copyForCliTitle`：复制此节点的上下文，粘贴进任意 CLI 新会话；那个会话被索引后作为支线挂回此节点。 | 保留：复制上下文用于新会话并挂回支线，超出“复制”字面。 |

### NodeDetailsButton.tsx

源文件：[NodeDetailsButton.tsx](../../src/components/NodeDetailsButton.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 14 | `ctx.openPanel`：查看详情 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |

### NodeMetadataEditor.tsx

源文件：[NodeMetadataEditor.tsx](../../src/components/NodeMetadataEditor.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 130 | `{name}` | 条件保留：仅溢出：名称/摘要仅实际行数或宽度截断时补全。 |
| 133 | `{previewText}` | 条件保留：仅溢出：名称/摘要仅实际行数或宽度截断时补全。 |

### NodeOverview.tsx

源文件：[NodeOverview.tsx](../../src/components/NodeOverview.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 30 | `{source \|\| name}` | 条件保留：溢出或已缩写：CSS 截断时补全；主动缩写名称仍可查看原文。 |
| 34 | `{meta}` | 条件保留：仅溢出：元信息仅实际截断时补全。 |

### NodeResizeControls.tsx

源文件：[NodeResizeControls.tsx](../../src/components/NodeResizeControls.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 118 | `format.lockAspectRatio`：锁定纵横比 | 移除：方向手柄及光标足够；保留尺寸方向与锁比例的 aria-label。 |

### NodeTokenUsage.tsx

源文件：[NodeTokenUsage.tsx](../../src/components/NodeTokenUsage.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 91 | `{fallback}` | 保留：总量、占比与工具明细共享一个提示；属于必要数据解释。 |

### ParadigmNode.tsx

源文件：[ParadigmNode.tsx](../../src/components/ParadigmNode.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 73 | `{t(labelKey as Parameters<typeof t>[0])}` | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 117 | `paradigm.insertPersona`：把这个人设插入 Prompt 开头 | 改为常显说明：整组角色区域提示过宽；改为常显短说明。 |
| 135 | `toolbar.webSearch`：联网搜索：模型自行判断何时搜索；`toolbar.webSearchOff`：联网搜索已关闭 | 移除；补选中语义：搜索文字与选中样式可识别；删除重复提示并补 aria-pressed。 |
| 144 | `toolbar.scholarSearch`：学术检索（arXiv + Semantic Scholar）：模型自行判断何时检索；`toolbar.scholarSearchOff`：学术检索已关闭 | 移除；补选中语义：搜索文字与选中样式可识别；删除重复提示并补 aria-pressed。 |

### SelectionArrangeMenu.tsx

源文件：[SelectionArrangeMenu.tsx](../../src/components/SelectionArrangeMenu.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 53 | `arrange.minimum`：至少需要 {n} 个独立对象 | 保留：只在不满足数量时提示禁用原因。 |
| 124 | `frame.selectionContainsFrame`：请选中节点来创建分区，当前选区已包含分区框；`frame.createFromSelectionHint`：按当前所选节点范围创建分区并开启区域联动，保留节点位置与连线 | 保留：保留分区创建范围与包含分区时的禁用原因。 |

### SelectionResizeControls.tsx

源文件：[SelectionResizeControls.tsx](../../src/components/SelectionResizeControls.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 155 | `selection.resizeWidth`：批量调整宽度（左右方向键；Shift 加速至 10 px）；`selection.resizeHeight`：批量调整高度（上下方向键；Shift 加速至 10 px）；`selection.resizeBoth`：批量调整尺寸（方向键；Shift 加速至 10 px） | 移除：方向手柄及光标足够；保留 aria-label。 |

### SelectionTargetControl.tsx

源文件：[SelectionTargetControl.tsx](../../src/components/SelectionTargetControl.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 42 | `selection.target`：框选对象；`selection.nodes`：节点；`selection.edges`：线条 | 移除：当前实现为框选后的独立工具栏，始终显示“节点／线条”及命中数，文字已经足够。 |
| 50 | `selection.target`：框选对象；`selection.nodes`：节点；`selection.edges`：线条 | 移除：当前实现已移除最窄模式的透明文字选择器，由上述常显文字入口承接。 |

### SelectionToolbar.tsx

源文件：[SelectionToolbar.tsx](../../src/components/SelectionToolbar.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 179 | `common.cancel`：取消 | 移除：取消 X 与标题折叠箭头已明确；保留 aria-label / aria-expanded。 |
| 248 | `frame.expandSettings`：展开分区设置；`frame.collapseSettings`：收起分区设置；`format.expand`：展开对象格式；`format.collapse`：收起对象格式 | 移除：取消 X 与标题折叠箭头已明确；保留 aria-label / aria-expanded。 |
| 263 | `ctx.unnamedNode`：未命名节点 | 条件保留：仅溢出：所选节点名称仅实际截断时补全。 |
| 299 | `toolbar.mergeSummaryTitle`：将内容合并为一个摘要节点 | 移除：“合并摘要”按钮已准确说明生成摘要节点。 |
| 300 | `toolbar.mergeDeleteTitle`：生成合并摘要后删除原节点 | 保留：生成后删除原节点的后果应明确。 |
| 301 | `toolbar.exploreTitle`：就选中节点提问 | 保留：探索具体作用于当前选择，短名称不足以说明。 |
| 302 | `toolbar.weaveTitle`：把圈选节点中你标过的高光串成一段带引用的文字 | 保留：串联的是标过的高亮，范围不能由图标判断。 |
| 303 | `archive.batchTitle`：归档选中节点（淡化显示、排除出上下文、可恢复） | 保留：归档同时排除上下文且可恢复，不等于删除。 |
| 304 | `toolbar.reselectLaddersTitle`：用当前选中的模型为选中的节点更新四层摘要；文件、便签和短回答自动跳过，进度在右下角，随时可停 | 保留：更新会调用模型、跳过部分节点并产生后台进度，需要说明。 |
| 322 | `toolbar.duplicateTitle`：把选中节点整体复制一份（内部连线保留，跨出选区的连线不带走） | 保留：只复制内部连线的边界行为不直观。 |
| 323 | `toolbar.exportTitle`：将选中节点导出为 Markdown 文档 | 保留：短导出名称未显示 Markdown 格式。 |

### SessionAtlas.tsx

源文件：[SessionAtlas.tsx](../../src/components/SessionAtlas.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 125 | `atlas.handoffRemove`：移除 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 409 | `atlas.terminalChoice`：在终端打开时使用的终端 | 保留：终端选择器决定后续打开方式，保留用途说明。 |
| 566 | `switcher.archive`：归档（从列表隐藏，数据保留） | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 599 | `atlas.restoreOpen`：还原并打开 | 保留：点击归档条目会先还原再打开，区别于普通查看。 |
| 690 | `{`⑂ ${threadForks.get(card.sessionId)}`}` | 保留：分叉图形不展示实际分支来源信息。 |
| 705 | `{home.name}` | 保留：“在画布”标签未显示所属画布名。 |
| 724 | `atlas.pickForMerge`：选入合并 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 732 | `atlas.import`：导入为画布 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 735 | `atlas.recast`：重新镜像（丢弃画布修改） | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 745 | `atlas.mountTo`：挂载到画布… | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 755 | `atlas.openApp`：在 App 中打开（{name}） | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 764 | `atlas.openTerminal`：在终端打开 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 806 | `common.cancel`：取消 | 移除；保留可访问名称：取消 X 已明确；补 aria-label。 |

### ThoughtEdgeView.tsx

源文件：[ThoughtEdgeView.tsx](../../src/components/ThoughtEdgeView.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 110 | `edgeEditor.title`：编辑连线 | 保留：注释文字本身不说明可打开连线编辑器。 |

### ThoughtNode.tsx

源文件：[ThoughtNode.tsx](../../src/components/ThoughtNode.tsx)

| 原行 | 原提示（文案或动态表达式） | 判定与已落实措施 |
| ---: | --- | --- |
| 437 | `{staleTitle}` | 保留：颜色状态点需说明陈旧原因。 |
| 442 | `{nodeNameSource}` | 移除：整张极简卡片重复提示；具体名称区域保留完整原文。 |
| 453 | `{badgeTitle}` | 保留：极简标志需补充节点状态。 |
| 485 | `node.condensedFromTitle`：这个节点由原树的一段轮次蒸馏而来。点击高亮并跳到原段。 | 保留：节点的凝练来源关系需说明。 |
| 495 | `{staleTitle}` | 保留：陈旧状态及原因不是单凭图标可知。 |
| 503 | `archive.badgeTitle`：已归档：可见但不进入任何上下文 | 保留：归档影响上下文，而不只是视觉淡化。 |
| 522 | `{data.appliedRole}` | 条件保留：溢出或已缩写：角色文字只在 CSS 截断或主动 slice 时补全。 |
| 539 | `{`${label}${pinNote}`}` | 保留：界面只显示模型简称；提示包含完整标识与下一轮固定模型。 |
| 550 | `actions.stop`：停止 | 移除；保留可访问名称：运行中红色方形按钮表达停止；补 aria-label。 |
| 557 | `common.delete`：删除 | 保留：X 在此会删除节点，容易误认成关闭，必须明确。 |
| 583 | `node.openAtPage`：回到阅读器第 {n} 页，展开这条对话 | 保留：页码标记的返回原文行为需要说明。 |
| 621 | `common.send`：发送 | 移除：圆形发送按钮及箭头已有明确外观；保留 aria-label。 |
| 682 | `edit.resumeDraft`：继续编辑草稿；`actions.editQuestion`：编辑问题 | 条件保留：存在草稿：铅笔表达编辑问题；仅有保留草稿时提示继续编辑。 |
| 805 | `paradigm.expandTitle`：把这一步扇出为预配的角色分支，何时展开由你决定 | 保留：角色分支展开的业务含义不由图标自明。 |
| 848 | `evaluator.rerun`：立即重新评审；`common.regenerate`：重新生成 | 保留：重新评估与重新生成的业务动作需区分。 |
| 856 | `actions.copyResponse`：复制回答 | 移除；保留可访问名称：回答尾部复制图标作用明确；补 aria-label。 |
| 870 | `edit.resumeDraft`：继续编辑草稿；`actions.editResponse`：编辑回答 | 条件保留：存在草稿：铅笔表达编辑回答；仅有保留草稿时提示继续编辑。 |
| 878 | `focus.inContext`：在这个节点的上下文中 | 保留：上下文参与状态仅为色点，须有文字解释。 |
| 883 | `node.generatedByTitle`：生成这个版本的模型。生成时记录，之后切换全局模型也不会混淆答案的出处。 | 保留：模型简称需补全实际生成模型及推理强度。 |
| 889 | `agent.continuedTitle`：这一轮接在同一个 Agent 会话上，只发送了问题 | 保留：同会话继续且仅发送问题的技术行为不是短标签可知。 |
| 895 | `agent.openInTerminal`：在终端打开这个会话 | 保留：短标签或业务图标不能完整说明此动作、对象或状态。 |
| 902 | `node.gatewaySearchedTitle`：这个版本的回答由模型网关联网搜索后生成。 | 保留：网关搜索来源与执行位置的说明有额外信息。 |
| 907 | `node.generatedAtTitle`：这个版本的生成时间 | 保留：日期外观不能区分节点创建时间与当前版本生成时间。 |
| 920 | `common.deleteVersion`：删除此版本 | 保留：删除对象为当前版本，区别于删除节点。 |
| 936 | `node.backToVersionTitle`：生成失败不覆盖历史：切回之前的版本 | 保留：失败后可恢复历史版本的说明需保留。 |

## 验证

已对本范围 16 个实际修改组件运行 ESLint，通过。整体验证与浏览器结果由主审计清单汇总；本清单不将静态检查写成视觉验收。
