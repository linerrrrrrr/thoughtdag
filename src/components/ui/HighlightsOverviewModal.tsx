import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useSessionDraft } from '../../lib/use-session-draft';
import { useProjects } from '../../store/projects';
import { useRef, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, Highlighter, Trash2, X } from 'lucide-react';
import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { downloadMarkdown } from '../../lib/export';
import { isImeComposing } from '../../utils';
import { useT, fmt } from '../../i18n';

// Every highlight on the canvas, in one place: the essence the reading
// left behind. Two lenses (by time = the reading journey, by node = the
// structure), each entry pinpoints back to its node (the same provenance
// chip + locate pattern the reader chips and diagnostics use), and a
// checked subset weaves straight into one cited passage — the overview
// picks by CONTENT, the selection toolbar picks by structure.

interface Entry {
  hlId: string;
  text: string;
  at?: string;
  nodeId: string;
  nodeTitle: string;
  showGroup?: boolean;
}

export default function HighlightsOverviewModal({ onLocate }: { onLocate: (nodeId: string) => void }) {
  const open = useUiStore((s) => s.highlightsOverviewOpen);
  const setOpen = useUiStore((s) => s.setHighlightsOverviewOpen);
  const nodes = useStore((s) => s.nodes);
  const removeHighlight = useStore((s) => s.removeHighlight);
  const weaveHighlights = useStore((s) => s.weaveHighlights);
  const t = useT();
  const [sort, setSort] = useState<'time' | 'node'>('time');
  const projectId = useProjects(s => s.activeId) ?? 'default';
  const [pickedText, setPickedText] = useSessionDraft(`highlights-picked:${projectId}`, '[]');
  const picked = useMemo(() => new Set<string>(JSON.parse(pickedText)), [pickedText]);
  const setPicked = (ids: Set<string>) => setPickedText(JSON.stringify([...ids]));
  const [intent, setIntent] = useSessionDraft(`highlights-intent:${projectId}`);

  const entries = useMemo<Entry[]>(() => {
    // closed: skip the walk, which reruns on every nodes change (a session
    // import streams hundreds of them)
    if (!open) return [];
    const out: Entry[] = [];
    for (const n of nodes) {
      const title = n.data.question.slice(0, 200).replace(/\s+/g, ' ').trim().slice(0, 60) || '—';
      for (const h of n.data.highlights || []) {
        out.push({ hlId: h.id, text: h.text, at: h.at, nodeId: n.id, nodeTitle: title });
      }
    }
    const sorted = sort === 'time'
      ? [...out].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      : out; // canvas order = grouped by node already
    return sorted.map((e, i) => ({ ...e, showGroup: sort === 'node' && (i === 0 || sorted[i - 1].nodeTitle !== e.nodeTitle) }));
  }, [open, nodes, sort]);

  const layerRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open, refs: [layerRef], onDismiss: () => setOpen(false), modal: true });

  if (!open) return null;

  const togglePick = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const close = () => setOpen(false);

  const weavePicked = () => {
    const ids = [...picked].filter((id) => entries.some((e) => e.hlId === id));
    if (ids.length === 0) return;
    const nodeIds = [...new Set(entries.filter((e) => ids.includes(e.hlId)).map((e) => e.nodeId))];
    close();
    setPicked(new Set()); setIntent('');
    void weaveHighlights(nodeIds, intent.trim() || undefined, ids);
  };

  const exportMd = () => {
    const lines = entries.map((e) => `- ${e.text}\n  — ${e.nodeTitle}${e.at ? ` · ${e.at.slice(0, 10)}` : ''}`);
    downloadMarkdown(`# ${t('hlov.title')}\n\n${lines.join('\n')}\n`);
  };

  const chip = 'shrink-0 text-control font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded-tag px-1.5 py-0.5 transition-colors';
  const sortBtn = (v: 'time' | 'node', label: string) => (
    <button
      onClick={() => setSort(v)}
      className={`text-control px-2.5 py-1 rounded-tag transition-colors ${sort === v ? 'bg-accent/10 text-accent' : 'text-ink-faint hover:bg-wash'}`}
    >
      {label}
    </button>
  );

  return createPortal((
    <div className="fixed inset-0 z-[60] bg-ink/30 flex items-center justify-center p-6">
      <div ref={layerRef} role="dialog" aria-modal="true" aria-label={t('hlov.title')} tabIndex={-1} className="bg-card rounded-panel shadow-lg border border-line w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line shrink-0">
          <Highlighter size={15} strokeWidth={1.75} className="text-amber-500" />
          <span className="text-section font-semibold text-ink">{t('hlov.title')}</span>
          <span className="text-meta text-ink-faint">{fmt(t('hlov.count'), { n: entries.length })}</span>
          <div className="flex-1" />
          {sortBtn('time', t('hlov.byTime'))}
          {sortBtn('node', t('hlov.byNode'))}
          <button onClick={close} className="text-ink-faint hover:text-ink w-7 h-7 rounded-control hover:bg-wash flex items-center justify-center transition-colors ml-1">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          {entries.length === 0 && <p className="text-control text-ink-faint italic py-2">{t('hlov.empty')}</p>}
          {entries.map((e) => {
            return (
              <div key={e.hlId}>
                {e.showGroup && (
                  <div className="text-control text-ink-faint font-medium mt-3 mb-1 first:mt-0 truncate">{e.nodeTitle}</div>
                )}
                <div className="group flex items-start gap-2.5 py-1.5 border-b border-line/50 last:border-0">
                  <input
                    type="checkbox"
                    checked={picked.has(e.hlId)}
                    onChange={() => togglePick(e.hlId)}
                    className="mt-1 accent-amber-500 shrink-0"
                  />
                  <span className="flex-1 text-body text-ink min-w-0">
                    <mark className="bg-amber-100 text-amber-800 px-0.5 rounded-tag">{e.text}</mark>
                  </span>
                  {sort === 'time' && (
                    <button className={chip} onClick={() => { close(); onLocate(e.nodeId); }} data-tooltip={t('hlov.locateTitle')}>
                      {e.nodeTitle.slice(0, 14)}{e.nodeTitle.length > 14 ? '…' : ''}
                    </button>
                  )}
                  {sort === 'node' && (
                    <button className={chip} onClick={() => { close(); onLocate(e.nodeId); }} data-tooltip={t('hlov.locateTitle')} aria-label={t('hlov.locateTitle')}>
                      ↦
                    </button>
                  )}
                  {e.at && <span className="shrink-0 text-meta text-ink-faint font-mono mt-0.5">{e.at.slice(5, 10)}</span>}
                  <button
                    onClick={() => removeHighlight(e.nodeId, e.hlId)}
                    aria-label={t('actions.deleteHighlight')}
                    className="w-5 h-5 rounded-control flex items-center justify-center transition-colors shrink-0 opacity-0 group-hover:opacity-100 object-action-danger" data-icon-only
                  >
                    <Trash2 size={12} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-line shrink-0 space-y-2">
          {picked.size > 0 && (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) weavePicked(); }}
                placeholder={t('toolbar.intentPlaceholder')}
                className="flex-1 text-control border border-amber-500/30 rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-amber-500/5"
              />
              <button onClick={weavePicked} className="text-control bg-amber-500 hover:bg-amber-400 text-white px-3 py-2 rounded-control transition-colors shrink-0">
                {fmt(t('hlov.weavePicked'), { n: picked.size })}
              </button>
            </div>
          )}
          <div className="flex items-center">
            <span className="text-control text-ink-faint">{picked.size > 0 ? fmt(t('hlov.picked'), { n: picked.size }) : t('hlov.pickHint')}</span>
            <div className="flex-1" />
            {entries.length > 0 && (
              <button onClick={exportMd} className="flex items-center gap-1.5 text-control text-ink-faint hover:text-ink-muted transition-colors" data-tooltip={t('hlov.exportTitle')}>
                <FileDown size={12} strokeWidth={1.75} /> {t('common.export')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
