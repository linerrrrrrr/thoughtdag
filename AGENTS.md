# AGENTS.md

ThoughtDAG：把 LLM 对话变成无限画布上可编辑的思维 DAG（节点=一轮问答，边=上下文流）。React 19 + Vite + TypeScript 前端，Express 代理后端。状态：活跃开发中的开放原型（github.com/chenxiachan/thoughtdag）。

## 常用命令

```bash
npm run dev      # Vite 前端 (默认 5173)
npm run server   # LLM 代理 server.mjs (端口 3001，前端默认指向它)
npm run build    # tsc -b && vite build
npm run smoke    # scripts/smoke.mjs 冒烟测试
npm run lint
```

需要 `.env`（见 `.env.example`）：至少一把 LLM key（`ZHIPU_API_KEY` 免费档 glm-4.5-flash，或 `DASHSCOPE_API_KEY` 付费）。

## 架构

- `server.mjs` — 唯一后端文件：Express 代理，用 Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible` + `zhipu-ai-provider`）调 LLM；含 agentic 网页搜索 + 行内引用（搜索后保证有综合回答）。
- `src/store/` — zustand 全局状态；持久化用 idb-keyval（IndexedDB）。
- `src/components/` — 画布基于 `@xyflow/react`（React Flow）：`ThoughtNode`、`ThoughtEdgeView`、`SelectionToolbar`（框选可切换节点/线条；多选节点可整组改尺寸，位置不变；对齐直接执行并可撤销）、`focus-panel/`。
- `src/lib/api.ts` — 前端到 server.mjs 的调用层。
- `src/i18n/` — 中英双语。
- Markdown 渲染：react-markdown + KaTeX + highlight.js；PDF 附件用 pdfjs-dist。

## 约定

- 自动排版必须遵守箭头（上下文流）顺序。纵向排版时同一对话链同列、从上到下；横向排版时同链同行、从左到右。手动对齐与分布按实际选区执行，允许同链错开、位置逆序及节点重叠，不因这些情况拦截。端口按节点几何自动选择朝向，不能由接入口位置推断连接用途。
- 与用户交流用中文；代码标识符和注释保持英文。
- UI 文案（i18n、tooltip、toast、placeholder）不出现第三方品牌名。功能性标识除外：环境变量名、导入格式的身份（如 ChatGPT 导出文件）、实际数据源（arXiv、Semantic Scholar）。举例、推荐、宣传式的品牌提及一律用通称（"外部 OCR 工具""其他助手"）或扩展名（.docx）替代。

## 设计语言

- 新增、调整或审查应用 UI 时，使用项目技能 [thoughtdag-design-system](.agents/skills/thoughtdag-design-system/SKILL.md)，按工具、阅读、画布场景选择规则。
- [DESIGN.md](DESIGN.md) 说明视觉角色和组件组合；运行数值来自共享 CSS token。避免把当前局部差异直接升级为全局标准。
- 工具栏与卡片的显隐按 [入口状态规则](DESIGN.md#toolbar-and-card-visibility) 分类：区分打开态、持续设置、选区操作与直接动作；卡片切换保持工具栏结构稳定，覆盖即关闭旧卡片且不自动恢复。「节点／连线／分区」属于框选后出现的选区操作；分区不计入节点，单选和多选共用「选区属性」。
- 开发服务器的 `/design-system.html` 提供规范样张；按 [设计验收](docs/reference/design-acceptance.md) 检查实际功能。`npm run design:check` 检查基础 token 快照；确认变量变更后用 `npm run design:sync` 同步受管字段。

## 编辑与退出（必遵守）

**短名称及节点/分区几何外点保存；连线属性修改即生效；长内容外点收起并保留会话草稿；Esc 只退出最上层，绝不提交待保存内容。发送、生成、授权、删除及其他配置提交必须明确触发。**

- 新增或修改输入、菜单、弹窗、侧栏前，按 [交互标准](docs/reference/interaction-contract.md) 分类并验收。
- 复用 `useDismissableLayer` / `useInlineEditDismiss`；编辑边界包含输入及动作按钮，不能给每个字段各写 blur 保存或另建全局 Escape 监听。
- 中文组合输入期间 Enter/Esc 无效；多行正文 Enter 换行；危险确认只由有焦点的按钮响应 Enter，默认焦点在取消。
- 草稿要能跨关闭/重开恢复（包括空草稿）；外点不能执行 API 副作用。画布与常驻工作面板可持续协同，不套用临时弹层规则。
