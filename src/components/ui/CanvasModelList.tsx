import { useId, useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { AgentSourceIcon, ApiSourceIcon, ImageInputIcon } from '../../lib/ui-icons';
import { useT } from '../../i18n';
import { groupBySource, modelName } from '../../lib/model-sources';
import type { ModelInfo } from '../../lib/use-models';

interface CanvasModelListProps {
  models: ModelInfo[];
  activeId?: string | null;
  pending?: boolean;
  onPick: (id: string) => void;
}

function VisionIcon({ kind, label }: { kind: 'source' | 'model'; label: string }) {
  return <span data-model-vision={kind} data-tooltip={label} className="shrink-0 text-ink-faint">
    <ImageInputIcon size={13} strokeWidth={1.75} aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>;
}

const rowClass = 'w-full flex items-center gap-2 min-h-8 py-1.5 rounded-control text-left text-control transition-colors focus-visible:outline-2 focus-visible:outline-accent';

export default function CanvasModelList({ models, activeId, pending, onPick }: CanvasModelListProps) {
  const t = useT();
  const panelId = useId();
  const [chosenSource, setChosenSource] = useState<string | null>();
  const sources = groupBySource(models);
  const currentSource = sources.find(source => source.models.some(model => model.id === activeId));
  const expandedKey = chosenSource === null || sources.some(source => source.key === chosenSource)
    ? chosenSource : (currentSource ?? sources[0])?.key;

  return <div data-model-catalog className="px-2 py-1">
    {sources.map((source, index) => {
      const expanded = expandedKey === source.key;
      const allVision = source.models.every(model => model.vision);
      const Icon = source.agent ? AgentSourceIcon : ApiSourceIcon;
      const groupId = `${panelId}-${index}`;
      return <div key={source.key} className="py-1">
        <button type="button" data-model-source={source.label} aria-expanded={expanded}
          aria-controls={expanded ? groupId : undefined} onClick={() => setChosenSource(expanded ? null : source.key)}
          className={`${rowClass} px-2 font-medium text-ink-muted hover:bg-wash`}>
          <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="sr-only">{source.agent ? 'Agent' : 'API'}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{[source.label, source.detail].filter(Boolean).join(' · ')}</span>
          <span className="mr-auto text-meta font-normal tabular-nums text-ink-faint">{source.models.length}</span>
          {allVision && <VisionIcon kind="source" label={t('model.catalogSourceVision')} />}
          <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true"
            className={`shrink-0 text-ink-faint transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </button>
        {expanded && <div id={groupId}>
          {source.models.map(model => {
            const selected = model.id === activeId;
            return <button key={model.id} type="button" aria-pressed={selected} data-model-option={model.id}
              onClick={() => onPick(model.id)}
              className={`${rowClass} pl-8 pr-2 ${selected ? 'bg-accent/10 text-accent font-medium' : 'text-ink hover:bg-wash'}`}>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{modelName(model, source)}</span>
              {!allVision && model.vision && <VisionIcon kind="model" label={t('model.catalogVision')} />}
              {selected && <Check size={14} strokeWidth={2} className="shrink-0" aria-hidden="true" />}
            </button>;
          })}
        </div>}
      </div>;
    })}
    {pending && <p role="status" className="flex items-center gap-2 px-2 py-2 text-control text-ink-muted">
      <Loader2 size={14} strokeWidth={1.75} className="shrink-0 animate-spin" aria-hidden="true" />
      {t('model.catalogChecking')}
    </p>}
    {!pending && !sources.length && <p data-model-catalog-empty className="px-2 py-4 text-control text-ink-muted">
      {t('model.catalogEmpty')}
    </p>}
  </div>;
}
