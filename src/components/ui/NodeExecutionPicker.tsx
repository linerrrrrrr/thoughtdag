import { useEffect } from 'react';
import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { draftExecutionModels, ensureAgentsFresh, useModels } from '../../lib/use-models';
import { catalogModel } from '../../lib/model-sources';
import { AGENT_RUNTIMES, runtimeOf } from '../../lib/agents/agent-runtime';
import { nodeExecutionKind, resolveNodeModel } from '../../lib/node-execution';
import { useT } from '../../i18n';
import type { ThoughtData } from '../../types';
import { DraftExecutionPicker } from './ModelPicker';

/** Selection is explicit and local; dismissing the model menu never sends the draft. */
export default function NodeExecutionPicker({ nodeId }: { nodeId: string }) {
  const data = useStore(state => state.nodes.find(node => node.id === nodeId)?.data);
  const setModel = useStore(state => state.setNodeModel);
  const setAgentOptions = useStore(state => state.setNodeAgentOptions);
  const globalModel = useUiStore(state => state.selectedModel);
  const models = useModels();
  const editable = !!data && !data.response && !data.responses.length && !data.isLoading && data.stepKind !== 'human';
  const kind = nodeExecutionKind(data);
  useEffect(() => {
    if (editable && kind !== 'api') void ensureAgentsFresh();
  }, [editable, kind]);
  if (!editable) return null;
  const choices = draftExecutionModels(models);
  const inherited = resolveNodeModel(data, globalModel, choices);
  return (
    <div className="flex flex-wrap items-center gap-2 nodrag nopan" data-node-execution-picker={nodeId}
      onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
      <DraftExecutionPicker kind={kind} models={choices} value={catalogModel(choices, data.model)?.id ?? data.model}
        inheritedModel={catalogModel(choices, inherited)?.id ?? inherited} agentOptions={data.agentOptions}
        onPick={model => setModel(nodeId, model)} onAgentOptionsChange={options => setAgentOptions(nodeId, options)} />
    </div>
  );
}

/** Execution identity is separate from the model that wrote an answer. */
export function NodeExecutionBadge({ data }: { data: Partial<ThoughtData> }) {
  const t = useT();
  const kind = nodeExecutionKind(data);
  const runtime = kind === 'legacy-agent' ? runtimeOf(data.model) ?? data.agentSession?.runtime : null;
  return <span className="text-meta text-ink-muted shrink-0" data-node-execution-kind={kind}>
    {runtime ? AGENT_RUNTIMES[runtime].label : t(kind === 'api' ? 'nodeExecution.api' : kind === 'codex' ? 'nodeExecution.codex' : 'nodeExecution.legacy')}
  </span>;
}
