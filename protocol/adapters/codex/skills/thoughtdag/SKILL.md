---
name: thoughtdag
description: Query locally indexed history with why / find / recall / status
---

[[thoughtdag:command]] (this marker lets the canvas importer prune this command turn — keep it as is)

Query locally indexed history. Communicate with the user in THEIR language (the one they have been using); these instructions being English does not make English the reply language.

**Query history**: when the argument starts with `why`, `find`, `recall` or `status`, this is a query — open no canvas. Pass it verbatim to the ThoughtDAG command line and show its output **as is**: do not read session files yourself, do not summarize or reword (the output is written to be read: Δ is an observed change, ≈ a candidate explanation read from an answer, ⤴ the earlier question a bare reply answered; canvas links open the corresponding node; agent-session links open the source session in its runtime). Find the command line in this order: ① `command -v thoughtdag` — use it if present; ② else `npx -y thoughtdag` (once published on npm); ③ a developer inside the ThoughtDAG repository: `node cli/dist/thoughtdag.mjs` (run `npm run cli:build` first if `cli/dist` is missing). Examples:

```bash
thoughtdag why --check src/lib/api.ts  # one line: does this file have history? exit 0 yes / 1 no — ask before editing
thoughtdag why src/lib/api.ts          # which turns touched this file, what changed, what was said
thoughtdag why arxiv:2506.07962        # papers, URLs and canvas attachment names are valid too
thoughtdag find "surrogate gradient"   # where these words were asked (Q) or said (≈), exact match
thoughtdag recall <session> <n>        # one turn in full
thoughtdag status                      # what the index holds, and how much is hard evidence
```

Pass every word after the skill name through as arguments. Codex turns an `@file` in the prompt into an attachment: when the text is just `why` (or `why` plus other flags) and a file arrived attached, that file is the target — use its path (or its name) as the argument; do not read its body, the query needs only the name. Never run the command with no argument. The index refreshes itself before a query; `thoughtdag index` is rarely needed by hand. Stop here.
