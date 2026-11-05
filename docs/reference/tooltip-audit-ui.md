# 悬停提示审计：通用 UI 组件

范围：`src/components/ui/`，不含共享 `GlobalTooltip`。整改前共 **64 处**：63 个原生 `title` 站点与 1 个时间线自定义预览；循环和条件分支按源码站点计。`ThoughtMapDialog` 的 `title` 是海报组件数据，不属于悬停提示。

判定：删除 16 处；转为正文 4 处；条件显示 4 处；保留 40 处（含自定义预览）。移除可视提示后保留可访问名称。仅显示尾名、数量缩写等主动省略内容继续提供全文；只有 CSS 截断才使用溢出判断。整改不改变提交、选择、授权、删除和退出行为。

下表行号为整改前定位，表达式及文件用于追踪原始入口。

| # | 原位置 | 原提示（i18n key / 动态内容） | 判定与落实 |
| --- | --- | --- | --- |
| 1 | `AgentActivityView.tsx:108` | `{status}` | **删除**：状态文字已常显，重复提示。 |
| 2 | `AgentCwdChip.tsx:89` | `{`${t('agent.cwd')} · ${choice.cwd}`}`<br>工作目录 | **保留**：触发器只展示目录尾名，保留完整工作目录。 |
| 3 | `AgentMemoryFiles.tsx:99` | `{t('recall.cite')}`<br>引用 | **删除**：引用文字已常显。 |
| 4 | `AgentMemoryFiles.tsx:102` | `{t('recall.import')}`<br>导入 | **删除**：导入文字已常显。 |
| 5 | `AgentPermissionChip.tsx:95` | `{`${t('agent.perm')} · ${t(LABEL[shown])}`}`<br>权限 | **按需**：当前权限文字已常显；仅响应式图标态显示，保留可访问名称。 |
| 6 | `AgentPermissionChip.tsx:116` | `{a}` | **按需**：完整路径仅在 CSS 截断时提示。 |
| 7 | `AgentPermissionChip.tsx:117` | `{t('agent.guardRemove')}`<br>取消放行 | **保留**：X 代表撤销位置放行，属于权限操作而非普通关闭。 |
| 8 | `AgentRerunButton.tsx:30` | `{t('node.agentRerunTitle')}`<br>用同一个模型以 Agent 方式重跑这个节点，它可以执行工具。新答案作为新版本保存。 | **保留**：重跑使用工具且另存版本，文字未包含作用范围。 |
| 9 | `ApiKeyModal.tsx:281` | `{t('provider.refreshTitle')}`<br>修改模型：重新获取完整列表，已选的保持勾选，重新点选后保存即更新 | **保留**：铅笔实际重新获取并修改模型列表，不只是改名。 |
| 10 | `ApiKeyModal.tsx:284` | `{t('common.delete')}`<br>删除 | **删除**：行内垃圾桶已明确表示删除；改为 aria-label。 |
| 11 | `ApiKeyModal.tsx:414` | `{m.contextLength.toLocaleString()}` | **保留**：k/M 是缩写，保留精确上下文窗口数值。 |
| 12 | `ApiKeyModal.tsx:419` | `{t('provider.visionYes')}`<br>支持图片理解 | **保留**：相机表示图片理解能力，需要解释语义。 |
| 13 | `ApiKeyModal.tsx:423` | `{t('provider.visionToggle')}`<br>这个模型能看图？点击切换 | **保留**：手工切换图片理解能力，并非拍照。 |
| 14 | `ApprovalCard.tsx:116` | `{t(request.rule.startsWith('harness:') ? 'approval.allowSessionExactTitle' : 'approval.allowSessionTitle')}`<br>完全相同的这一步（同一个工具、同样的参数）在这个会话里不再询问，每次都会记在记录里。 / 这一项以及同样的请求，在这张画布里以后不再询问，每次都会记在记录里。 | **正文**：持续放行范围是决定前必要信息；移到按钮下方可见说明。 |
| 15 | `ApprovalCard.tsx:123` | `{`${t('approval.allowLocationTitle')} ${request.suggest}`}`<br>从现在起放行这个位置： | **正文**：永久放行的完整位置应可见；移到按钮下方可见说明。 |
| 16 | `ApprovalCard.tsx:189` | `{compact ? o.description : undefined}` | **正文**：选项解释直接显示，紧凑模式也可读。 |
| 17 | `CondenseDialog.tsx:101` | `{run.status === 'building' ? t('condense.runningBg') : undefined}`<br>正在后台凝练：关闭此窗口不会中断，工具栏图标显示进度。 | **保留**：运行中关闭不取消任务，保留背景运行说明并补关闭名称。 |
| 18 | `CondenseDialog.tsx:108` | `{t('condense.copyIntroFull')}`<br>生成一棵凝练副本放在原树右侧：勾选的连续段坍缩成蒸馏节点（决策与结论清单，高光原文保真），其余节点原样复制、连线照接。原树一个字都不动；决策/转向徽章的节点永不坍缩。 | **正文**：凝练结果与原树关系是必要规则；完整说明移到正文；说明与候选共用滚动区，底部提示和生成按钮分行固定，避免长按钮挤压候选列表。 |
| 19 | `CondenseDialog.tsx:111` | `{t('condense.rescanTitle')}`<br>重新检测全图的候选段（本地计算，不调用模型） | **保留**：说明全图重扫和本地计算范围。 |
| 20 | `HighlighterButton.tsx:19` | `{t(active ? 'highlight.penActive' : 'highlight.penHint')}`<br>荧光笔已开启，可连续划选；再次点击或按 Esc 退出 / 开启荧光笔，划选文字即可高亮 | **保留**：荧光笔的持续标注/退出方式不是单次画笔动作。 |
| 21 | `HighlightsOverviewModal.tsx:131` | `{t('hlov.locateTitle')}`<br>在画布上定位这个节点 | **保留**：节点名按钮的定位动作不由名称直观表示。 |
| 22 | `HighlightsOverviewModal.tsx:136` | `{t('hlov.locateTitle')}`<br>在画布上定位这个节点 | **保留**：箭头不能独立表达定位节点。 |
| 23 | `HighlightsOverviewModal.tsx:143` | `{t('common.delete')}`<br>删除 | **删除**：行内垃圾桶表示删除高亮；保留 aria-label。 |
| 24 | `HighlightsOverviewModal.tsx:174` | `{t('hlov.exportTitle')}`<br>把全部高光导出为 Markdown 清单 | **保留**：即使选择部分条目仍导出全部高光，范围信息有价值。 |
| 25 | `JudgeSettings.tsx:65` | `{t('judge.does')}`<br>判断模型带来什么<br>• 回忆更准：按相关度挑过去的对话，宽泛的问题只带档案<br>• 地图徽章更可信：决策、转向、排除、待解由校准过的概率判定<br>• 少打扰：「上游已变」只在改动真影响回答时亮<br>• 记忆更干净：值得记的才写进画像和档案<br>• 搜索更宽容：打错的词纠正到你说过的词<br>每次判断约半秒。关掉后全部退回规则，功能不变。 | **保留**：判断模型的职责不是通用图标语义。 |
| 26 | `LadderJobCard.tsx:27` | `{t('ladder.jobClose')}`<br>关闭 | **删除**：完成任务的 X 明确表示关闭；保留 aria-label。 |
| 27 | `MaterialsOverviewModal.tsx:132` | `{t('hlov.locateTitle')}`<br>在画布上定位这个节点 | **保留**：节点名按钮定位画布的动作需要说明。 |
| 28 | `MaterialsOverviewModal.tsx:137` | `{t('hlov.locateTitle')}`<br>在画布上定位这个节点 | **保留**：箭头需要明确定位语义。 |
| 29 | `MaterialsOverviewModal.tsx:144` | `{t('attach.openReader')}`<br>在阅读器中打开 | **保留**：书本图标表示打开材料阅读器。 |
| 30 | `MemoryPage.tsx:65` | `{t('memory.exportTitle')}`<br>记忆是你的：一个文件，随时带走。 | **删除**：导出文字已明确，营销式补充没有操作信息。 |
| 31 | `MemoryPage.tsx:87` | `{n.was ? fmt(t('mp.lineWas'), { t: n.was }) : undefined}`<br>改写自：{t} | **保留**：追溯行修改前原文，非当前可见内容。 |
| 32 | `MemoryPage.tsx:199` | `{`${src.title} · ${t('mp.sourceOpen')}`}`<br>看这一轮 | **保留**：来源短标签需补完整标题及打开方式。 |
| 33 | `ModelPicker.tsx:148` | `{noModels ? t('apikey.entryTitle') : nodeMode && !value ? t('model.inherit') : `${t('toolbar.model')} · ${label ?? t('model.none')}`}`<br>配置模型 API / 模型：跟随全局 / 模型：对新的生成生效 / 未配置模型 | **按需**：连接入口仅图标态显示；正常模型仅图标态或标签截断时显示，继承模型保留额外语义。 |
| 34 | `ModelPicker.tsx:176` | `{provider === AGENT_PROVIDER ? t('model.agentGroupHint') : undefined}`<br>这一组的模型由各个 Agent 的命令行自己报告。找不到你期待的模型？多半是那个命令行版本旧了，更新它，再点刷新。 | **保留**：运行时模型来源及更新路径是额外解释。 |
| 35 | `ModelPicker.tsx:195` | `{st.error ? `${hint}\n${st.error}` : hint}` | **保留**：未检测到运行时的搜索路径及错误原因。 |
| 36 | `ModelPicker.tsx:218` | `{m.name}` | **删除**：Agent 模型已完整换行显示，所属组已可见。 |
| 37 | `ModelPicker.tsx:235` | `{m.name}` | **按需**：普通模型名仅实际截断时提示。 |
| 38 | `ModelPicker.tsx:272` | `{t('model.refreshList')}`<br>刷新模型列表：重新向已配置的服务商获取 | **保留**：圆形箭头需说明刷新模型列表范围。 |
| 39 | `ModelPicker.tsx:299` | `{t('judge.does')}`<br>判断模型带来什么<br>• 回忆更准：按相关度挑过去的对话，宽泛的问题只带档案<br>• 地图徽章更可信：决策、转向、排除、待解由校准过的概率判定<br>• 少打扰：「上游已变」只在改动真影响回答时亮<br>• 记忆更干净：值得记的才写进画像和档案<br>• 搜索更宽容：打错的词纠正到你说过的词<br>每次判断约半秒。关掉后全部退回规则，功能不变。 | **保留**：判断模型的工作范围需要帮助。 |
| 40 | `ModelPicker.tsx:325` | `{t('model.effortHint')}`<br>下一轮 Agent 思考多深，用的是这家命令行自己的档位。默认沿用它自己的设置。 | **保留**：思考档位按运行时决定，附加语义有价值；提示目标收窄到字段标签。 |
| 41 | `ModelPicker.tsx:423` | `{t('caps.enginePickTitle')}`<br>联网搜索用哪个服务端引擎。何时搜索仍由模型判断，这里决定搜得多好。 | **保留**：服务端引擎与何时发起搜索不同。 |
| 42 | `ModelPicker.tsx:463` | `{t('caps.memoryTitle')}`<br>常驻长期记忆：模型安静地记住关于你的持久事实，并在相关时使用。每次写入都会自我宣告；所有条目在管理器中统一维护。 | **保留**：常驻记忆的使用与写入范围。 |
| 43 | `ModelPicker.tsx:479` | `{t('caps.visionPickTitle')}`<br>由哪个模型识读粘贴的图片、识别扫描页。自动模式优先最强，可能也最贵。 | **保留**：图片与扫描页识读模型，自动选择含成本含义。 |
| 44 | `NodeMention.tsx:81` | `{t('common.delete')}`<br>删除 | **删除**：引用标签内 X 明确表示移除；保留 aria-label。 |
| 45 | `RecallChip.tsx:70` | `{title}` | **保留**：共享选项仅在缺少判断模型时提供禁用原因。 |
| 46 | `RecallChip.tsx:79` | `{on ? t('toolbar.recall') : t('toolbar.recallOff')}`<br>回忆：发送时用问题里的词，去本机的对话与记忆里查原话带进上下文 / 回忆已关。开了以后，发送时会查过去的对话与记忆 | **保留**：回忆会检索本机旧对话并加入上下文，属于功能解释。 |
| 47 | `RecallChip.tsx:98` | `{t('recall.reachHint')}`<br>回忆时给判断模型看多少条候选。轻量：关键词命中里最好的 40 条，逐条读全文再判。深挖：命中里的 2,000 条，先判开头，过关的再读全文，每问约十几秒、几美分。全量：索引里的每一条对话都判，不看关键词，按索引大小计时计价。没有判断模型时只有轻量。 | **保留**：候选范围与成本说明，不是按钮名称复述；保留标签帮助。 |
| 48 | `RecallChip.tsx:104` | `{t('recall.scaleHint')}`<br>带进提问的输入 token 上限。省 4k：一份档案加五到八条对话；标准 12k：两份档案加二十来条；多带 40k：判断模型认为相关的全部带上。窗口小的模型另按窗口的四成封顶。有判断模型按相关度填，没有按排序填。 | **保留**：输入 token 上限及截断策略说明；保留标签帮助。 |
| 49 | `RecallResults.tsx:78` | `{h.kind === 'memory' ? h.file : h.open}` | **保留**：命中内容摘要外的来源路径/原文地址。 |
| 50 | `RecallResults.tsx:92` | `{t('recall.cite')}`<br>引用 | **删除**：引用文字已常显。 |
| 51 | `RoleManagerModal.tsx:52` | `{t('common.delete')}`<br>删除 | **删除**：角色行垃圾桶已明确表示删除；保留 aria-label。 |
| 52 | `RoleTemplateChips.tsx:22` | `{tpl.prompt.slice(0, 140) + '…'}` | **保留**：角色名不能代替实际提示词；预览只在真实截断时追加省略号。 |
| 53 | `RoleTemplateChips.tsx:30` | `{t('roles.manageTitle')}`<br>编辑角色库：新增、修改或删除可选项。已应用到节点上的角色不会改变。 | **删除**：管理入口自明，打开后已有角色库作用范围说明。 |
| 54 | `SearchToggles.tsx:61` | `{noSearchLane ? t('toolbar.searchUnavailableLane') : web ? t('toolbar.webSearch') : t('toolbar.webSearchOff')}`<br>当前模型经浏览器直连（保护它的思考流），此通道不支持搜索工具。OpenRouter 通道的模型或桌面版可用搜索。 / 联网搜索：模型自行判断何时搜索 / 联网搜索已关闭 | **保留**：地球图标的联网搜索状态、模型自主判断和禁用原因。 |
| 55 | `SearchToggles.tsx:73` | `{noSearchLane ? t('toolbar.searchUnavailableLane') : scholar ? t('toolbar.scholarSearch') : t('toolbar.scholarSearchOff')}`<br>当前模型经浏览器直连（保护它的思考流），此通道不支持搜索工具。OpenRouter 通道的模型或桌面版可用搜索。 / 学术检索（arXiv + Semantic Scholar）：模型自行判断何时检索 / 学术检索已关闭 | **保留**：学位帽图标的学术检索状态、数据源和禁用原因。 |
| 56 | `TimelineBar.tsx:103` | `{t('timeline.openOverview')}`<br>打开完整时间线 | **保留**：时间线图标打开完整总览。 |
| 57 | `TimelineOverviewModal.tsx:102` | `{t('tlov.detailTitle')}`<br>每一步显示多少：主题、结论、短述、摘要。文字完整显示，不截断。 | **删除**：详略标签、滑块和当前档位已说明作用。 |
| 58 | `TimelineOverviewModal.tsx:191` | `{t('hlov.locateTitle')}`<br>在画布上定位这个节点 | **删除**：入口已显示“定位”文字，节点行上下文已明确目标；保留可访问名称。 |
| 59 | `TopicsPanel.tsx:121` | `{t('topics.remove')}`<br>删除 | **删除**：主题行垃圾桶表示移除；保留 aria-label。 |
| 60 | `TopicsPanel.tsx:136` | `{x.description}` | **保留**：主题名称外的定义说明。 |
| 61 | `TopicsPanel.tsx:148` | `{p.description}` | **保留**：待添加主题名称外的定义说明。 |
| 62 | `TopicsPanel.tsx:166` | `{canLabel ? undefined : t('topics.needJudge')}`<br>打标要有判断模型（对话模型代答太慢，不支持）。在「配置模型 API」里选一个。 | **删除**：判断模型未配置的原因已在按钮旁直接显示，无需重复悬停。 |
| 63 | `WaitingPill.tsx:20` | `{t('approval.waitingPillTitle')}`<br>有 Agent 在等你回答或批准，点这里去那个节点 | **保留**：等待数量外的定位与授权说明。 |
| 64 | `TimelineBar.tsx:82` | 自定义预览：主题、节点名称、创建/修改时间、`timeline.clickHint` | **保留**：细小刻度无法表达节点身份与时间；补键盘聚焦、提示关联和 Esc 关闭，标题换行完整展示。 |

## 浏览器复核

使用临时浏览器与本地开发服务器验证，全部 API 模拟，外网请求拦截：

- 380px 节点，中文/英文 × 浅色/深色：授权范围、完整长路径、紧凑选项说明直接可见，无横向溢出。
- 凝练窗口，900×720、900×520、1440×900 × 浅色/深色：完整说明可见，候选可滚动至末项，生成操作保留在窗口内。原底栏长按钮曾把说明挤成竖排并令候选区高度归零，已修复为分行底栏和统一正文滚动。
- 时间线：键盘聚焦显示关联预览，Esc 收起，节点、视口与选区不变。
- 测试未产生 API 写入与页面异常；已查看审批、凝练、时间线关键截图。截图与临时脚本位于 `local-tests/tooltip-audit/`。
