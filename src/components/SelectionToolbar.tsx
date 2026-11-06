import { useState, useRef, useEffect, useMemo } from 'react';
import { Archive, ClipboardList, Files, FileDown, Highlighter, Layers, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import type { ThoughtNode } from '../types';
import { confirmDialog, useUiStore } from '../lib/ui-store';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { effectiveNodeGeometry, nodeGeometryMinimum, nodeGeometryMaximum } from '../lib/node-geometry';
import { updateSummaries } from '../lib/ladder-reselect';
import { selectionMarkdown, downloadMarkdown } from '../lib/export';
import { isImeComposing } from '../utils';
import { useT, t as ti, fmt } from '../i18n';
import SelectionArrangeMenu, { type ViewportRectGetter } from './SelectionArrangeMenu';
import FrameSettings, { FrameObjectActions } from './FrameSettings';
import { getNodeDisplayName } from '../lib/node-display-name';
import { useSessionDraft } from '../lib/use-session-draft';
import { useSelectionDraftBoundary } from '../lib/selection-panel-context';

type PendingAction = 'merge' | 'mergeDelete' | 'weave' | null;
type GeometryField = 'width' | 'height' | 'x' | 'y';
type GeometryDraft = Partial<Record<GeometryField, string>>;
const fieldLabels = { width: 'format.width', height: 'format.height', x: 'format.x', y: 'format.y' } as const;
const numericText = (value: number) => String(Math.round(value * 100) / 100);
const buttonClass = 'min-h-8 px-2.5 rounded-control text-control text-ink-muted hover:bg-wash transition-colors flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';

/** One reversible edit boundary: Tab moves between fields without committing. */
function GeometryEditor({ selectedNodes, allowPosition }: { selectedNodes: ThoughtNode[]; allowPosition: boolean }) {
  const t = useT();
  const project = useProjects(state => state.activeId);
  const editor = useRef<HTMLDivElement>(null);
  const lock = useRef<HTMLInputElement>(null);
  const kind = selectedNodes[0]?.data.stepKind === 'frame' ? 'frames' : 'nodes';
  const draftKey = `selection-geometry:${project}:${kind}:${JSON.stringify(selectedNodes.map(node => node.id).sort())}`;
  const [draftText, setDraftText] = useSessionDraft(draftKey, '{}');
  const draft = useMemo<GeometryDraft>(() => {
    try {
      const value = JSON.parse(draftText);
      if (!value || typeof value !== 'object') return {};
      return Object.fromEntries(Object.entries(value).filter(([key, text]) => key in fieldLabels && typeof text === 'string'));
    } catch { return {}; }
  }, [draftText]);
  const setDraft = (value: GeometryDraft | ((previous: GeometryDraft) => GeometryDraft)) => {
    setDraftText(JSON.stringify(typeof value === 'function' ? value(draft) : value));
  };
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const lockedCount = selectedNodes.filter(node => node.data.lockAspectRatio).length;
  const mixedLock = lockedCount > 0 && lockedCount < selectedNodes.length;
  const anyLocked = lockedCount > 0;
  const allLocked = lockedCount === selectedNodes.length;
  const dirty = Object.keys(draft).length > 0;
  const canEditPosition = allowPosition && selectedNodes.length === 1;
  const geometries = selectedNodes.map(effectiveNodeGeometry);
  useEffect(() => { if (lock.current) lock.current.indeterminate = mixedLock; }, [mixedLock]);

  const minimum = (field: 'width' | 'height') => Math.ceil(Math.max(...selectedNodes.map((node, index) => {
    const min = nodeGeometryMinimum(node);
    const size = geometries[index];
    if (!node.data.lockAspectRatio) return min[field];
    return field === 'width' ? Math.max(min.width, min.height * size.width / size.height) : Math.max(min.height, min.width * size.height / size.width);
  })) * 100) / 100;
  const maximum = (field: 'width' | 'height') => Math.min(...selectedNodes.map((node, index) => {
    // Content height is clamped at commit using the requested width. Keep
    // numeric validation for fixed material-width bounds only; a stale
    // current-width height limit must not reject a valid pending edit.
    const max = { ...nodeGeometryMaximum(node), height: Infinity };
    const size = geometries[index];
    if (!node.data.lockAspectRatio) return max[field];
    return field === 'width' ? Math.min(max.width, max.height * size.width / size.height) : Math.min(max.height, max.width * size.height / size.width);
  }));
  const cancel = () => { useUiStore.getState().setDraft(draftKey, ''); setEditing(false); setError(''); };
  useSelectionDraftBoundary(dirty, cancel);
  const parsedDraft = (): Partial<Record<GeometryField, number>> | null => {
    const patch: Partial<Record<GeometryField, number>> = {};
    for (const field of Object.keys(draft) as GeometryField[]) {
      const value = Number(draft[field]);
      if (!draft[field]?.trim() || !Number.isFinite(value)) {
        setError(t('format.invalidNumber'));
        return null;
      }
      if (field === 'width' || field === 'height') {
        if (value < minimum(field)) {
          setError(fmt(t('format.minimum'), { field: t(fieldLabels[field]), n: minimum(field) }));
          return null;
        }
        if (value > maximum(field)) {
          setError(fmt(t('format.maximum'), { field: t(fieldLabels[field]), n: numericText(maximum(field)) }));
          return null;
        }
      }
      patch[field] = value;
    }
    return patch;
  };
  const commit = () => {
    const patch = parsedDraft();
    if (patch) {
      if (dirty) useStore.getState().setSelectionGeometry(selectedNodes.map(node => node.id), patch);
      cancel();
    } else setEditing(false);
  };
  const dismiss = useInlineEditDismiss({ active: editing, ref: editor, onOutside: commit, onCancel: cancel });
  const displayFor = (field: GeometryField): { value: string; placeholder?: string } => {
    if (draft[field] !== undefined) return { value: draft[field] };
    const values = selectedNodes.map((node, index) => {
      const size = geometries[index];
      if (field === 'x' || field === 'y') return node.position[field];
      const other = field === 'width' ? 'height' : 'width';
      const otherDraft = draft[other];
      if (node.data.lockAspectRatio && otherDraft?.trim() && Number.isFinite(Number(otherDraft))) {
        return Number(otherDraft) * size[field] / size[other];
      }
      return size[field];
    });
    if (values.every(value => Math.abs(value - values[0]) < 0.01)) return { value: numericText(values[0]) };
    // A range describes the selection; only an entered number becomes a draft.
    return { value: '', placeholder: `${numericText(Math.min(...values))}~${numericText(Math.max(...values))}` };
  };
  const field = (name: GeometryField) => <label className={name === 'width' || name === 'height'
    ? 'min-w-0 grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-3' : 'block min-w-0 space-y-1.5'}>
    <span className="block text-control text-ink-muted">{t(fieldLabels[name])}</span>
    <span className={`flex min-w-0 items-center h-9 rounded-control border bg-card focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${error && draft[name] !== undefined ? 'border-watch' : 'border-line'}`}>
      <input type="text" inputMode="decimal" aria-label={t(fieldLabels[name])} data-node-format-field={name}
        {...displayFor(name)} autoComplete="off"
        aria-invalid={error && draft[name] !== undefined ? true : undefined}
        onFocus={() => setEditing(true)}
        onChange={event => {
          const text = event.target.value;
          setEditing(true); setError('');
          setDraft(previous => {
            const next = { ...previous, [name]: text };
            // With a locked ratio, the most recently edited axis drives size.
            if (anyLocked && name === 'width') delete next.height;
            if (anyLocked && name === 'height') delete next.width;
            return next;
          });
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); event.stopPropagation(); commit(); }
        }}
        className="w-full min-w-0 h-full bg-transparent px-2.5 text-control tabular-nums text-ink placeholder:text-ink-faint outline-none rounded-control" />
      <span className="pr-2 text-control text-ink-faint select-none" aria-hidden="true">px</span>
    </span>
  </label>;

  return <div ref={editor} onBlur={dismiss.onBlur} data-node-format-geometry>
    <section className="px-4 py-3 space-y-3" aria-label={t('format.size')}>
      <h3 className="text-title font-semibold text-ink">{t('format.size')}</h3>
      <div className="grid gap-3">{field('width')}{field('height')}</div>
      <label className="flex items-center gap-2 text-control text-ink-muted cursor-pointer w-fit min-h-6">
        <input ref={lock} type="checkbox" checked={allLocked} aria-checked={mixedLock ? 'mixed' : allLocked} data-node-format-lock
          onChange={event => {
            const patch = parsedDraft();
            if (!patch) return;
            const ids = selectedNodes.map(node => node.id);
            // Apply fields under the previous ratio, then lock the resulting shape.
            // The sequence is one undo step and never exposes an intermediate size.
            useStore.getState().setSelectionGeometry(ids, [patch, { lockAspectRatio: event.target.checked }]);
            cancel();
          }} className="h-3.5 w-3.5 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
        {t('format.lockAspectRatio')}
      </label>
    </section>
    {(canEditPosition || error || dirty) && <section className="px-4 py-3 border-t border-line space-y-3" aria-label={canEditPosition ? t('format.position') : undefined}>
      {canEditPosition && <>
        <h3 className="text-title font-semibold text-ink">{t('format.position')}</h3>
        <div className="grid grid-cols-2 gap-3">{field('x')}{field('y')}</div>
      </>}
      {error && <p className="text-control text-watch" role="alert">{error}</p>}
      {dirty && <p className="text-control text-ink-faint">{t('format.editHint')}</p>}
    </section>}
  </div>;
}

