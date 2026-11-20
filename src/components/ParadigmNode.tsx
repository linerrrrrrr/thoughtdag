import { type NodeProps } from '@xyflow/react';
import { useRef, useState } from 'react';
import { Globe, GraduationCap, MessageCircleQuestion, SquareTerminal, Trash2 } from 'lucide-react';
import type { ThoughtNode as ThoughtNodeType, ThoughtData } from '../types';
import { useStore } from '../store';
import { useT } from '../i18n';
import NodeConnectionHandles from './NodeConnectionHandles';
import NodeOverview from './NodeOverview';
import { useNodeDetail } from '../lib/node-detail';
import { getNodeDisplayName } from '../lib/node-display-name';
import { pixelDimension } from '../lib/node-content-height';

// Orchestration-view card. A paradigm has exactly two node kinds:
//   human  — a dialogue turn: the human asks here. The card holds optional
//            guidance for the operator; it instantiates as an EMPTY question
//            node awaiting the human.
//   prompt — a machine processing step: a fixed prompt
//            applied to whatever flows in from upstream nodes.
// Connections define the flow between these steps. No model runs in this view.

const KINDS: { kind: 'human' | 'prompt'; icon: typeof SquareTerminal; labelKey: string }[] = [
  { kind: 'human', icon: MessageCircleQuestion, labelKey: 'paradigm.kind.human' },
  { kind: 'prompt', icon: SquareTerminal, labelKey: 'paradigm.kind.prompt' },
];

const KIND_STYLES: Record<'human' | 'prompt', string> = {
  human: 'border-warm/70',
  prompt: 'border-accent/50',
};

export default function ParadigmNode({ id, data, selected }: NodeProps<ThoughtNodeType>) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const { tier, fixed } = useNodeDetail(data.detailLevel);
  const overview = tier !== 'work' && !editing;
  const deleteNode = useStore((s) => s.deleteNode);
  const customWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.width);
  const customHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.height);
  const customStyleWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.style?.width);
  const customStyleHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.style?.height);
  const configuredWidth = customWidth ?? pixelDimension(customStyleWidth);
  const configuredHeight = customHeight ?? pixelDimension(customStyleHeight);
  const patch = (p: Partial<ThoughtData>) => {
    useStore.setState((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)),
    }));
  };
  const kind: 'human' | 'prompt' = data.stepKind === 'human' ? 'human' : 'prompt';

  return (
    <div ref={root} className={`bg-card border border-dashed rounded-node flex flex-col ${KIND_STYLES[kind]} ${overview && selected ? 'node-selected' : ''}`} style={{ width: configuredWidth ?? 440, height: overview ? undefined : configuredHeight }}
      data-type-surface="canvas-geometry" data-node-detail-level={overview ? (tier === 'glyph' ? 'compact' : 'summary') : 'full'} data-node-detail-locked={data.detailLevel || undefined}
      data-node-overview-surface={overview ? (tier === 'glyph' ? 'compact' : 'summary') : undefined}
      data-node-overview-kind={overview ? (kind === 'human' ? 'human' : 'start') : undefined} data-node-paradigm
      onFocusCapture={() => setEditing(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false); }}>
      <NodeConnectionHandles id={id} muted large={overview} />
      {overview ? <div data-cursor="inherit" className="drag-handle" onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
        requestAnimationFrame(() => root.current?.querySelector('input')?.focus());
      }}>
        <NodeOverview name={getNodeDisplayName(data, t('paradigm.titlePlaceholder'))} preview={data.instruction}
          compact={tier === 'glyph'} previewAlways={!!fixed} typeLabel={t(`paradigm.kind.${kind}`)} />
      </div> : <>

      {/* header: drag handle + kind switcher + delete */}
      <div className="paradigm-header flex shrink-0 items-center justify-between px-5 py-2 border-b border-line/60 drag-handle" data-type-surface="canvas-object">
        <div className="flex gap-1">
          {KINDS.map(({ kind: k, icon: Icon, labelKey }) => (
            <button
              key={k}
              onClick={(e) => { e.stopPropagation(); patch({ stepKind: k }); }}
              data-tooltip={t(labelKey as Parameters<typeof t>[0])} aria-label={t(labelKey as Parameters<typeof t>[0])}
              className={`nodrag nopan w-7 h-7 rounded-control flex items-center justify-center transition-colors ${
                kind === k ? (k === 'human' ? 'bg-warm/15 text-warm' : 'bg-accent/10 text-accent') : 'text-ink-faint hover:bg-wash'
              }`}
            >
              <Icon size={14} strokeWidth={1.75} />
            </button>
          ))}
          <span className={`text-control self-center ml-1 uppercase tracking-wider font-medium ${kind === 'human' ? 'text-warm' : 'text-accent/80'}`}>
            {t(`paradigm.kind.${kind}` as Parameters<typeof t>[0])}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
          aria-label={t('actions.deleteNode')}
          className="nodrag nopan rounded-control w-6 h-6 flex items-center justify-center transition-colors object-action-danger" data-icon-only
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>

      <div className="paradigm-content px-5 py-3 gap-2.5 nodrag flex flex-col min-h-0 flex-auto" data-type-surface="canvas-object">
        {/* step title */}
        <input
          type="text"
          value={data.question}
          onChange={(e) => patch({ question: e.target.value })}
          placeholder={t('paradigm.titlePlaceholder')}
          className="w-full shrink-0 text-title font-semibold text-ink bg-transparent focus:outline-none placeholder-ink-faint"
        />

        {/* body: the prompt (machine) or operator guidance (human) */}
        <textarea
          value={data.instruction ?? ''}
          onChange={(e) => patch({ instruction: e.target.value })}
          placeholder={t(kind === 'human' ? 'paradigm.humanHintPlaceholder' : 'paradigm.promptPlaceholder')}
          rows={kind === 'human' ? 3 : 4}
          className={`w-full min-h-0 text-body text-ink bg-surface border border-line rounded-control px-2.5 py-2 focus:outline-none focus:ring-1 nowheel nopan overscroll-contain ${configuredHeight != null ? 'flex-auto resize-none' : 'resize-y'} ${
            kind === 'human' ? 'focus:ring-warm/40' : 'focus:ring-accent/40'
          }`}
        />

        {/* per-step search permissions — carried into the instantiated run */}
        {kind === 'prompt' && (
          <div data-export-omit="run" className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => patch({ webSearch: !data.webSearch })}
              aria-pressed={!!data.webSearch}
              className={`text-control px-2 py-1 rounded-control transition-colors flex items-center gap-1 ${
                data.webSearch ? 'bg-accent/10 text-accent' : 'bg-wash text-ink-faint hover:bg-line'
              }`}
            >
              <Globe size={12} strokeWidth={1.75} /> {t('paradigm.webSearch')}
            </button>
            <button
              onClick={() => patch({ scholarSearch: !data.scholarSearch })}
              aria-pressed={!!data.scholarSearch}
              className={`text-control px-2 py-1 rounded-control transition-colors flex items-center gap-1 ${
                data.scholarSearch ? 'bg-accent/10 text-accent' : 'bg-wash text-ink-faint hover:bg-line'
              }`}
            >
              <GraduationCap size={12} strokeWidth={1.75} /> {t('paradigm.scholarSearch')}
            </button>
          </div>
        )}
      </div>

      </>}
    </div>
  );
}
