// The subagents a session spawned, when their transcripts live in files of
// their own: Claude Code keeps a sidechain file per agent under
// <session>/subagents/, Codex a child rollout whose header names
// parent_thread_id. Pi's subagent tool needs nothing here — the child keeps
// no session, its run rides the parent's tool result. The parent conversation
// adopts what is found before it builds, and each run becomes a branch off
// the turn that launched it (see adapters/shared.ts).
import type { ImportableConversation } from '../import-chat';
import { internalCodexChildren, internalCodexSessions, scanSessions, type SessionCard } from './discover';
import type { SubagentSession } from '../adapters/shared';

interface LineCollector { feedLine(raw: string): void }

async function feed(c: LineCollector, next: () => Promise<string | null>): Promise<void> {
  let carry = '';
  for (;;) {
    const chunk = await next();
    if (chunk === null) break;
    const lines = (carry + chunk).split('\n');
    carry = lines.pop() ?? '';
    for (const ln of lines) c.feedLine(ln);
  }
  if (carry) c.feedLine(carry);
}

async function collect(c: LineCollector & { toSubagentSession(): SubagentSession | null }, next: () => Promise<string | null>): Promise<SubagentSession | null> {
  await feed(c, next);
  return c.toSubagentSession();
}

/** Give `conv` the transcripts of the subagents it spawned. `cards` (the atlas's scan) is how
 *  Codex children are found; Claude Code children are found by path alone, so a live refresh
 *  without cards still adopts them. A child that cannot be read leaves the parent as it is. */
export async function withSubagents(
  conv: ImportableConversation | null,
  rootKey: string,
  rel: string,
  cards?: SessionCard[] | null,
): Promise<ImportableConversation | null> {
  if (!conv?.adopt || !conv.sessionId || !window.desktopSessions) return conv;
  const subs: SubagentSession[] = [];
  try {
    const { shellSessionReader } = await import('./canonical');
    if (conv.source === 'claude-code') {
      // <project>/<sessionId>.jsonl → <project>/<sessionId>/subagents/agent-*.jsonl
      const prefix = `${rel.replace(/\.jsonl$/, '')}/subagents/`;
      const rels = (await window.desktopSessions.list(rootKey)).map((f) => f.rel).filter((r) => r.startsWith(prefix) && r.endsWith('.jsonl'));
      if (rels.length) {
        const { ClaudeSessionCollector } = await import('../adapters/claude-code-session');
        for (const r of rels) {
          const sub = await collect(new ClaudeSessionCollector(), shellSessionReader(rootKey, r)).catch(() => null);
          if (sub) subs.push(sub);
        }
      }
    } else if (conv.source === 'codex') {
      // Live refresh and deep links do not supply cards. Use the same cached
      // header scan as the atlas so adoption and repair have identical input.
      const currentCards = cards ?? await scanSessions();
      conv.excludedSessionIds = internalCodexChildren(conv.sessionId);
      if (conv.adoptApprovals) {
        const { CodexApprovalCollector } = await import('../adapters/codex-approval');
        for (const c of internalCodexSessions(conv.sessionId)) {
          const collector = new CodexApprovalCollector();
          try {
            await feed(collector, shellSessionReader(c.rootKey, c.rel));
            const review = collector.finish();
            if (review) conv.adoptApprovals([review]);
          } catch { /* an unreadable audit never prevents importing the conversation */ }
        }
      }
      const kids = currentCards.filter((c) => c.runner === 'codex' && c.subagent && c.parentSessionId === conv.sessionId);
      if (kids.length) {
        const { CodexSessionCollector } = await import('../adapters/codex-session');
        for (const k of kids) {
          const sub = await collect(new CodexSessionCollector(), shellSessionReader(k.rootKey, k.rel)).catch(() => null);
          if (sub) subs.push(sub);
        }
      }
    }
  } catch { /* the parent stands on its own */ }
  if (subs.length) conv.adopt(subs);
  return conv;
}
