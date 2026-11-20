# 设置页间距的规范原文

本目录保存三篇规范的完整 Markdown 或 MDX 源文件、仓库许可证及与纵向间距有关的插图。下载日期为 2026 年 11 月 20 日。设置页实际采用的间距及其用途见[项目注册表](../../src/design-system/settings-spacing.json)。

| 来源编号 | 本地原文与上游公开页面 | 可核对的依据 |
| --- | --- | --- |
| `ant-proximity` | [亲密性](ant-design/docs/spec/proximity.zh-CN.md) · [Ant Design 中文官网](https://ant.design/docs/spec/proximity-cn/) | “纵向间距关系”解释如何用不同的间距表达关联和层级，以及何时辅以分隔线。 |
| `carbon-spacing` | [Spacing](carbon-website/src/pages/elements/spacing/overview.mdx) · [Carbon 官网](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview) | “Spacing scale”列出间距档位，“Stacking”和“Designing with space”说明如何通过间距表现同组关系和层级。原文取自 Carbon 官方网站的归档仓库。 |
| `carbon-forms` | [Forms](carbon-website/src/pages/patterns/forms-pattern/index.mdx) · [Carbon v10 官网](https://v10.carbondesignsystem.com/patterns/forms-pattern/) | “Group and section headings”“Form context”和“Separating inputs, actions and sections”分别讨论标题、弹窗的设置项间距和分区间距。所存原文来自 v10 分支。 |

**离线看图。** Ant Design 的[纵向间距示例](ant-design/figures/vertical.png)和[分隔线示例](ant-design/figures/divider.png)来自原文指定的 CDN 地址。Carbon 归档包括全部 13 个[间距刻度示意](carbon-website/src/pages/elements/spacing/images/)、[间距应用示意](carbon-website/src/pages/elements/spacing/images/spacing-1_revised.png)、[等距排列示意](carbon-website/src/pages/elements/spacing/images/spacing-stack.png)和 [v10 表单间距示意](carbon-website/src/pages/patterns/forms-pattern/images/form_spacing.png)。其他主题的插图可在对应官网查看。原文保留上游链接与组件标记，在本仓库按文本阅读。

**版本和许可。** [来源清单](manifest.json)记录每篇原文的仓库、提交、源文件路径、引用章节及文件校验值。[Ant Design 仓库许可](ant-design/LICENSE)为 MIT，[Carbon 文档仓库许可](carbon-website/LICENSE)为 Apache-2.0。两张通过 CDN 发布的 Ant Design 插图各自登记原始 URL 与 SHA-256。两个 Carbon 版本的仓库许可证内容相同，共用本地副本。

**更新。** 选择上游提交后，替换对应原文与配图并核对仓库的许可证。同步更新清单中的版本、Git blob ID、章节和外部图片摘要，然后在仓库根目录运行 `node scripts/check-spacing-sources.mjs`。检查在本地读取文件。变更项目采用值时，在项目注册表中注明所依据的来源与采用理由。
