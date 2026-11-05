import { ChevronRight, GitBranch, Scissors, Star, Tag, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import { useUiStore } from '../../lib/ui-store';
import { createQuestionDraft } from '../../lib/question-draft';
import type { Highlight } from '../../types';

// Highlights: the list, how they pass downstream (tag / filter-only — no
// highlights at all IS the "pass everything" state), and one way to act on
// them: ask a question about them (an explore branch).

export default function HighlightsSection({
  nodeId,
  highlights,
  highlightMode,
}: {
  nodeId: string;
  highlights: Highlight[];
  highlightMode: 'off' | 'tag' | 'filter';
}) {
  const removeHighlight = useStore((s) => s.removeHighlight);
  const setHighlightMode = useStore((s) => s.setHighlightMode);
  const t = useT();

  const exploreHighlights = () => {
    if (isViewerMode || !highlights.length) return;
    const childId = createQuestionDraft({ parentId: nodeId, branchContext: highlights.map(h => h.text).join('\n\n'), editor: 'panel' });
    if (childId) useUiStore.getState().setPanelOpen(true, childId);
  };

  return (
    <div className="panel-card px-4 py-3">
      <details className="group">
        <summary className="text-control font-semibold text-amber-600 cursor-pointer hover:text-amber-500 transition-colors flex items-center gap-1.5 select-none">
          <ChevronRight size={12} strokeWidth={1.75} className="transition-transform group-open:rotate-90" />
          {t('highlight.title')}
          {highlights.length > 0 && (
            <span className="text-ink-faint font-normal">({highlights.length})</span>
          )}
        </summary>
        <div className="mt-2">
          {highlights.length === 0 ? (
            <p className="text-control text-ink-faint italic">{t('highlight.empty')}</p>
          ) : (
            <>
              <div className="space-y-1.5 mb-3">
                {highlights.map((h) => (
                  <div key={h.id} className="flex items-start gap-2 bg-amber-50 rounded-content px-3 py-2 group/hl">
                    <span className="text-body text-amber-700 flex-1">
                      <Star size={14} strokeWidth={1.75} className="inline" /> {h.text.slice(0, 80)}{h.text.length > 80 ? '…' : ''}
                    </span>
                    {!isViewerMode && <button
                      onClick={() => removeHighlight(nodeId, h.id)}
                      className="object-action-danger rounded-control transition-colors shrink-0 opacity-0 group-hover/hl:opacity-100 group-focus-within/hl:opacity-100 focus:opacity-100"
                      data-icon-only aria-label={t('actions.deleteHighlight')}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {/* Downstream mode: tag or filter-only */}
                <div className="flex items-center gap-1.5">
                  {([
                    { mode: 'tag' as const, icon: <Tag size={14} strokeWidth={1.75} />, label: t('highlight.modeTag') },
                    { mode: 'filter' as const, icon: <Scissors size={14} strokeWidth={1.75} />, label: t('highlight.modeFilter') },
                  ]).map(({ mode, icon, label }) => (
                    <button
                      key={mode}
                      onClick={() => setHighlightMode(nodeId, mode)}
                      title={mode === 'tag' ? t('highlight.hintTag') : t('highlight.hintFilter')}
                      className={`text-control px-2.5 py-1.5 rounded-control transition-colors flex items-center gap-1 ${
                        highlightMode === mode
                          ? 'bg-action text-white'
                          : 'bg-wash text-ink-muted hover:bg-line'
                      }`}
                    >
                      <span>{icon}</span> {label}
                    </button>
                  ))}
                </div>
                {!isViewerMode && <button
                  onClick={exploreHighlights} data-highlight-explore
                  className="text-control bg-accent/10 hover:bg-accent/20 text-accent px-2.5 py-1.5 rounded-control transition-colors flex items-center gap-1"
                  title={t('highlight.exploreTitle')}
                >
                  <GitBranch size={14} strokeWidth={1.75} />
                  {t('common.explore')}
                </button>}
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  );
}
