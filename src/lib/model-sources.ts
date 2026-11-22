import { AGENT_PROVIDER, agentTarget, runtimeLabelOf } from './agents/agent-runtime';
import type { ModelData, ModelInfo } from './use-models';

export function defaultModelId(data: ModelData | null, selected: string | null) {
  return selected && data?.models.some(model => model.id === selected) ? selected : data?.default ?? null;
}

interface ModelSource {
  key: string;
  label: string;
  agent: boolean;
  models: ModelInfo[];
}

export function groupBySource(models: ModelInfo[]) {
  const groups = new Map<string, ModelSource>();
  for (const model of models) {
    const agent = model.provider === AGENT_PROVIDER;
    const label = agent ? runtimeLabelOf(model.id) : model.provider;
    const key = `${agent ? 'agent' : 'api'}/${label}`;
    const group = groups.get(key);
    if (group) group.models.push(model);
    else groups.set(key, { key, label, agent, models: [model] });
  }
  return Array.from(groups.values());
}

/** Format a UI label while keeping the runtime's routing ID intact. */
export function displayModelName(id: string, name?: string): string {
  const target = agentTarget(id);
  if (target?.runtime !== 'codex') return name ?? id;
  const label = name ?? target.id;
  return label.replace(/^Codex\s*·\s*/i, '').replace(/^codex-(?=.)/i, '') || target.id;
}

export function modelName(model: ModelInfo, source: Pick<ModelSource, 'label' | 'agent'>) {
  const suffix = ` (${model.provider})`;
  const name = model.name.endsWith(suffix) ? model.name.slice(0, -suffix.length) : model.name;
  const prefix = `${source.label} · `;
  const label = source.agent && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return displayModelName(model.id, label);
}
