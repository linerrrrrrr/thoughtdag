import type { AgentActivityEntry, ThoughtData } from '../types';

/** Live (including a recovered interrupted run), otherwise the selected version. */
export function activeAgentActivity(data: Pick<ThoughtData, 'agentActivity' | 'agentActivities' | 'responseIndex'>): AgentActivityEntry[] {
  return data.agentActivity ?? data.agentActivities?.[data.responseIndex] ?? [];
}

/** Accepted supplementary input remains in the canonical question for context.
 * Display it at its chronological activity position only when the complete
 * appended suffix matches exactly; edited or ambiguous questions stay intact. */
export function originalQuestionBeforeInstructions(question: string, entries: readonly AgentActivityEntry[]): string {
  const instructions = entries.filter(entry => entry.kind === 'user' && entry.status === 'completed' && !!entry.text)
    .map(entry => entry.text!);
  if (!instructions.length) return question;
  const suffix = `\n\n${instructions.join('\n\n')}`;
  return question.length > suffix.length && question.endsWith(suffix) ? question.slice(0, -suffix.length) : question;
}

/** Snapshots replace the same item without moving it past interleaved tool calls. */
export function upsertAgentActivity(entries: AgentActivityEntry[], item: AgentActivityEntry): AgentActivityEntry[] {
  const index = entries.findIndex((entry) => entry.id === item.id);
  if (index < 0) return [...entries, item];
  const next = entries.slice();
  next[index] = item;
  return next;
}

/** Missing terminal notifications must never leave a permanent running spinner. */
export function settleAgentActivity(entries: AgentActivityEntry[] | undefined | null, status: Exclude<AgentActivityEntry['status'], 'running'>, now = Date.now()): AgentActivityEntry[] | undefined {
  if (!entries?.length) return undefined;
  return entries.map((entry) => entry.status === 'running' ? { ...entry, status, endedAt: now } : entry);
}

/** A storage/export snapshot of an in-flight run is an interrupted version.
 *  The live objects remain untouched, and an unanswered rerun never borrows
 *  its predecessor's response. Applying this again is idempotent. */
export function recoverInterruptedAgentRun(data: ThoughtData, stoppedText: string, now = Date.now()): ThoughtData {
  if (!data.isLoading || !data.agentActivity?.length) return data;
  const count = data.responses.length;
  const append = <T,>(values: (T | undefined | null)[] | undefined, value: T | undefined) =>
    [...Array.from({ length: count }, (_, index) => values?.[index]), value];
  const response = (!data.restreaming && data.response) || stoppedText;
  return {
    ...data,
    response,
    responses: [...data.responses, response],
    responseIndex: count,
    questions: [...Array.from({ length: count }, (_, index) => data.questions?.[index] ?? data.question), data.question],
    agentActivities: append(data.agentActivities, settleAgentActivity(data.agentActivity, 'interrupted', now)),
    agentActivity: undefined,
    reasonings: append(data.reasonings, data.reasoning),
    reasoning: undefined,
    generatedBy: append(data.generatedBy, data.model),
    generatedEfforts: append(data.generatedEfforts, data.agentSession?.effort),
    generatedAts: [...Array.from({ length: count }, (_, index) => data.generatedAts?.[index]), new Date(now).toISOString()],
    isLoading: false,
    restreaming: undefined,
  };
}

export function isAgentActivity(value: unknown): value is AgentActivityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AgentActivityEntry>;
  return typeof entry.id === 'string' && !!entry.id && typeof entry.startedAt === 'number'
    && ['user', 'commentary', 'reasoning', 'message', 'command', 'tool', 'plan', 'file', 'status', 'unknown'].includes(entry.kind ?? '')
    && ['running', 'completed', 'failed', 'interrupted'].includes(entry.status ?? '');
}
