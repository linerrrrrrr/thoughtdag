import type { RunnerTurn } from './shared';
import { isInternalCodexSession } from './codex-session-kind';

export interface CodexApprovalSession {
  sessionId: string;
  parentSessionId: string;
  reviews: Array<{ id: string; parentTurnId: string; result: string }>;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const nonempty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** Approval workers copy a full conversation into their prompts. Read only
 *  structured verdicts, keeping neither the prompt nor the worker's tools.
 *  Turn attribution is exact: absent lineage never falls back to time. */
export class CodexApprovalCollector {
  private headerSeen = false;
  private session: Pick<CodexApprovalSession, 'sessionId' | 'parentSessionId'> | null = null;
  private current: { id: string; parentTurnId?: string } | null = null;
  private reviews = new Map<string, CodexApprovalSession['reviews'][number]>();

  feedLine(raw: string): void {
    let line: Record<string, unknown> | undefined;
    try { line = record(JSON.parse(raw)); } catch { return; }
    if (!line) return;
    const p = record(line.payload);
    if (!p) return;
    if (line.type === 'session_meta' && !this.headerSeen) {
      this.headerSeen = true;
      const sessionId = nonempty(p.id);
      const parentSessionId = nonempty(p.parent_thread_id);
      if (isInternalCodexSession(p) && sessionId && parentSessionId) this.session = { sessionId, parentSessionId };
      return;
    }
    if (!this.session) return;
    if (line.type === 'turn_context' || (line.type === 'event_msg' && p.type === 'task_started')) {
      const id = nonempty(p.turn_id);
      if (!id) { this.current = null; return; }
      const parent = nonempty(record(p.turn_attribution)?.parent_turn_id);
      // A subsequent turn_context usually only knows the root turn. Keep
      // the more precise initiating turn recorded by task_started.
      const previous = this.current?.id === id ? this.current.parentTurnId : undefined;
      const parentTurnId = parent ?? previous ?? nonempty(p.root_turn_id);
      this.current = { id, parentTurnId };
      return;
    }
    if (line.type !== 'response_item' || p.type !== 'message' || p.role !== 'assistant'
      || !this.current?.parentTurnId || !Array.isArray(p.content)) return;
    const text = p.content.flatMap((part) => {
      const c = record(part);
      return c && (c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string' ? [c.text] : [];
    }).join('\n');
    // Even an unexpected assistant payload cannot become a copied history.
    if (text.length > 65536) return;
    let verdict: Record<string, unknown> | undefined;
    try { verdict = record(JSON.parse(text)); } catch { return; }
    if (!verdict || (verdict.outcome !== 'allow' && verdict.outcome !== 'deny')) return;
    const result: Record<string, string> = { outcome: verdict.outcome };
    if (typeof verdict.risk_level === 'string' && ['low', 'medium', 'high', 'critical'].includes(verdict.risk_level)) {
      result.risk_level = verdict.risk_level;
    }
    if (typeof verdict.user_authorization === 'string' && ['unknown', 'low', 'medium', 'high'].includes(verdict.user_authorization)) {
      result.user_authorization = verdict.user_authorization;
    }
    if (typeof verdict.rationale === 'string') {
      result.rationale = verdict.rationale.length > 2000 ? `${verdict.rationale.slice(0, 2000)}…` : verdict.rationale;
    }
    this.reviews.set(this.current.id, { id: this.current.id, parentTurnId: this.current.parentTurnId, result: JSON.stringify(result) });
  }

  finish(): CodexApprovalSession | null {
    return this.session ? { ...this.session, reviews: [...this.reviews.values()] } : null;
  }
}

/** A review remains an excluded tool attachment on the originating turn.
 *  It is never a question, answer, delegated branch or approximate match. */
export function adoptCodexApprovals(turns: RunnerTurn[], sessions: CodexApprovalSession[], parentSessionId: string): void {
  for (const session of sessions) {
    if (session.parentSessionId !== parentSessionId) continue;
    for (const review of session.reviews) {
      const turn = turns.find((t) => t.itemIds.includes(review.parentTurnId));
      if (!turn) continue;
      const nativeCallId = `approval:${session.sessionId}:${review.id}`;
      if (turn.tools.some((tool) => tool.nativeCallId === nativeCallId)) continue;
      turn.tools.push({
        name: 'autoApprovalReview',
        call: JSON.stringify({ reviewSessionId: session.sessionId, reviewId: review.id, parentTurnId: review.parentTurnId }),
        result: review.result,
        truncated: false,
        nativeCallId,
      });
    }
  }
}
