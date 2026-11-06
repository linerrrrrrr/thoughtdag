import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, Scissors, Tag, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import type { useTextHighlighter } from '../lib/use-text-highlighter';
import type { Highlight } from '../types';
import HighlighterButton from './ui/HighlighterButton';

export default function NodeHighlightsSection({ nodeId, highlights, highlightMode, highlighter, canHighlight }: {
  nodeId: string;
  highlights: Highlight[];
  highlightMode: 'off' | 'tag' | 'filter';
  highlighter: ReturnType<typeof useTextHighlighter>;
  canHighlight: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const removeHighlight = useStore(s => s.removeHighlight);
  const setHighlightMode = useStore(s => s.setHighlightMode);
  const t = useT();

  return <section className="node-highlights nodrag nopan" aria-label={t('highlight.title')} data-node-highlights>
    <div className="node-highlights-header">
      <button type="button" className="node-metadata-toggle" onClick={() => setOpen(!open)}
        aria-expanded={open} aria-controls={contentId} data-highlight-disclosure>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('highlight.title')}</span>
        {highlights.length > 0 && <span className="tabular-nums">({highlights.length})</span>}
      </button>
      {!isViewerMode && <HighlighterButton active={highlighter.active} onClick={highlighter.toggle}
        buttonRef={highlighter.buttonRef} disabled={!canHighlight} className="w-8 h-8 shrink-0" />}
    </div>
    <div id={contentId} className="node-highlights-content nowheel" hidden={!open} data-highlight-list>
      {highlights.length === 0 ? <p className="text-control text-ink-faint">{t('highlight.empty')}</p> : <>
        <ul className="node-highlight-list">
          {highlights.map(highlight => <li key={highlight.id} className="node-highlight-item">
            <span className="node-highlight-text">{highlight.text}</span>
            {!isViewerMode && <button type="button" onClick={() => removeHighlight(nodeId, highlight.id)}
              className="object-action-danger rounded-control w-7 h-7 shrink-0 flex items-center justify-center"
              aria-label={t('actions.deleteHighlight')} data-tooltip={t('actions.deleteHighlight')}>
              <Trash2 size={14} strokeWidth={1.75} />
            </button>}
          </li>)}
        </ul>
        <div className="node-highlight-modes">
          {([
            { mode: 'tag', Icon: Tag, label: t('highlight.modeTag') },
            { mode: 'filter', Icon: Scissors, label: t('highlight.modeFilter') },
          ] as const).map(({ mode, Icon, label }) => <button key={mode} type="button"
            onClick={() => setHighlightMode(nodeId, mode)} disabled={isViewerMode}
            aria-pressed={highlightMode === mode}
            className="node-metadata-action disabled:opacity-50">
            <Icon size={14} strokeWidth={1.75} />{label}
          </button>)}
        </div>
      </>}
    </div>
  </section>;
}
