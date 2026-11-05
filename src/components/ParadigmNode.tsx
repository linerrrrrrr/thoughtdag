import { type NodeProps } from '@xyflow/react';
import { useRef, useState } from 'react';
import { Globe, GraduationCap, MessageCircleQuestion, SquareTerminal, Trash2 } from 'lucide-react';
import type { ThoughtNode as ThoughtNodeType, ThoughtData } from '../types';
import { useStore } from '../store';
import { effectiveRoles } from '../lib/role-templates';
import { useUiStore } from '../lib/ui-store';
import { useI18n, useT } from '../i18n';
import NodeConnectionHandles from './NodeConnectionHandles';
import NodeOverview from './NodeOverview';
import { useNodeDetail } from '../lib/node-detail';
import { getNodeDisplayName } from '../lib/node-display-name';

// Orchestration-view card. A paradigm has exactly two node kinds:
//   human  — a dialogue turn: the human asks here. The card holds optional
//            guidance for the operator; it instantiates as an EMPTY question
//            node awaiting the human.
//   prompt — a machine processing step: a fixed prompt (plus optional role)
//            applied to whatever flows in from upstream nodes.
// Flow patterns (fan-out, review, synthesis) are drawn as graph shape, not
// node kinds. No LLM ever runs in this view. Legacy v1 kinds render as
// 'prompt' but keep their stored data for instantiation.

const KINDS: { kind: 'human' | 'prompt'; icon: typeof SquareTerminal; labelKey: string }[] = [
  { kind: 'human', icon: MessageCircleQuestion, labelKey: 'paradigm.kind.human' },
  { kind: 'prompt', icon: SquareTerminal, labelKey: 'paradigm.kind.prompt' },
];

const KIND_STYLES: Record<'human' | 'prompt', string> = {
  human: 'border-warm/70',
  prompt: 'border-accent/50',
};

export default function ParadigmNode({ id, data }: NodeProps<ThoughtNodeType>) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const { tier, fixed } = useNodeDetail(data.detailLevel);
  const overview = tier !== 'work' && !editing;
  const lang = useI18n((s) => s.lang);
  const deleteNode = useStore((s) => s.deleteNode);
  const customWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.width);
  const customHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.height);
  const patch = (p: Partial<ThoughtData>) => {
    useStore.setState((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)),
    }));
  };
  const kind: 'human' | 'prompt' = data.stepKind === 'human' ? 'human' : 'prompt';

  return (
    <div ref={root} className={`bg-card border border-dashed rounded-node flex flex-col ${KIND_STYLES[kind]}`} style={{ width: customWidth ?? 440, height: customHeight }}
      data-node-detail-level={overview ? (tier === 'glyph' ? 'compact' : 'summary') : 'full'} data-node-detail-locked={data.detailLevel || undefined}
      onFocusCapture={() => setEditing(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false); }}>
      <NodeConnectionHandles id={id} muted large={overview} />
      {overview ? <div className="drag-handle cursor-grab active:cursor-grabbing" onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
        requestAnimationFrame(() => root.current?.querySelector('input')?.focus());
      }}>
        <NodeOverview name={getNodeDisplayName(data, t('paradigm.titlePlaceholder'))} preview={data.instruction}
          compact={tier === 'glyph'} previewAlways={!!fixed} typeLabel={t(`paradigm.kind.${kind}`)} />
      </div> : <>

      {/* header: drag handle + kind switcher + delete */}
      <div className="flex shrink-0 items-center justify-between px-5 py-2 border-b border-line/60 cursor-grab active:cursor-grabbing drag-handle">
        <div className="flex gap-1">
          {KINDS.map(({ kind: k, icon: Icon, labelKey }) => (
            <button
              key={k}
              onClick={(e) => { e.stopPropagation(); patch({ stepKind: k }); }}
              title={t(labelKey as Parameters<typeof t>[0])}
              className={`w-7 h-7 rounded-control flex items-center justify-center transition-colors ${
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
          className="text-ink-faint hover:text-red-500 rounded-control w-6 h-6 flex items-center justify-center transition-colors"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>

      <div className={`px-5 py-3 space-y-2.5 nodrag ${customHeight != null ? 'min-h-0 flex-1 overflow-y-auto nowheel' : ''}`}>
        {/* step title */}
        <input
          type="text"
          value={data.question}
          onChange={(e) => patch({ question: e.target.value })}
          placeholder={t('paradigm.titlePlaceholder')}
          className="w-full text-title font-semibold text-ink bg-transparent focus:outline-none placeholder-ink-faint"
        />

        {/* body: THE prompt (machine) or operator guidance (human) — one
            field; a persona is just the opening lines of the prompt */}
        <textarea
          value={data.instruction ?? ''}
          onChange={(e) => patch({ instruction: e.target.value })}
          placeholder={t(kind === 'human' ? 'paradigm.humanHintPlaceholder' : 'paradigm.promptPlaceholder')}
          rows={kind === 'human' ? 3 : 4}
          className={`w-full text-body text-ink bg-surface border border-line rounded-control px-2.5 py-2 focus:outline-none focus:ring-1 resize-y nowheel ${
            kind === 'human' ? 'focus:ring-warm/40' : 'focus:ring-accent/40'
          }`}
        />

        {/* persona chips: prepend a template persona into the prompt */}
        {kind === 'prompt' && (
          <div className="flex flex-wrap gap-1" title={t('paradigm.insertPersona')}>
            {effectiveRoles(lang, useUiStore.getState().roleLib).map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => patch({ instruction: `${tpl.prompt}\n${data.instruction ?? ''}` })}
                className="text-control bg-wash hover:bg-accent/10 hover:text-accent text-ink-muted px-1.5 py-0.5 rounded-tag transition-colors"
              >
                + {tpl.name}
              </button>
            ))}
          </div>
        )}

        {/* per-step search permissions — carried into the instantiated run */}
        {kind === 'prompt' && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => patch({ webSearch: !data.webSearch })}
              title={data.webSearch ? t('toolbar.webSearch') : t('toolbar.webSearchOff')}
              className={`text-control px-2 py-1 rounded-control transition-colors flex items-center gap-1 ${
                data.webSearch ? 'bg-accent/10 text-accent' : 'bg-wash text-ink-faint hover:bg-line'
              }`}
            >
              <Globe size={12} strokeWidth={1.75} /> {t('paradigm.webSearch')}
            </button>
            <button
              onClick={() => patch({ scholarSearch: !data.scholarSearch })}
              title={data.scholarSearch ? t('toolbar.scholarSearch') : t('toolbar.scholarSearchOff')}
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
