import { useState, useRef, useEffect } from 'react';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { Archive, Check, ChevronDown, ChevronUp, ClipboardList, Copy, FileDown, GitBranch, Highlighter, Layers, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
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

type PendingAction = 'explore' | 'merge' | 'mergeDelete' | 'weave' | null;
type GeometryField = 'width' | 'height' | 'x' | 'y';
type GeometryDraft = Partial<Record<GeometryField, string>>;
const fieldLabels = { width: 'format.width', height: 'format.height', x: 'format.x', y: 'format.y' } as const;
const numericText = (value: number) => String(Math.round(value * 100) / 100);
const buttonClass = 'min-h-8 px-2.5 rounded-control text-control text-ink-muted hover:bg-wash transition-colors flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';

/** One reversible edit boundary: Tab moves between fields without committing. */
function GeometryEditor({ selectedNodes, allowPosition }: { selectedNodes: ThoughtNode[]; allowPosition: boolean }) {
  const t = useT();
  const editor = useRef<HTMLDivElement>(null);
  const lock = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<GeometryDraft>({});
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const lockedCount = selectedNodes.filter(node => node.data.lockAspectRatio).length;
  const mixedLock = lockedCount > 0 && lockedCount < selectedNodes.length;
  const anyLocked = lockedCount > 0;
  const allLocked = lockedCount === selectedNodes.length;
  const dirty = Object.keys(draft).length > 0;
  const canEditPosition = allowPosition && selectedNodes.length === 1;
  const geometries = selectedNodes.map(effectiveNodeGeometry);
  const heightEditableNodes = selectedNodes.filter(node => node.data.stepKind !== 'frame');
  const automaticHeightCount = heightEditableNodes.filter(node => node.height == null).length;
  const heightMode = automaticHeightCount === selectedNodes.length ? 'auto'
    : automaticHeightCount === 0 ? 'fixed' : 'mixed';
  const canRestoreHeight = heightEditableNodes.some(node => node.height != null || node.data.keepOverviewHeight || node.data.lockAspectRatio)
    || draft.height !== undefined;
  useEffect(() => { if (lock.current) lock.current.indeterminate = mixedLock; }, [mixedLock]);

  const minimum = (field: 'width' | 'height') => Math.ceil(Math.max(...selectedNodes.map((node, index) => {
    const min = nodeGeometryMinimum(node);
    const size = geometries[index];
    if (!node.data.lockAspectRatio) return min[field];
    return field === 'width' ? Math.max(min.width, min.height * size.width / size.height) : Math.max(min.height, min.width * size.height / size.width);
  })) * 100) / 100;
  const maximum = (field: 'width' | 'height') => Math.min(...selectedNodes.map((node, index) => {
    const max = nodeGeometryMaximum(node);
    const size = geometries[index];
    if (!node.data.lockAspectRatio) return max[field];
    return field === 'width' ? Math.min(max.width, max.height * size.width / size.height) : Math.min(max.height, max.width * size.height / size.width);
  }));
  const cancel = () => { setDraft({}); setEditing(false); setError(''); };
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
  const commit = (outside = false) => {
    const patch = parsedDraft();
    if (patch) {
      if (dirty) useStore.getState().setSelectionGeometry(selectedNodes.map(node => node.id), patch);
      cancel();
    } else if (outside) {
      // Invalid local drafts never silently alter saved geometry.
      setDraft({}); setEditing(false);
    }
  };
  const dismiss = useInlineEditDismiss({ active: editing, ref: editor, onOutside: () => commit(true), onCancel: cancel });
  const valueFor = (field: GeometryField): string => {
    if (draft[field] !== undefined) return draft[field];
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
    return values.every(value => Math.abs(value - values[0]) < 0.01) ? numericText(values[0]) : '';
  };
  const field = (name: GeometryField) => <label className="block min-w-0 space-y-1.5">
    <span className="flex flex-wrap items-baseline justify-between gap-1 text-control text-ink-muted">
      <span>{t(fieldLabels[name])}</span>
      {name === 'height' && heightEditableNodes.length > 0 && <span className="text-meta text-ink-faint" data-node-format-height-mode={heightMode}>
        {t(heightMode === 'auto' ? 'format.heightAuto' : heightMode === 'fixed' ? 'format.heightFixed' : 'format.heightMixed')}
      </span>}
    </span>
    <span className={`flex items-center h-9 rounded-control border bg-card focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${error && draft[name] !== undefined ? 'border-watch' : 'border-line'}`}>
      <input type="text" inputMode="decimal" aria-label={t(fieldLabels[name])} data-node-format-field={name}
        value={valueFor(name)} placeholder={t('format.mixed')} autoComplete="off"
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
      <div className="grid grid-cols-2 gap-3">{field('width')}{field('height')}</div>
      {heightEditableNodes.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-meta text-ink-faint">{t('format.heightModeHint')}</span>
        <button type="button" data-node-format-auto-height disabled={!canRestoreHeight}
          className={buttonClass}
          onClick={() => {
            useStore.getState().setSelectionGeometry(heightEditableNodes.map(node => node.id), { autoHeight: true });
            const remaining = { ...draft };
            delete remaining.height;
            setDraft(remaining); setEditing(Object.keys(remaining).length > 0); setError('');
          }}>{t('format.restoreAutoHeight')}</button>
        {heightEditableNodes.some(node => node.data.lockAspectRatio) && <span className="w-full text-meta text-ink-faint" data-node-format-auto-height-hint>
          {t('format.autoHeightUnlockHint')}
        </span>}
      </div>}
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
      {dirty && <div className="flex items-center justify-between gap-2">
        <span className="text-control text-ink-faint">{t('format.editHint')}</span>
        <div className="flex gap-1">
          <button type="button" onClick={cancel} data-node-format-cancel className={buttonClass} title={t('common.cancel')} aria-label={t('common.cancel')}><X size={14} /></button>
          <button type="button" onClick={() => commit()} data-node-format-apply className={`${buttonClass} text-accent`}><Check size={14} />{t('format.apply')}</button>
        </div>
      </div>}
    </section>}
  </div>;
}

