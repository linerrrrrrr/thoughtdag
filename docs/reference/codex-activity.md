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
- Historical imports retain their existing import representation. This
  implementation records new live turns; it does not fabricate an event
  timeline for old answers.

## Verification

```bash
npm run test:codex-stream
npm run test:agent-activity
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
