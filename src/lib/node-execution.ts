import type { ThoughtData } from '../types';

/** Legacy agent documents keep their original runtime; only API and Codex are new choices. */
export type NodeExecutionKind = 'api' | 'codex' | 'legacy-agent';
type NodeData = Partial<ThoughtData> | undefined;
type ModelChoice = { id: string };

const runtimePrefix = (model?: string | null): string | undefined => {
  if (!model) return undefined;
  return ['codex/', 'pi/', 'claude/', 'harness/', 'dsh/'].find(prefix => model.startsWith(prefix));
};

const sourcePrefix = (data: NodeData): string | undefined => {
  const runtime = data?.agentSession?.runtime ?? data?.importSource?.runner;
  return runtime === 'codex' ? 'codex/' : runtime === 'pi' ? 'pi/'
    : runtime === 'claude-code' ? 'claude/' : runtime === 'dsh' ? 'dsh/' : undefined;
};

export function modelExecutionKind(model?: string | null): NodeExecutionKind {
  const prefix = runtimePrefix(model);
  return prefix === 'codex/' ? 'codex' : prefix ? 'legacy-agent' : 'api';
}

/** Explicit node intent outranks its last run's provenance and the global picker. */
export function nodeExecutionKind(data: NodeData): NodeExecutionKind {
  if (data?.executionKind === 'api' || data?.executionKind === 'codex') return data.executionKind;
  if (data?.model) return modelExecutionKind(data.model);
  const prefix = sourcePrefix(data);
  if (prefix) return prefix === 'codex/' ? 'codex' : 'legacy-agent';
  return modelExecutionKind(data?.generatedBy?.[data.responseIndex ?? 0]);
}

export function modelMatchesExecution(model: string | null | undefined, kind: NodeExecutionKind): boolean {
  return !!model && modelExecutionKind(model) === kind;
}

/** Resolve only within the chosen execution lane. An API node never inherits an agent model. */
export function resolveNodeModel(data: NodeData, globalModel?: string | null, models: readonly ModelChoice[] = []): string | undefined {
  const kind = nodeExecutionKind(data);
  if (modelMatchesExecution(data?.model, kind)) return data!.model;
  if (kind === 'legacy-agent') {
    const prefix = sourcePrefix(data) ?? runtimePrefix(data?.generatedBy?.[data.responseIndex ?? 0]);
    const previous = data?.generatedBy?.[data.responseIndex ?? 0];
    if (previous && (!prefix || previous.startsWith(prefix))) return previous;
    if (globalModel && runtimePrefix(globalModel) && (!prefix || globalModel.startsWith(prefix))) return globalModel;
    return prefix ? `${prefix}${prefix === 'claude/' ? 'claude-code/' : prefix}default` : undefined;
  }
  if (modelMatchesExecution(globalModel, kind)) return globalModel ?? undefined;
  return models.find(model => modelMatchesExecution(model.id, kind))?.id
    ?? (kind === 'codex' ? 'codex/codex/default' : undefined);
}

/** New roots snapshot the global execution type; children preserve their parent's type. */
export function inheritedNodeExecution(data: NodeData, globalModel?: string | null): Pick<ThoughtData, 'executionKind' | 'model'> {
  const kind = data ? nodeExecutionKind(data) : modelExecutionKind(globalModel);
  const executionKind = kind === 'legacy-agent' ? undefined : kind;
  const source = data ?? { model: globalModel ?? undefined, executionKind };
  return { executionKind, model: resolveNodeModel(source, globalModel) };
}