export default function SelectionToolbar({ getViewportRect }: { getViewportRect: ViewportRectGetter; withDetails?: boolean }) {
  const { selectedNodeIds, nodes, batchDelete, batchMergeSummarize, weaveHighlights, setArchived, duplicateSelection } = useStore();
  const project = useProjects(state => state.activeId);
  const t = useT();
  const [pending, setPending] = useState<PendingAction>(null);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const contentEditor = useRef<HTMLDivElement>(null);
  const selected = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter(node => selected.has(node.id) && !node.hidden && node.selectable !== false);
  const contentNodes = selectedNodes.filter(node => node.data.stepKind !== 'frame');
  const frames = selectedNodes.filter(node => node.data.stepKind === 'frame');
  const contentIds = contentNodes.map(node => node.id);
  const selectionKey = JSON.stringify([project, [...contentIds].sort()]);
  const frameKey = JSON.stringify([project, frames.map(frame => frame.id).sort()]);
  const draftKey = (action: Exclude<PendingAction, null>) => `selection-action:${selectionKey}:${action}`;
  const cancelInput = () => {
    if (pending) useUiStore.getState().setDraft(draftKey(pending), '');
    setPending(null); setInput('');
  };
  const dismiss = useInlineEditDismiss({ active: pending !== null, ref: contentEditor, onOutside: () => setPending(null), onCancel: cancelInput });
  useEffect(() => { if (pending) inputRef.current?.focus(); }, [pending]);
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (prevSelectionKey !== selectionKey) {
    setPrevSelectionKey(selectionKey);
    setPending(null); setInput('');
  }

  if (!selectedNodes.length) return null;
  const mixedTypes = frames.length > 0 && contentNodes.length > 0;
  const totalTokens = contentNodes.reduce((sum, node) => sum + (node.data.tokenCount || 0), 0);
  const allHighlights = contentNodes.flatMap(node => node.data.highlights || []);
  const run = () => {
    if (!contentIds.length) return;
    const text = input.trim();
    if (pending === 'merge') batchMergeSummarize(contentIds, false, text || undefined);
    else if (pending === 'mergeDelete') batchMergeSummarize(contentIds, true, text || undefined);
    else if (pending === 'weave') void weaveHighlights(contentIds, text || undefined);
    if (pending) useUiStore.getState().setDraft(draftKey(pending), '');
    setPending(null); setInput('');
  };
  const toggle = (action: Exclude<PendingAction, null>) => {
    setPending(pending === action ? null : action);
    setInput(useUiStore.getState().drafts[draftKey(action)] ?? '');
  };
  const actionClass = (action: Exclude<PendingAction, null>) => `${buttonClass} ${pending === action ? 'bg-accent/10 text-accent' : ''}`;

  return <div data-node-format-panel data-node-format-scroll>
    {contentNodes.length > 0 && <section data-selection-section="nodes" aria-label={fmt(t('frame.nodeScope'), { n: contentNodes.length })}>
      <div className="px-4 pt-3">
        <h3 className="text-title font-semibold text-ink">{fmt(t('frame.nodeScope'), { n: contentNodes.length })}</h3>
        {contentNodes.length === 1 && <p className="text-control text-ink-muted mt-1 truncate" data-format-node-name
          data-tooltip={getNodeDisplayName(contentNodes[0].data, t('ctx.unnamedNode'))} data-tooltip-overflow>
          {getNodeDisplayName(contentNodes[0].data, t('ctx.unnamedNode'))}
        </p>}
      </div>
      <GeometryEditor key={selectionKey} selectedNodes={contentNodes} allowPosition={contentNodes.length === 1} />
      <div ref={contentEditor} onBlur={dismiss.onBlur} className="border-t border-line">
        <div className="flex items-center gap-2 px-4 py-3 text-control text-ink-muted" data-node-format-content>
          <h3 className="font-medium text-ink">{t('format.contentActions')}</h3>
          <span className="ml-auto tabular-nums">{fmt(t('toolbar.tokens'), { n: totalTokens })}</span>
        </div>
        <div className="px-2 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => toggle('merge')} disabled={contentIds.length < 2} className={actionClass('merge')} ><ClipboardList size={14} className="shrink-0" />{t('toolbar.mergeSummary')}</button>
            <button type="button" onClick={() => toggle('mergeDelete')} disabled={contentIds.length < 2} className={actionClass('mergeDelete')} ><ClipboardList size={14} className="shrink-0" />{t('toolbar.mergeDelete')}</button>
            {allHighlights.length > 0 && <button type="button" onClick={() => toggle('weave')} className={actionClass('weave')} ><Highlighter size={14} className="shrink-0" />{t('toolbar.weave')}</button>}
            <button type="button" onClick={() => setArchived(contentIds, true)} disabled={!contentIds.length} className={buttonClass} ><Archive size={14} className="shrink-0" />{t('archive.label')}</button>
            <button type="button" onClick={() => { void updateSummaries(contentIds); }} disabled={!contentIds.length} className={buttonClass}  data-batch-reselect><Layers size={14} className="shrink-0" />{t('toolbar.reselectLadders')}</button>
          </div>
          {pending && <div className="px-2 space-y-2">
            <input ref={inputRef} type="text" value={input}
              onChange={event => { setInput(event.target.value); useUiStore.getState().setDraft(draftKey(pending), event.target.value, true); }}
              onKeyDown={event => { if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); run(); } }}
              aria-label={t('toolbar.intentPlaceholder')}
              placeholder={t('toolbar.intentPlaceholder')}
              className="w-full text-control border border-line rounded-control px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-accent bg-card min-w-0" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelInput} className={buttonClass}>{t('common.cancel')}</button>
              <button type="button" onClick={run} disabled={!contentIds.length}
                className="text-control bg-action text-white px-3 min-h-8 rounded-control hover:bg-action-strong transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('common.go')}</button>
            </div>
          </div>}
        </div>
      </div>
      <footer className="border-t border-line px-2 py-2 flex flex-wrap gap-1 [&>button]:px-2 [&>button]:gap-1.5 [&_svg]:shrink-0">
        <button type="button" onClick={() => duplicateSelection(contentIds)} className={buttonClass} ><Files size={14} strokeWidth={1.75} />{t('common.duplicate')}</button>
        <button type="button" onClick={() => downloadMarkdown(selectionMarkdown(contentIds))} className={buttonClass} aria-label={t('common.exportMd')} data-tooltip={t('toolbar.exportTitle')}><FileDown size={14} strokeWidth={1.75} />{t('common.export')}</button>
        <button type="button" data-selection-delete-nodes onClick={() => {
          void confirmDialog({ title: ti('confirm.deleteNodesTitle'), message: fmt(ti('confirm.deleteNodes'), { n: contentIds.length }), confirmLabel: ti('common.delete'), danger: true })
            .then(ok => { if (ok) batchDelete(contentIds); });
        }} className={`${buttonClass} ml-auto object-action-danger`} aria-label={t('confirm.deleteNodesTitle')}><Trash2 size={14} strokeWidth={1.75} />{t('common.delete')}</button>
      </footer>
    </section>}
    {frames.length > 0 && <section data-selection-section="frames" className={contentNodes.length ? 'border-t border-line' : undefined}
      aria-label={fmt(t('frame.frameScope'), { n: frames.length })}>
      <h3 className="px-4 pt-3 text-title font-semibold text-ink">{fmt(t('frame.frameScope'), { n: frames.length })}</h3>
      <FrameSettings key={frameKey} frames={frames}>
        <GeometryEditor key={frameKey} selectedNodes={frames} allowPosition={frames.length === 1} />
      </FrameSettings>
      <FrameObjectActions frames={frames} />
    </section>}
    <section className="px-4 py-3 border-t border-line space-y-2.5" aria-label={t('arrange.spatialTools')}>
      <h3 className="text-title font-semibold">{t(mixedTypes ? 'frame.arrangeSelection' : 'format.arrange')}</h3>
      {mixedTypes && <p className="text-control text-ink-muted">{fmt(t('frame.mixedSelection'), { frames: frames.length, nodes: contentNodes.length })}</p>}
      <div className="[&>div]:w-full [&>div]:ml-0 [&>div>button]:flex-1 [&>div>button]:justify-center [&>div>button]:border [&>div>button]:border-line [&>div>button]:bg-card [&>div>button:hover]:bg-wash">
        <SelectionArrangeMenu ids={selectedNodes.map(node => node.id)} getViewportRect={getViewportRect} />
      </div>
    </section>
  </div>;
}
