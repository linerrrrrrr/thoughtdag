---
description: 使用 why / find / recall / status 查询本机索引中的历史
---

查询本机索引中的历史：

**查历史**：参数以 `why`、`find`、`recall`、`status` 开头时，这是一次查询，不打开任何画布。原样交给 ThoughtDAG 命令行，把它的输出**逐字**贴给用户，不要自己去读会话文件、不要总结或改写（输出本身就是为阅读设计的：Δ 是观察到的改动，≈ 是回答里的候选解释，⤴ 是空应答承接的上一个问题，画布链接可打开对应节点，Agent 会话链接会在原运行环境中打开来源会话）。找命令行的顺序：① `command -v thoughtdag` 有则直接用；② 否则 `npx -y thoughtdag`（npm 发布后可用）；③ 开发者在 ThoughtDAG 仓库内时，`node cli/dist/thoughtdag.mjs`（`cli/dist` 不存在就先 `npm run cli:build`）。例：

```bash
thoughtdag why --check src/lib/api.ts  # 一行：这个文件有没有历史（退出码 0 有、1 无），改文件前先问这句
thoughtdag why src/lib/api.ts          # 哪几轮对话动过这个文件、改了什么、当时说了什么
thoughtdag why arxiv:2506.07962        # 论文、网址、画布附件名都是合法的对象
thoughtdag find "surrogate gradient"   # 在哪几轮被问过（Q）或说过（≈），精确匹配
thoughtdag recall <session> <n>        # 把某一轮完整摊开
thoughtdag status                      # 索引里有什么、多少是确定证据
```

参数里的 `@文件` 是 Claude Code 的引用语法，它会先把整个文件读进对话：查询不需要文件正文，剥掉 `@` 把名字交给命令行即可（命令行本身也会剥），**不要**去读或引用被附带进来的正文。提醒用户下次直接写文件名。索引在查询前会自己刷新，通常不必手动 `thoughtdag index`。到此结束。