export default function SelectionToolbar({ getViewportRect, withDetails = false }: { getViewportRect: ViewportRectGetter; withDetails?: boolean }) {
  const { selectedNodeIds, nodes, batchDelete, batchMergeSummarize, weaveHighlights, exploreFrom, setArchived, duplicateSelection } = useStore();
  const t = useT();
  const [pending, setPending] = useState<PendingAction>(null);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [formatScope, setFormatScope] = useState<'nodes' | 'frames'>('nodes');
  const panelPosition = useCanvasPanelPosition();
  const panel = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentEditor = useRef<HTMLDivElement>(null);
  const selectionKey = [...selectedNodeIds].sort().join('\n');
  const draftKey = (action: Exclude<PendingAction, null>) => `selection-action:${JSON.stringify([...selectedNodeIds].sort())}:${action}`;
  const cancelInput = () => {
    if (pending) useUiStore.getState().setDraft(draftKey(pending), '');
    setPending(null); setInput('');
  };
  const dismiss = useInlineEditDismiss({ active: pending !== null, ref: contentEditor, onOutside: () => setPending(null), onCancel: cancelInput });
  useEffect(() => { if (pending) inputRef.current?.focus(); }, [pending]);
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (prevSelectionKey !== selectionKey) {
    setPrevSelectionKey(selectionKey);
    setPending(null); setInput(''); setCollapsed(true); setFormatScope('nodes');
  }

  const selected = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter(node => selected.has(node.id));
  if (!selectedNodes.length) return null;
  const contentNodes = selectedNodes.filter(node => node.data.stepKind !== 'frame');
  const frames = selectedNodes.filter(node => node.data.stepKind === 'frame');
  const contentIds = contentNodes.map(node => node.id);
  const hasFrames = contentNodes.length !== selectedNodes.length;
  const framesOnly = hasFrames && contentNodes.length === 0;
  const mixedTypes = hasFrames && contentNodes.length > 0;
  const editingFrames = framesOnly || (mixedTypes && formatScope === 'frames');
  const formatNodes = editingFrames ? frames : contentNodes;
  const panelTitle = t(framesOnly ? 'frame.settingsTitle' : 'format.title');
  const totalTokens = contentNodes.reduce((sum, node) => sum + (node.data.tokenCount || 0), 0);
  const allHighlights = contentNodes.flatMap(node => node.data.highlights || []);
  const run = () => {
    if (!contentIds.length) return;
    const text = input.trim();
    if (pending === 'explore') { if (!text) return; void exploreFrom(contentIds, text); }
    else if (pending === 'merge') batchMergeSummarize(contentIds, false, text || undefined);
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

  return <aside ref={panel} className="canvas-tool-panel flex flex-col" style={panelPosition}
    aria-label={panelTitle} data-selection-toolbar data-node-format-panel data-with-details={withDetails || undefined}>
    <header className={`shrink-0 ${collapsed ? '' : 'border-b border-line'}`}>
      <button type="button" onClick={() => setCollapsed(previous => !previous)} aria-expanded={!collapsed}
        data-node-format-close={!collapsed ? '' : undefined} data-node-format-reopen={collapsed ? '' : undefined}
        aria-label={t(framesOnly ? collapsed ? 'frame.expandSettings' : 'frame.collapseSettings' : collapsed ? 'format.expand' : 'format.collapse')}
        title={t(framesOnly ? collapsed ? 'frame.expandSettings' : 'frame.collapseSettings' : collapsed ? 'format.expand' : 'format.collapse')}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation();
            if (isImeComposing(event)) event.preventDefault();
          }
        }}
        style={{ outlineOffset: -2 }}
        className="w-full px-4 py-3 flex items-start gap-3 text-left cursor-pointer hover:bg-wash transition-colors focus-visible:outline-2 focus-visible:outline-accent">
        <span className="min-w-0 flex-1">
          <span className="block text-title font-semibold">{panelTitle}</span>
          <span className="block text-meta text-ink-muted mt-1">
            {mixedTypes ? fmt(t('frame.mixedSelection'), { frames: frames.length, nodes: contentNodes.length })
              : fmt(t(framesOnly ? 'frame.framesSelected' : 'toolbar.nodesSelected'), { n: selectedNodes.length })}
          </span>
          {selectedNodes.length === 1 && !framesOnly && <span className="block text-control text-ink-muted mt-1 truncate" data-format-node-name title={getNodeDisplayName(selectedNodes[0].data, t('ctx.unnamedNode'))}>
            {getNodeDisplayName(selectedNodes[0].data, t('ctx.unnamedNode'))}
          </span>}
        </span>
        <span className="h-7 w-7 -mr-1 shrink-0 flex items-center justify-center text-ink-muted" aria-hidden="true">
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>
      </button>
    </header>
    {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-node-format-scroll>
      {mixedTypes && <div className="px-4 py-3 border-b border-line">
        <div className="flex gap-1 rounded-control bg-wash p-1" role="group" aria-label={t('frame.formatScope')}>
          {(['nodes', 'frames'] as const).map(scope => <button type="button" key={scope} data-format-scope={scope}
            aria-pressed={formatScope === scope} onClick={() => setFormatScope(scope)}
            className={`flex-1 min-h-8 px-2 rounded-control text-control focus-visible:outline-2 focus-visible:outline-accent ${formatScope === scope ? 'bg-card text-ink' : 'text-ink-muted hover:text-ink'}`}>
            {fmt(t(scope === 'nodes' ? 'frame.nodeScope' : 'frame.frameScope'), { n: scope === 'nodes' ? contentNodes.length : frames.length })}
          </button>)}
        </div>
      </div>}
      {editingFrames ? <FrameSettings key={`${selectionKey}:frames`} frames={frames}>
        <GeometryEditor key={`${selectionKey}:frames`} selectedNodes={formatNodes} allowPosition={selectedNodes.length === 1} />
      </FrameSettings> : <GeometryEditor key={`${selectionKey}:nodes`} selectedNodes={formatNodes} allowPosition={selectedNodes.length === 1} />}
      <section className="px-4 py-3 border-t border-line space-y-2.5" aria-label={t('arrange.spatialTools')}>
        <h3 className="text-title font-semibold">{t(mixedTypes ? 'frame.arrangeSelection' : 'format.arrange')}</h3>
        <div className="[&>div]:w-full [&>div]:ml-0 [&>div>button]:flex-1 [&>div>button]:justify-center [&>div>button]:border [&>div>button]:border-line [&>div>button]:bg-card [&>div>button:hover]:bg-wash">
          <SelectionArrangeMenu ids={selectedNodeIds} getViewportRect={getViewportRect} />
        </div>
      </section>
      {editingFrames && <FrameObjectActions frames={frames} allowDelete={framesOnly} />}
      {!framesOnly && <div ref={contentEditor} onBlur={dismiss.onBlur} className="border-t border-line">
        <div className="flex items-center gap-2 px-4 py-3 text-control text-ink-muted" data-node-format-content>
          <h3 className="font-medium text-ink">{t('format.contentActions')}</h3>
          <span className="ml-auto tabular-nums">{fmt(t('toolbar.tokens'), { n: totalTokens })}</span>
        </div>
        <div className="px-2 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => toggle('merge')} disabled={contentIds.length < 2} className={actionClass('merge')} title={t('toolbar.mergeSummaryTitle')}><ClipboardList size={14} className="shrink-0" />{t('toolbar.mergeSummary')}</button>
            <button type="button" onClick={() => toggle('mergeDelete')} disabled={contentIds.length < 2} className={actionClass('mergeDelete')} title={t('toolbar.mergeDeleteTitle')}><ClipboardList size={14} className="shrink-0" />{t('toolbar.mergeDelete')}</button>
            <button type="button" onClick={() => toggle('explore')} disabled={!contentIds.length} className={actionClass('explore')} title={t('toolbar.exploreTitle')}><GitBranch size={14} className="shrink-0" />{t('common.explore')}</button>
            {allHighlights.length > 0 && <button type="button" onClick={() => toggle('weave')} className={actionClass('weave')} title={t('toolbar.weaveTitle')}><Highlighter size={14} className="shrink-0" />{t('toolbar.weave')}</button>}
            <button type="button" onClick={() => setArchived(contentIds, true)} disabled={!contentIds.length} className={buttonClass} title={t('archive.batchTitle')}><Archive size={14} className="shrink-0" />{t('archive.label')}</button>
            <button type="button" onClick={() => { void updateSummaries(contentIds); }} disabled={!contentIds.length} className={buttonClass} title={t('toolbar.reselectLaddersTitle')} data-batch-reselect><Layers size={14} className="shrink-0" />{t('toolbar.reselectLadders')}</button>
          </div>
          {pending && <div className="px-2 space-y-2">
            <input ref={inputRef} type="text" value={input}
              onChange={event => { setInput(event.target.value); useUiStore.getState().setDraft(draftKey(pending), event.target.value, true); }}
              onKeyDown={event => { if (event.key === 'Enter' && !isImeComposing(event) && (pending !== 'explore' || input.trim())) { event.preventDefault(); run(); } }}
              aria-label={pending === 'explore' ? t('toolbar.explorePlaceholder') : t('toolbar.intentPlaceholder')}
              placeholder={pending === 'explore' ? t('toolbar.explorePlaceholder') : t('toolbar.intentPlaceholder')}
              className="w-full text-control border border-line rounded-control px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-accent bg-card min-w-0" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelInput} className={buttonClass}>{t('common.cancel')}</button>
              <button type="button" onClick={run} disabled={!contentIds.length || (pending === 'explore' && !input.trim())}
                className="text-control bg-action text-white px-3 min-h-8 rounded-control hover:bg-action-strong transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('common.go')}</button>
            </div>
          </div>}
        </div>
      </div>}
      {!framesOnly && <footer className="border-t border-line px-2 py-2 flex flex-wrap gap-1">
        <button type="button" onClick={() => duplicateSelection(selectedNodeIds)} className={buttonClass} title={t('toolbar.duplicateTitle')}><Copy size={14} />{t(mixedTypes ? 'frame.copySelection' : 'toolbar.duplicate')}</button>
        <button type="button" onClick={() => downloadMarkdown(selectionMarkdown(contentIds))} className={buttonClass} title={t('toolbar.exportTitle')}><FileDown size={14} />{t(mixedTypes ? 'frame.exportSelectedNodes' : 'format.export')}</button>
        <button type="button" onClick={() => {
          void confirmDialog({ title: mixedTypes ? ti('frame.deleteSelection') : ti('confirm.deleteNodesTitle'), message: mixedTypes
            ? fmt(ti('frame.deleteMixedConfirm'), { frames: frames.length, nodes: contentNodes.length })
            : fmt(ti('confirm.deleteNodes'), { n: selectedNodeIds.length }), confirmLabel: ti('common.delete'), danger: true })
            .then(ok => { if (ok) batchDelete(selectedNodeIds); });
        }} className={`${buttonClass} ml-auto text-watch`}><Trash2 size={14} />{t(mixedTypes ? 'frame.deleteSelection' : 'common.delete')}</button>
      </footer>}
    </div>}
  </aside>;
}
