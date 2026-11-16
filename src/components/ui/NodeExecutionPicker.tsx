import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { useModels } from '../../lib/use-models';
import { nodeExecutionKind, resolveNodeModel } from '../../lib/node-execution';
import { useT } from '../../i18n';
import type { ThoughtData } from '../../types';
import ModelPicker from './ModelPicker';

/** Selection is explicit and local; dismissing the model menu never sends the draft. */
export default function NodeExecutionPicker({ nodeId }: { nodeId: string }) {
  const t = useT();
  const data = useStore(state => state.nodes.find(node => node.id === nodeId)?.data);
  const setKind = useStore(state => state.setNodeExecutionKind);
  const setModel = useStore(state => state.setNodeModel);
  const globalModel = useUiStore(state => state.selectedModel);
  const models = useModels();
  if (!data || data.response || data.responses.length > 0 || data.isLoading || data.stepKind === 'human') return null;
  const kind = nodeExecutionKind(data);
  const inherited = resolveNodeModel({ ...data, model: undefined }, globalModel, models?.models);
  return (
    <div className="flex flex-wrap items-center gap-2 nodrag nopan" data-node-execution-picker={nodeId}
      onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-center gap-1" role="group" aria-label={t('nodeExecution.type')}>
        {(['api', 'codex'] as const).map(option => (
          <button key={option} type="button" aria-pressed={kind === option}
            data-node-execution-option={option} onClick={() => setKind(nodeId, option)}
            className={`h-8 px-2.5 rounded-control text-control transition-colors ${kind === option ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-line/50'}`}>
            {t(option === 'api' ? 'nodeExecution.api' : 'nodeExecution.codex')}
          </button>
        ))}
      </div>
      {kind === 'legacy-agent' && <NodeExecutionBadge data={data} />}
      <ModelPicker compact value={data.model} executionKind={kind} inheritedModel={inherited}
        onChange={model => setModel(nodeId, model)} />
    </div>
  );
}

/** Execution identity is separate from the model that wrote an answer. */
export function NodeExecutionBadge({ data }: { data: Partial<ThoughtData> }) {
  const t = useT();
  const kind = nodeExecutionKind(data);
  return <span className="text-meta text-ink-muted shrink-0" data-node-execution-kind={kind}>
    {t(kind === 'api' ? 'nodeExecution.api' : kind === 'codex' ? 'nodeExecution.codex' : 'nodeExecution.legacy')}
  </span>;
}
