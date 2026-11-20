import { useEffect } from 'react';
import { Bot, MessageSquare } from 'lucide-react';
import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { availableExecutionModels, ensureAgentsFresh, useModels } from '../../lib/use-models';
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
  const editable = !!data && !data.response && !data.responses.length && !data.isLoading && data.stepKind !== 'human';
  const kind = nodeExecutionKind(data);
  useEffect(() => {
    if (editable && kind === 'codex') void ensureAgentsFresh();
  }, [editable, kind]);
  if (!editable) return null;
  const choices = availableExecutionModels(models, kind);
  const inherited = resolveNodeModel({ ...data, model: undefined }, globalModel, choices);
  return (
    <div className="flex flex-wrap items-center gap-2 nodrag nopan" data-node-execution-picker={nodeId}
      onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-center gap-1" role="group" aria-label={t('nodeExecution.type')}>
        {(['api', 'codex'] as const).map(option => (
          <button key={option} type="button" aria-pressed={kind === option}
            aria-label={t(option === 'api' ? 'nodeExecution.api' : 'settings.agents')}
            data-tooltip={t(option === 'api' ? 'nodeExecution.api' : 'settings.agents')} data-tooltip-icon-only
            data-node-execution-option={option} onClick={() => setKind(nodeId, option)}
            className={`h-8 px-2.5 rounded-control text-control transition-colors ${kind === option ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-line/50'}`}>
            {option === 'api' ? <MessageSquare className="hidden" size={15} aria-hidden /> : <Bot className="hidden" size={15} aria-hidden />}
            <span>{t(option === 'api' ? 'nodeExecution.api' : 'settings.agents')}</span>
          </button>
        ))}
      </div>
      {kind === 'legacy-agent' && <NodeExecutionBadge data={data} />}
      {kind === 'api' || choices.length > 0
        ? <ModelPicker key={kind} compact value={data.model} execution={{ kind, models: choices, inheritedModel: inherited }}
            onChange={model => setModel(nodeId, model)} />
        : kind === 'codex' && !models?.agentsPending
          ? <button type="button" className="h-8 px-2.5 rounded-control text-control text-accent hover:bg-line/50"
              onClick={() => useUiStore.getState().setApiKeyModalOpen(true, 'agents')}>
              {t('connection.agent')}
            </button>
          : <span className="text-control text-ink-muted" role="status">{t(models?.agentsPending ? 'connection.checking' : 'connection.disconnected')}</span>}
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
