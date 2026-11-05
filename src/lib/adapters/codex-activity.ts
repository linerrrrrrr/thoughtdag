import type { AgentActivityEntry } from '../../types';

// Import and live activity share the same display contract. Keep the public
// record's text, not the short tool-attachment preview used by graph context.
const LIMIT = 100_000;
type Item = Record<string, unknown>;
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const obj = (value: unknown): Item => value && typeof value === 'object' && !Array.isArray(value) ? value as Item : {};
const time = (value: unknown): number | undefined => typeof value === 'number' ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
const statusOf = (item: Item): AgentActivityEntry['status'] =>
  ['failed', 'declined', 'rejected', 'error'].includes(String(item.status)) || item.error || item.success === false || (typeof item.exitCode === 'number' && item.exitCode !== 0) ? 'failed'
    : ['interrupted', 'cancelled', 'canceled', 'incomplete'].includes(String(item.status)) ? 'interrupted'
      : ['inProgress', 'in_progress', 'running'].includes(String(item.status)) ? 'running' : 'completed';

export function boundedActivity(entry: AgentActivityEntry): AgentActivityEntry {
  const next = { ...entry };
  for (const key of ['text', 'command', 'output'] as const) {
    const value = next[key];
    if (value && value.length > LIMIT) { next[key] = key === 'output' ? value.slice(-LIMIT) : value.slice(0, LIMIT); next.truncated = true; }
  }
  if (next.details !== undefined) {
    // Reasoning ciphertext is never a user-facing item or a useful raw detail.
    const raw = JSON.stringify(next.details, (key, value) => /^(encrypted_content|encryptedContent)$/.test(key) ? undefined : value);
    if (raw && raw.length > LIMIT) { next.details = raw.slice(0, LIMIT); next.truncated = true; }
    else if (raw) next.details = JSON.parse(raw);
  }
  return next;
}

/** Project a public thread/read item, without inventing missing timing data. */
export function publicCodexActivity(item: Item, fallbackId: string, fallbackTime = 0): AgentActivityEntry | null {
  const type = String(item.type ?? '');
  if (!type || type === 'userMessage') return null;
  const common: AgentActivityEntry = {
    id: typeof item.id === 'string' ? item.id : fallbackId, kind: 'unknown', sourceType: type,
    status: statusOf(item), startedAt: time(item.startedAtMs ?? item.startedAt) ?? fallbackTime,
    ...(time(item.completedAtMs ?? item.completedAt) !== undefined ? { endedAt: time(item.completedAtMs ?? item.completedAt) } : {}),
  };
  let patch: Partial<AgentActivityEntry>;
  if (type === 'agentMessage') patch = { kind: item.phase === 'commentary' ? 'commentary' : 'message', text: text(item.text), ...(typeof item.phase === 'string' ? { phase: item.phase } : {}) };
  else if (type === 'reasoning') {
    const summary = Array.isArray(item.summary) ? item.summary.map((part) => typeof part === 'string' ? part : text(obj(part).text)).filter(Boolean).join('\n\n') : '';
    if (!summary) return null;
    patch = { kind: 'reasoning', text: summary };
  } else if (type === 'commandExecution') patch = { kind: 'command', command: text(item.command), cwd: typeof item.cwd === 'string' ? item.cwd : undefined, output: text(item.aggregatedOutput), exitCode: typeof item.exitCode === 'number' ? item.exitCode : null, durationMs: typeof item.durationMs === 'number' ? item.durationMs : null, details: { commandActions: item.commandActions, processId: item.processId } };
  else if (type === 'fileChange') patch = { kind: 'file', details: { changes: item.changes }, ...(item.output != null ? { output: text(item.output) } : {}) };
  else if (type === 'plan') patch = { kind: 'plan', text: text(item.text), ...(Array.isArray(item.plan) ? { details: { plan: item.plan } } : {}) };
  else if (type === 'mcpToolCall' || type === 'dynamicToolCall') patch = { kind: 'tool', title: item.server ? `${item.server}/${item.tool}` : text(item.tool), output: text(item.result ?? item.error ?? item.contentItems), details: { arguments: item.arguments, error: item.error }, durationMs: typeof item.durationMs === 'number' ? item.durationMs : null };
  else if (['webSearch', 'imageView', 'imageGeneration', 'collabAgentToolCall', 'collabToolCall', 'subAgentActivity', 'sleep'].includes(type)) patch = { kind: 'tool', title: text(item.tool ?? item.name ?? type), text: text(item.query ?? item.path ?? item.prompt ?? item.agentPath ?? item.savedPath), ...(item.output != null ? { output: text(item.output) } : {}), details: item };
  else if (['contextCompaction', 'enteredReviewMode', 'exitedReviewMode'].includes(type)) patch = { kind: 'status', text: text(item.review), details: item };
  else patch = { title: type, details: item };
  return boundedActivity({ ...common, ...patch });
}

export function rolloutToolActivity(id: string, name: string, raw: string, startedAt: number, cwd: string): AgentActivityEntry {
  let args: Item = {};
  try { if (raw.length <= LIMIT) args = obj(JSON.parse(raw)); } catch { /* custom tools take plain text */ }
  const leaf = name.split(/[./]/).at(-1) ?? name;
  const entry: AgentActivityEntry = { id, kind: 'tool', sourceType: name, title: name, status: 'running', startedAt, details: { arguments: Object.keys(args).length ? args : raw } };
  if (['exec_command', 'local_shell', 'shell', 'Shell', 'Bash'].includes(leaf)) {
    entry.kind = 'command';
    entry.command = text(args.cmd ?? args.command ?? raw);
    entry.cwd = text(args.workdir ?? args.cwd ?? cwd);
  } else if (leaf === 'update_plan') {
    entry.kind = 'plan';
    entry.text = text(args.explanation);
    entry.details = { plan: args.plan, arguments: args };
  } else if (leaf === 'apply_patch') {
    entry.kind = 'file';
    const patch = typeof args.patch === 'string' ? args.patch : raw;
    const changes = [...patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)\r?\n([\s\S]*?)(?=^\*\*\* (?:Add|Update|Delete) File:|^\*\*\* End Patch|$(?![\s\S]))/gm)]
      .map((match) => ({ path: match[2].trim(), kind: { type: match[1].toLowerCase() }, diff: match[3] }));
    entry.details = changes.length ? { changes } : { arguments: raw };
  }
  return boundedActivity(entry);
}

export function completeRolloutActivity(entry: AgentActivityEntry, output: string, endedAt: number): AgentActivityEntry {
  const exit = output.match(/(?:Process exited with code|Exit code:)\s*(-?\d+)/i);
  const failed = exit ? Number(exit[1]) !== 0 : /^Error(?:\b|:)/i.test(output.trim());
  return boundedActivity({ ...entry, output, endedAt, status: failed ? 'failed' : 'completed', ...(exit ? { exitCode: Number(exit[1]) } : {}) });
}
