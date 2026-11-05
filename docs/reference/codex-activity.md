# Codex activity streaming

Live Codex turns use `codex app-server` JSON-RPC notifications, transported by
the desktop IPC bridge or the local server's SSE feed. The integration targets
the public [App Server protocol](https://learn.chatgpt.com/docs/app-server),
not the desktop application's private frontend code.

## What the node presents

The canvas node, focus panel, and expanded response reader share one ordered
activity timeline. While running, it contains progress commentary, readable
reasoning summaries, commands and their incremental output, tool activity,
file changes, plans, and streamed answer messages. Approvals remain visible
alongside the timeline. The reader can scroll back without being pulled to the
bottom; a follow control returns to the latest activity.

Commentary uses the same Markdown renderer as the answer: emphasis, lists,
code, web links and local file links retain their original structure. File
links resolve against the session working directory and share the file actions
in the card and focus panel. Changed-file rows also expose those file actions;
the disclosure control independently expands the patch. Accepted in-flight
user messages appear as user bubbles in the original activity order.

On completion, the process folds into a disclosure above the answer. Records
remain attached to the answer version through persistence, regeneration,
version navigation, and version deletion. Failed or interrupted work retains
its available output. These records are display data and do not enter the
context compiled for subsequent questions.

## Protocol projection

`runtime/agents/codex.cjs` projects notifications into `activity` snapshots.
`item.id` identifies an activity; later snapshots replace that item in its
original position rather than moving it to the end. `item/completed` is
authoritative, including when its final content differs from the accumulated
deltas.

| Public event or item | Display |
| --- | --- |
| `agentMessage`, `phase: commentary` | Progress text, excluded from the answer |
| `agentMessage`, `partial_answer` / `final_answer` / absent phase | Answer text, ordered with other live activities |
| `reasoning` and `summaryTextDelta` / `summaryPartAdded` | Readable summary, with expandable full text |
| `commandExecution` and `outputDelta` | Command, directory, incremental output, exit code, duration |
| MCP / dynamic / collaboration / search items | Tool lifecycle, parameters, progress, results and details |
| `fileChange`, `turn/diff/updated` | Changed paths and expandable patches |
| `plan`, `turn/plan/updated` | Plan text and structured step statuses |
| Turn / thread status, usage, warnings, retries and review notifications | Status entries and structured details |
| Other scoped notifications and item types | Generic activity with available structured details |

The adapter requests `summary: auto`. A model may still omit a reasoning
summary. Raw or encrypted reasoning is not presented as a readable summary;
the interface never invents text to fill a waiting period.

`AgentActivityEntry` in `src/types.ts` is the shared frontend contract.
`src/lib/agents/agent-runtime.ts` delivers snapshots to the streaming store.
Updates are batched at approximately 100 ms, with a final flush on success,
failure, and interruption. Events arriving before a run's ID response are
buffered by run ID. The HTTP bridge waits for SSE readiness before starting
work. Because the current transport has no replay cursor, a disconnect fails
and interrupts the affected run instead of silently claiming a complete log.

## Limits and compatibility

- Validation used the installed `codex-cli 0.166.0` protocol, deterministic
  event fixtures, and a bounded live command-reading turn.
- Each display text/output/details field is bounded to 100,000 characters.
  Command output retains the latest portion and marks truncation. The native
  session record remains the underlying run record and may have its own
  upstream output limits.
- Generic fallback entries retain unsupported event details; they do not
  promise every desktop-specific widget or interactive tool surface.
- Rollout JSONL and public `thread/read` imports now preserve the activity
  actually recorded by the source. Commentary is separate from final answer
  text. Tool calls stay at their call position when results arrive, and public
  reasoning summaries are retained without encrypted or raw reasoning.
  Import does not fabricate missing deltas, timestamps, or tool results.
- Previously imported Codex nodes gain their source activity on session
  refresh. Pristine source answers receive the corrected phase separation;
  edited prose, unrelated response versions, node metadata and geometry are
  preserved. A source transcript is never attached to a version whose source
  identity cannot be established.
- Tool-context attachments retain their existing short preview limits. The
  activity transcript independently retains up to 100,000 characters per
  text/output/details field and marks truncation, matching the live UI limit.
- An explicit supplementary send calls `turn/steer` with `expectedTurnId`.
  Only an accepted request records the user activity; rejected or completed
  turns surface an error without pretending the message was delivered.

## Historical approval records

Rollout headers, rather than message text, distinguish internal approval
workers from conversations. `thread_source: guardian_review` and
`source.subagent.other: guardian` identify an internal worker; a
`parent_thread_id` alone only establishes lineage. The same rule applies to
atlas discovery, file/stream/branch import, app-server projection and the
local retrieval index. Ordinary delegated work and user messages discussing
approval JSON remain conversations.

Internal prompts, copied history, tool traffic and reasoning are never
projected as questions or branch nodes. Only a structured allow/deny verdict
and its bounded risk, authorization and rationale fields are retained as an
`autoApprovalReview` tool attachment. A recorded parent turn ID is required
to attach it; time proximity is not a substitute. These attachments are
excluded from downstream model context by default.

On refreshing an existing mirror, confirmed internal children from the old
importer are removed if untouched. User-edited material is retained,
archived and disconnected. Stable turn IDs reconcile the import count so a
shorter corrected projection does not skip later questions. Audit summaries
are added to their original turns without replacing user text or attachments.
Active subscriptions are checked once per app launch even when their source
files have not grown. On the web, the mirror waits for the asynchronous local
bridge to become ready instead of giving up at the first mount. Project-store
changes trigger the same check regardless of which view opened the canvas;
surviving node provenance also triggers recovery when the ledger was lost.
Source rollout files are never modified.

Index version 15 rebuilds incompatible manifests and raw text together;
search and word suggestions cannot reuse stale internal-worker text.

## Import verification

```bash
npm run test:codex-import
npm run test:subagents
```

## Live verification

Answered cards and their reading panels contain no follow-up composer or
composer settings. Dragging a connection from a source creates an empty
question node; selection exploration creates an empty branch with the selected
context. Both require an explicit send from the new node. A Codex source's
runtime and working directory carry into the child even when the global picker
selects an API model. The current native session is resumed only when its tail,
directory and context still match. Edited context, selection branches, added
references, and new materials start a separate session with the canvas's
compiled context.

While the canvas owns an active Codex turn, the reading header exposes Stop and
its More menu can open a temporary supplementary-instruction editor. Explicit
text submission goes through `turn/steer`. Only an accepted instruction joins
the canonical question and the ordered user activity. Outside click preserves
the draft; Escape discards it. Failed sends keep the draft; a late reply never
clears newer typing. Stop reaches `turn/interrupt` through the same host bridge.
The temporary editor disappears when execution ends. Working-directory and
permission edits stay in their dedicated configuration entry points.

File links in questions, answers, highlighted text and commentary share local
path resolution (including Windows drive paths, relative working-directory
paths and line references), a keyboard-accessible context menu and a read-only
source preview. Local server, desktop IPC and harness hosts expose the same
file operations. Source and executable files are previewed or revealed, never
executed by a file link. Preview text is UTF-8 and bounded to 1 MB. Native
desktop and harness-specific embedded plugin widgets are not reproduced by
this public-protocol view.

Additional deterministic checks:

```bash
node scripts/test-codex-workflow.mjs
node scripts/test-local-files.mjs
node scripts/test-file-links-ui.mjs
node scripts/test-codex-workbench-ui.mjs
```

```bash
npm run test:codex-stream
npm run test:agent-activity
node scripts/test-codex-activity-import.mjs
npm run build
npm run lint
```

Browser regressions use an isolated browser context against a running Vite
server, without calling an LLM:

```bash
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
npm run test:agent-activity-ui
```

Set `APP_URL` and `CHROME_PATH` if the local server or Chromium executable is
elsewhere. Screenshots and the check report are written under
`local-tests/agent-activity/`.
