// Internal approval workers also carry parent_thread_id. Parenthood is
// lineage, not proof of a delegated conversation. Keep this decision shared
// by discovery, import and indexing, and never infer it from message text.
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

export function isInternalCodexSession(value: unknown): boolean {
  const meta = record(value);
  if (!meta) return false;
  if (meta.thread_source === 'guardian_review' || meta.threadSource === 'guardian_review') return true;
  const source = record(meta.source);
  const subagent = record(source?.subagent) ?? record(source?.subAgent);
  return subagent?.other === 'guardian';
}
