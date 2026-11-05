import type { ImportableConversation } from '../import-chat';
import { buildGraphFromTurns, type CodexTurn } from './codex-session';
import { isInternalCodexSession } from './codex-session-kind';
import { boundedActivity, publicCodexActivity } from './codex-activity';

// Tier 2 read path: `codex app-server` speaks for the thread store —
// real names, fork lineage, structured turns. This adapter projects a
// thread/read result into the SAME CodexTurn shape the rollout
// collector produces, so everything downstream (canonical routing,
// ledger idempotence, uniqueness) works unchanged. Files stay the
// import truth when both exist: this road is for what files cannot
// tell (a thread's name) or do not hold (a fork with no rollout).

const TOOL_RESULT_LIMIT = 4000;

interface ThreadItem {
  type?: string;
  id?: string;
  text?: string;
  phase?: string | null;
  query?: string;
  content?: Array<{ type?: string; text?: string }>;
  results?: unknown[];
  [k: string]: unknown;
}
interface ThreadTurn { id?: string; items?: ThreadItem[] }
export interface AppServerThread {
  id?: string; sessionId?: string; name?: string | null; preview?: string | null;
  source?: unknown;
  thread_source?: string;
  threadSource?: string;
  turns?: ThreadTurn[];
  cwd?: string | null;
}

const clip = (s: string): string => (s.length > TOOL_RESULT_LIMIT ? `${s.slice(0, TOOL_RESULT_LIMIT)}\n…[truncated, ${s.length} chars total]` : s);

export function threadToTurns(thread: AppServerThread): CodexTurn[] {
  if (isInternalCodexSession(thread)) return [];
  const turns: CodexTurn[] = [];
  let pendingCompaction = false;
  for (const t of thread.turns ?? []) {
    const turn: CodexTurn = { question: '', response: '', itemIds: t.id ? [t.id] : [], tools: [], activity: [] };
    if (pendingCompaction) {
      turn.compactionBefore = '[Compaction] The source runner compacted its history here. Everything above reached later turns only as a summary.';
      pendingCompaction = false;
    }
    for (const it of t.items ?? []) {
      const ty = it.type ?? '';
      if (it.id) turn.itemIds.push(it.id);
      const activity = publicCodexActivity(it, `${t.id ?? turns.length}:item:${turn.activity!.length}`);
      if (activity) turn.activity!.push(activity);
      if (ty === 'userMessage') {
        const text = (it.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
        if (text.trim()) {
          if (turn.question && turn.activity?.length) turn.activity.push(boundedActivity({ id: it.id ?? `${t.id ?? turns.length}:user:${turn.activity.length}`, kind: 'user', sourceType: 'userMessage', status: 'completed', text, startedAt: 0 }));
          turn.question = turn.question ? `${turn.question}\n\n${text}` : text;
        }
      } else if (ty === 'agentMessage') {
        const text = typeof it.text === 'string' ? it.text : '';
        if (text.trim() && it.phase !== 'commentary') turn.response = turn.response ? `${turn.response}\n\n${text}` : text;
      } else if (ty === 'reasoning') {
        // private reasoning never re-enters context; projected out
      } else if (ty === 'contextCompaction') {
        pendingCompaction = true;
      } else if (ty === 'webSearch') {
        turn.tools.push({ name: 'webSearch', call: String(it.query ?? ''), result: clip(JSON.stringify(it.results ?? []).slice(0, TOOL_RESULT_LIMIT)), truncated: true });
      } else if (ty) {
        // unknown tool-ish item: keep it honest and prunable
        const rest = { ...it };
        delete rest.type;
        delete rest.id;
        const body = JSON.stringify(rest);
        if (body.length > 4) turn.tools.push({ name: ty, call: '', result: clip(body), truncated: body.length > TOOL_RESULT_LIMIT });
      }
    }
    if (turn.question || turn.response || turn.tools.length || turn.activity?.length) turns.push(turn);
  }
  return turns;
}

export function appServerThreadConversation(thread: AppServerThread | null): ImportableConversation | null {
  const sid = thread?.sessionId || thread?.id;
  if (!thread || !sid) return null;
  const turns = threadToTurns(thread);
  if (turns.length === 0) return null;
  return {
    title: (thread.name ?? '').trim() || String(thread.preview ?? '').split('\n')[0].slice(0, 60) || `codex ${sid.slice(0, 8)}`,
    messageCount: turns.length,
    source: 'codex',
    sessionId: sid,
    build: () => buildGraphFromTurns(turns, sid, thread.cwd ?? undefined),
  };
}
