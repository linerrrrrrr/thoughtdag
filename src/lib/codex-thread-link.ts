import type { ThoughtData } from '../types';

export function codexThreadId(value: unknown): string | null {
  return typeof value === 'string' && value.length === 36 && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value) ? value : null;
}

/** Resolve the original thread of this answer. An older canvas may only
 * have the last agent session or its frozen import snapshot. */
export function codexThreadIdForVersion(data: ThoughtData, index = data.responseIndex): string | null {
  if (!Array.isArray(data.responses) || !Number.isInteger(index) || index < 0 || index >= data.responses.length) return null;
  if (Array.isArray(data.codexThreadIds)) return codexThreadId(data.codexThreadIds[index]);
  const history = data.codexHistories?.[index];
  if (history) return codexThreadId(history.threadId);

  const author = data.generatedBy?.[index];
  if (author && (typeof author !== 'string' || !author.startsWith('codex/'))) return null;
  const response = data.responses[index];
  const question = data.questions?.[index] ?? data.question;
  const session = data.agentSession;
  const sessionId = session?.runtime === 'codex' ? codexThreadId(session.sessionId) : null;
  const importedId = data.importSource?.runner === 'codex' ? codexThreadId(data.importSource.sessionId) : null;
  if (sessionId && session?.nativeHistory?.response === response && session.nativeHistory.question === question) return sessionId;
  if (importedId && data.source?.response === response && data.source.question === question) return importedId;
  if (data.responses.length === 1 && (!sessionId || !importedId || sessionId === importedId)) return sessionId ?? importedId;
  return null;
}

export function displayedCodexThreadId(data: ThoughtData): string | null {
  if (data.stepKind && data.stepKind !== 'human' && data.stepKind !== 'prompt') return null;
  return data.isLoading ? codexThreadId(data.liveCodexThreadId) : codexThreadIdForVersion(data);
}

/** Freeze older, node-wide provenance before replacing a session or removing a version. */
export function codexVersionThreadIds(data: ThoughtData): (string | null)[] | undefined {
  if (Array.isArray(data.codexThreadIds)) return data.codexThreadIds;
  if (!data.codexHistories?.some(Boolean) && data.agentSession?.runtime !== 'codex' && data.importSource?.runner !== 'codex') return;
  return data.responses.map((_, i) => codexThreadIdForVersion(data, i));
}
