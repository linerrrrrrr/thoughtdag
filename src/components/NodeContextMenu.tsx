import { useEffect, useRef, useState } from 'react';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, BookOpen, Copy, Files, FlaskConical, GitFork, Layers, Pencil, RefreshCw, StickyNote, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useUiStore, confirmDialog, toast } from '../lib/ui-store';
import { recapToNote } from '../lib/recap';
import { updateSummaries } from '../lib/ladder-reselect';
import { useT, fmt, t as ti } from '../i18n';
import { getNodeDisplayName } from '../lib/node-display-name';
import { isImeComposing } from '../utils';
import { NodeDetailControls } from './CanvasDetailControl';

// Right-click on a node: the app's own context menu (same visual language
// as the toolbar's ⋯ menu). The browser menu stays available where it is
// genuinely useful — right-clicking selected TEXT is not intercepted
// (see the onNodeContextMenu guard in App).

export default function NodeContextMenu({ x, y, nodeId, onClose }: {
  x: number; y: number; nodeId: string; onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const node = useStore((s) => s.nodes.find((n) => n.id === nodeId));
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  const commitRename = () => {
    const current = useStore.getState().nodes.find((n) => n.id === nodeId);
    if (!current || current.data.isLoading) return;
    const displayName = renameDraft.replace(/\s+/g, ' ').trim() || undefined;
    if (displayName !== current.data.displayName) {
      useStore.getState().pushHistory();
      useStore.setState((s) => ({ nodes: s.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, displayName } } : n) }));
      useStore.getState().pushHistory();
    }
    onClose();
  };
  useDismissableLayer({ dismissOnFocusOutside: true, open: !!node, refs: [ref], onDismiss: onClose });
  // Own focus before deferred outside-focus checks from the canvas settle.
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [nodeId]);
  const renameDismiss = useInlineEditDismiss({ active: renaming, ref, onOutside: commitRename, onCancel: () => setRenaming(false) });

  if (!node) return null;
  const kind = node.data.stepKind;
  const isContent = !!kind; // note / file / link / frame
  const hasResponse = !isContent && !!node.data.response && !node.data.isLoading;
  const copyText = isContent
    ? (kind === 'note' || kind === 'link' ? node.data.question : '')
    : node.data.response;

  const item = 'w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash transition-colors flex items-center gap-2.5';
  const icon = 'text-ink-faint shrink-0';

  // Keep the menu inside the viewport (it renders at the pointer)
  const MENU_W = renaming ? 260 : 272;
  const MENU_H = renaming ? 190 : 640;
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8));

  const run = (fn: () => void) => () => { onClose(); fn(); };

  return createPortal((
    <div ref={ref} tabIndex={-1} data-selection-menu onBlur={renaming ? renameDismiss.onBlur : undefined} className="fixed z-[70] bg-card border border-line rounded-overlay shadow-lg py-1 overflow-y-auto animate-fade-in" style={{ left, top, width: MENU_W, maxHeight: `calc(100dvh - ${top + 8}px)` }}>
      {renaming ? (
        <form className="p-3 space-y-2.5" onSubmit={(e) => {
          e.preventDefault();
          commitRename();
        }}>
          <label htmlFor="node-display-name" className="block text-sm font-medium text-ink">{t('ctx.rename')}</label>
          <input id="node-display-name" data-node-rename value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && isImeComposing(e)) e.preventDefault(); }}
            placeholder={getNodeDisplayName({ ...node.data, displayName: undefined }, t('ctx.unnamedNode'))}
            autoFocus maxLength={80} className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <p className="text-xs text-ink-muted leading-relaxed">{t('ctx.renameHint')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-ink-muted hover:bg-wash rounded-control">{t('common.cancel')}</button>
            <button type="submit" disabled={node.data.isLoading} className="px-3 py-1.5 text-xs text-white bg-accent hover:bg-accent-strong rounded-control disabled:opacity-50">{t('common.save')}</button>
          </div>
        </form>
      ) : <>
      {kind !== 'frame' && <div className="px-3 py-2 border-b border-line mb-1"><NodeDetailControls nodeId={nodeId} /></div>}
      {kind !== 'frame' && (
        <button className={`${item} disabled:opacity-50 disabled:cursor-not-allowed`} disabled={node.data.isLoading}
          title={node.data.isLoading ? t('ctx.renameBusy') : undefined}
          onClick={() => { setRenameDraft(node.data.displayName ?? ''); setRenaming(true); }} data-rename-node>
          <Pencil size={14} strokeWidth={1.75} className={icon} /> {t('ctx.rename')}
        </button>
      )}
      {!isContent && (
        <button className={item} onClick={run(() => {
          useUiStore.getState().setPanelOpen(true, nodeId);
        })}>
          <BookOpen size={14} strokeWidth={1.75} className={icon} /> {t('ctx.openPanel')}
        </button>
      )}
      {hasResponse && (
        <button className={item} onClick={run(() => { void useStore.getState().rerunNode(nodeId); })}>
          <RefreshCw size={14} strokeWidth={1.75} className={icon} /> {t('ctx.rerun')}
        </button>
      )}
      {hasResponse && (
        <button className={item} title={ti('actions.regenBranchTitle')} onClick={run(() => { void useStore.getState().regenerate(nodeId); })}>
          <GitFork size={14} strokeWidth={1.75} className={icon} /> {t('ctx.regenBranch')}
        </button>
      )}
      {hasResponse && (node.data.response?.length ?? 0) >= 400 && (
        <button className={item} onClick={run(() => { void updateSummaries([nodeId]); })} data-reselect-ladder>
          <Layers size={14} strokeWidth={1.75} className={icon} /> {t('ctx.reselectLadder')}
        </button>
      )}
      {hasResponse && (
        <button className={item} onClick={run(() => { void recapToNote(nodeId); })}>
          <StickyNote size={14} strokeWidth={1.75} className={icon} /> {t('continue.summarize')}
        </button>
      )}
      {copyText && (
        <button className={item} onClick={run(() => {
          void navigator.clipboard.writeText(copyText).then(() => toast('success', ti('ctx.copied')));
        })}>
          <Copy size={14} strokeWidth={1.75} className={icon} /> {t('ctx.copyContent')}
        </button>
      )}
      <button className={item} onClick={run(() => useStore.getState().duplicateNode(nodeId))}>
        <Files size={14} strokeWidth={1.75} className={icon} /> {t('ctx.duplicate')}
      </button>
      <button className={item} onClick={run(() => useStore.getState().setArchived([nodeId], !node.data.archived))}>
        {node.data.archived
          ? <ArchiveRestore size={14} strokeWidth={1.75} className={icon} />
          : <Archive size={14} strokeWidth={1.75} className={icon} />}
        {node.data.archived ? t('ctx.unarchive') : t('archive.label')}
      </button>
      {!isContent && (
        // the pre-agent-lane door, kept for people who work in a terminal: the node's context to the clipboard, the session mounts back as a branch
        <button className={item} title={ti('exp.copyForCliTitle')} onClick={run(() => {
          void import('../lib/experiment-loop').then((m) => m.takeToExperiment(nodeId, 'branch'));
        })} data-take-to-experiment>
          <FlaskConical size={14} strokeWidth={1.75} className={icon} /> {t('exp.copyForCli')}
        </button>
      )}
      <div className="h-px bg-line my-1" />
      <button
        className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2.5"
        onClick={run(() => {
          void confirmDialog({
            title: ti('confirm.deleteNodesTitle'),
            message: fmt(ti('confirm.deleteNodes'), { n: 1 }),
            confirmLabel: ti('common.delete'),
            danger: true,
          }).then((ok) => { if (ok) useStore.getState().deleteNode(nodeId); });
        })}
      >
        <Trash2 size={14} strokeWidth={1.75} className="shrink-0" /> {t('common.delete')}
      </button>
      </>}
    </div>
  ), document.body);
}
