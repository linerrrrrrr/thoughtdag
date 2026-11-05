import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Check, Copy, Loader2, Minimize2, X } from 'lucide-react';
import { useUiStore, toast } from '../../lib/ui-store';
import { useStore } from '../../store';
import { useModels } from '../../lib/use-models';
import { backgroundModels, isApiModel } from '../../lib/background-model';
import { findCandidateSegments, startCondenseRun, cancelCondenseRun, type CondenseSegment } from '../../lib/condense';
import { useI18n, useT, fmt } from '../../i18n';

// Condense v4b: a FLOATING window on the canvas's left side (the focus
// panel owns the right — the two never fight), and the build itself is a
// BACKGROUND run living in the store: closing this window hides the view,
// never cancels the work. The toolbar icon carries the progress while the
// window is away; the store guards hold edits still until the copy lands.

export default function CondenseDialog({ onFocusSegment }: { onFocusSegment?: (nodeIds: string[]) => void }) {
  const open = useUiStore((s) => s.condenseDialogOpen);
  const run = useUiStore((s) => s.condenseRun);
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const [refreshTick, setRefreshTick] = useState(0);
  // refreshTick is the deliberate re-read trigger, not a value the memo reads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const segments = useMemo(() => (open && run.status === 'idle' ? findCandidateSegments(nodes, edges) : []), [open, run.status, nodes, edges, refreshTick]);
  const globalModel = useUiStore((s) => s.selectedModel);
  // distilling is an API model's job, never an agent's (startCondenseRun)
  const models = (useModels()?.models ?? []).filter((m) => isApiModel(m.id));
  const [model, setModel] = useState('');
  // the model "automatic" stands for: the picked one when it is an API model, else the background order's first
  const [autoModel, setAutoModel] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void backgroundModels().then(([m]) => { if (live) setAutoModel(m ?? null); });
    return () => { live = false; };
  }, [open, globalModel]);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  // draggable: grab the title row, put the window anywhere
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const startDrag = (e: React.MouseEvent) => {
    const r = winRef.current?.getBoundingClientRect();
    if (!r) return;
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const onMove = (ev: MouseEvent) => setPos({
      x: Math.min(window.innerWidth - 120, Math.max(0, ev.clientX - dx)),
      y: Math.min(window.innerHeight - 80, Math.max(0, ev.clientY - dy)),
    });
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const key = (s: CondenseSegment) => s.nodeIds.join(',');
  const picked = segments.filter((s) => !unchecked.has(key(s)));
  const pickedSaving = picked.reduce((sum, s) => sum + s.saving, 0);

  // closing HIDES the window; the background run keeps going
  const close = () => {
    useUiStore.getState().setCondenseDialogOpen(false);
    useUiStore.getState().setCondenseHighlightIds([]);
  };
  // Esc closes the top layer, here too — a floating window that ignores
  // Esc reads as stuck
  useDismissableLayer({ open, refs: [winRef], onDismiss: close, dismissOnOutside: false });
  if (!open) return null;

  const build = () => {
    if (picked.length === 0) return;
    void startCondenseRun(picked, lang, model || undefined);
  };

  const archiveOriginal = () => {
    useStore.getState().setArchived(run.originalIds, true);
    toast('success', t('condense.originalArchived'));
    useUiStore.getState().setCondenseRun({ status: 'idle', current: 0, total: 0, streaming: '', originalIds: [], distillIds: [] });
    close();
  };

  const focusCopy = () => {
    const st = useStore.getState();
    const copyNodes = st.nodes.filter((n) => run.distillIds.includes(n.id));
    if (copyNodes.length) onFocusSegment?.(copyNodes.map((n) => n.id));
  };

  return createPortal((
    <div
      ref={winRef}
      className="fixed z-[70] bg-surface border border-line rounded-panel shadow-lg w-[400px] max-h-[72vh] flex flex-col p-4 animate-fade-in"
      style={pos ? { left: pos.x, top: pos.y } : { left: 80, bottom: 16 }}
      data-condense-dialog
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-1 cursor-grab active:cursor-grabbing select-none" onMouseDown={startDrag}>
        <div className="text-title font-semibold text-ink flex items-center gap-2">
          <Minimize2 size={15} strokeWidth={1.75} className="text-accent" /> {t('condense.title')}
        </div>
        <button onClick={close} title={run.status === 'building' ? t('condense.runningBg') : undefined}
          className="text-ink-faint hover:text-ink rounded-control w-7 h-7 flex items-center justify-center hover:bg-wash transition-colors"><X size={15} /></button>
      </div>

      {run.status === 'idle' && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-control text-ink-faint leading-snug" title={t('condense.copyIntroFull')}>{t('condense.copyIntroShort')}</p>
            <button
              onClick={() => setRefreshTick((v) => v + 1)}
              title={t('condense.rescanTitle')}
              data-condense-rescan
              className="text-control text-ink-muted hover:text-accent px-2 py-1 rounded-tag hover:bg-wash transition-colors shrink-0"
            >
              ⟳ {t('condense.rescan')}
            </button>
          </div>
          <p className="text-control text-ink-faint mb-2" data-condense-scanline>
            {fmt(t('condense.scanLine'), { turns: String(nodes.filter((n) => n.data.response && !n.data.stepKind).length), n: String(segments.length) })}
          </p>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-control text-ink-muted shrink-0">{t('condense.modelLabel')}</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} data-condense-model
              className="text-control bg-wash text-ink rounded-control px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/40 max-w-[220px] truncate">
              <option value="">{fmt(t('condense.modelAuto'), { model: autoModel ?? '—' })}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </div>
          {segments.length === 0 ? (
            <p className="text-control text-ink-muted py-4">{t('condense.segNothing')}</p>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {segments.map((seg) => {
                const k = key(seg);
                const on = !unchecked.has(k);
                return (
                  <div
                    key={k}
                    data-condense-item
                    className={`border rounded-content p-3 transition-colors cursor-pointer ${on ? 'border-accent/60 bg-accent/5' : 'border-line opacity-60'}`}
                    onClick={() => {
                      useUiStore.getState().setCondenseHighlightIds(seg.nodeIds);
                      onFocusSegment?.(seg.nodeIds);
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="checkbox"
                        checked={on}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => setUnchecked((prev) => { const nx = new Set(prev); if (nx.has(k)) nx.delete(k); else nx.add(k); return nx; })}
                        className="accent-[var(--color-accent)]"
                        data-condense-check
                      />
                      <span className="text-meta text-ink-faint font-mono">{fmt(t('condense.segMeta'), { n: String(seg.nodeIds.length), tok: String(seg.saving) })}</span>
                    </div>
                    <p className="text-control text-ink mt-1 leading-snug line-clamp-2">{seg.headQuestion}</p>
                  </div>
                );
              })}
            </div>
          )}
          {segments.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-3 mt-2 border-t border-line">
              <span className="text-control text-ink-faint">{t('condense.copyFootnote')}</span>
              <button
                onClick={build}
                disabled={picked.length === 0}
                data-condense-build
                className="text-control bg-action text-white px-3.5 py-2 rounded-control disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Copy size={13} strokeWidth={1.75} />
                {fmt(t('condense.buildCopy'), { n: String(picked.length), tok: String(pickedSaving) })}
              </button>
            </div>
          )}
        </>
      )}

      {run.status === 'building' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 text-control text-ink-muted mb-1.5">
            <Loader2 size={15} className="animate-spin text-accent" />
            {fmt(t('condense.buildingRun'), { i: String(run.current), n: String(run.total) })}
          </div>
          <p className="text-control text-ink-faint mb-2">{t('condense.runningBg')}</p>
          {run.streaming && (
            <div className="flex-1 min-h-0 overflow-y-auto text-body text-ink-muted bg-wash rounded-content p-2.5 whitespace-pre-wrap" data-condense-streaming>
              {run.streaming}
            </div>
          )}
          <button onClick={() => cancelCondenseRun()} data-condense-cancel
            className="self-start mt-3 text-control text-ink-muted hover:text-red-600 px-3 py-1.5 rounded-control hover:bg-wash transition-colors">
            {t('common.cancel')}
          </button>
        </div>
      )}

      {run.status === 'error' && (
        <div className="flex flex-col gap-2 py-3">
          <p className="text-control text-red-600">{run.error}</p>
          <button onClick={() => useUiStore.getState().setCondenseRun({ status: 'idle', error: undefined })}
            className="self-start text-control text-ink-muted hover:text-ink px-3 py-1.5 rounded-control hover:bg-wash transition-colors">
            {t('common.cancel')}
          </button>
        </div>
      )}

      {run.status === 'done' && (
        <div className="flex flex-col gap-3 py-3">
          <div className="flex items-center gap-2 text-control text-green-700">
            <Check size={16} /> {t('condense.copyReady')}
          </div>
          <p className="text-control text-ink-faint">{t('condense.copyCompareHint')}</p>
          <div className="flex items-center gap-2">
            <button onClick={focusCopy} className="text-control bg-accent/10 text-accent hover:bg-accent/20 px-3 py-2 rounded-control transition-colors">
              {t('condense.viewCopy')}
            </button>
            <button onClick={archiveOriginal} data-condense-archive-original
              className="text-control border border-line text-ink-muted hover:text-ink hover:bg-wash px-3 py-2 rounded-control transition-colors flex items-center gap-1.5">
              <Archive size={13} strokeWidth={1.75} /> {t('condense.archiveOriginal')}
            </button>
          </div>
          <button onClick={() => { useUiStore.getState().setCondenseRun({ status: 'idle' }); close(); }}
            className="self-start text-control text-ink-faint hover:text-ink transition-colors">{t('common.close')}</button>
        </div>
      )}
    </div>
  ), document.body);
}
