import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from '@xyflow/react';
import { Download, Loader2, Save } from 'lucide-react';
import type { Attachment } from '../types';
import { useProjects } from '../store/projects';
import { useT, fmt } from '../i18n';
import { toast } from '../lib/ui-store';
import { documentWriteError } from '../lib/document-errors';
import { useFileEditPreview } from '../lib/document-edit-preview';
import { docxHighlightAddress, registerDocxRulerHost } from '../lib/docx-ruler-navigation';
import type { OverviewRulerMark } from '../lib/overview-ruler';
import DocumentEditPreview from './DocumentEditPreview';
import {
  activateDocx, activeDocxSession, attachDocxHost, claimDocxHost, docxSnapshot,
  exportDocxSession, getDocxSession, saveDocxSession, startDocxSession,
  subscribeDocx, updateDocxAttachment, updateDocxHostMode,
} from '../lib/docx-session';
import SuperDocToolbar from './SuperDocToolbar';
import 'superdoc/style.layered.css';
import './SuperDocEditor.css';

function CanvasDocxViewportSync({ viewport }: { viewport: ReturnType<typeof getDocxSession>['viewport'] }) {
  const { subscribe } = useStoreApi();
  useEffect(() => {
    // Canvas transforms do not resize the host's CSS layout box. Subscribe to
    // their source as well as DOM geometry so every zoom frame is synchronized.
    const unsubscribe = subscribe((state, previous) => {
      if (state.transform[2] !== previous.transform[2]) viewport.refresh();
    });
    viewport.refresh();
    return unsubscribe;
  }, [subscribe, viewport]);
  return null;
}

export default function SuperDocEditor({ nodeId, attachment, compact = false, readOnly = false, onEditingChange, actionsHost, statusHost, rulerMark }: {
  nodeId: string; attachment: Attachment; compact?: boolean; readOnly?: boolean;
  onEditingChange?: (attachmentId: string, active: boolean) => void;
  actionsHost?: HTMLElement | null; statusHost?: HTMLElement | null;
  rulerMark?: OverviewRulerMark;
}) {
  // Project hydration swaps graph data before activeId. Remove view hosts
  // through that interval; their document sessions and drafts remain alive.
  const switching = useProjects(state => state.switching);
  return switching ? null : <LiveDocxEditor nodeId={nodeId} attachment={attachment} compact={compact} readOnly={readOnly}
    onEditingChange={onEditingChange} actionsHost={actionsHost} statusHost={statusHost} rulerMark={rulerMark} />;
}

function LiveDocxEditor({ nodeId, attachment, compact, readOnly, onEditingChange, actionsHost, statusHost, rulerMark }: {
  nodeId: string; attachment: Attachment; compact: boolean; readOnly: boolean;
  onEditingChange?: (attachmentId: string, active: boolean) => void;
  actionsHost?: HTMLElement | null; statusHost?: HTMLElement | null;
  rulerMark?: OverviewRulerMark;
}) {
  const t = useT();
  const projectId = useProjects(state => state.activeId) ?? 'default';
  const session = useMemo(() => getDocxSession(projectId, nodeId, attachment), [projectId, nodeId, attachment]); // the registry retains identity across saved revisions
  const preview = useFileEditPreview(projectId, nodeId, attachment.id);
  const needsSave = session.dirty;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [exportingPrevious, setExportingPrevious] = useState(false);
  useSyncExternalStore(subscribeDocx, docxSnapshot);
  useEffect(() => updateDocxAttachment(session, attachment), [session, attachment]);
  useEffect(() => {
    if (!host) return;
    if (!compact && !readOnly) activateDocx(session);
    return attachDocxHost(session, host);
  }, [session, host, compact, readOnly]);
  useEffect(() => { if (host) updateDocxHostMode(session, host, readOnly); }, [session, host, readOnly]);
  const ownsView = !!host && session.owner === host;
  const readyInstance = session.status === 'ready' && ownsView ? session.instance : null;
  useEffect(() => {
    if (!readyInstance) return;
    let request: AbortController | undefined;
    const reveal = (mark: OverviewRulerMark) => {
      if (!mark.documentMarkId || session.attachment.id !== mark.attachmentId) return;
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      void docxHighlightAddress(readyInstance, session.attachment, mark.documentMarkId, signal).then(async target => {
        if (signal.aborted || !target || session.owner !== host) return;
        session.viewport.beginNavigation();
        await readyInstance.ui.viewport.scrollIntoView({ target, block: 'center', behavior: 'instant' });
      }).catch(() => { /* The native session may be disposed while its query is running. */ });
    };
    const unregister = registerDocxRulerHost(session.element, reveal);
    if (rulerMark) reveal(rulerMark);
    return () => { request?.abort(); unregister(); };
  }, [readyInstance, host, session, rulerMark]);
  const active = activeDocxSession() === session && ownsView && !readOnly;
  // Only an active or unsaved editing session protects the working card.
  // An idle document follows the same overview preference as other files.
  const protectsWorkingCard = ownsView && !readOnly && (active || session.dirty || session.saving);
  useEffect(() => {
    onEditingChange?.(attachment.id, protectsWorkingCard);
    return () => onEditingChange?.(attachment.id, false);
  }, [attachment.id, onEditingChange, protectsWorkingCard]);
  const readerToolbar = !compact ? host?.closest('[data-material-reader]')?.querySelector('[data-docx-reader-toolbar]') : null;
  const save = () => { void saveDocxSession(session).catch(error => toast('error', t(documentWriteError(error)))); };
  const exportFile = () => { void exportDocxSession(session).catch(() => toast('error', t('richDocument.exportFailed'))); };
  const hasNativeRevision = !!(attachment.editedDocxRevision || attachment.editedDocxSavedAt)
    || attachment.editedDocxContent !== undefined;
  const previousHtml = attachment.legacyDocumentHtml ?? (!hasNativeRevision ? attachment.editedHtml : undefined);
  const previousText = attachment.legacyDocumentText ?? (!hasNativeRevision ? attachment.editedText : undefined);
  const hasPreviousCopy = previousHtml !== undefined || previousText !== undefined;
  const exportPrevious = async () => {
    if (exportingPrevious || !hasPreviousCopy) return;
    setExportingPrevious(true);
    try {
      const { exportDocumentDocx } = await import('../lib/docx-export');
      let html = previousHtml;
      if (html === undefined) {
        const [{ micromark }, { gfm, gfmHtml }] = await Promise.all([
          import('micromark'), import('micromark-extension-gfm'),
        ]);
        html = micromark(previousText ?? '', { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
      }
      await exportDocumentDocx(html, `${attachment.name.replace(/\.docx$/i, '')}-previous-copy.docx`);
    } catch { toast('error', t('richDocument.exportFailed')); }
    finally { setExportingPrevious(false); }
  };
  const status = <span data-superdoc-save-status data-type-surface="portal" role="status">{t(session.saving ? 'richDocument.saving' : needsSave ? 'docx.unsaved' : 'nativeDocument.saved')}</span>;
  const actions = <>
    {!readOnly && <button type="button" data-type-surface="portal" data-superdoc-save disabled={session.saving || session.conflict || session.status !== 'ready' || !needsSave}
      onClick={save} aria-label={t('common.save')} data-tooltip={t('document.saveNode')}><Save size={15} /></button>}
    <button type="button" data-type-surface="portal" data-superdoc-export disabled={session.status !== 'ready'} onClick={exportFile}
      aria-label={t('richDocument.exportDocx')} data-tooltip={t('richDocument.exportDocx')}><Download size={15} /></button>
  </>;
  return <div className={`docx-workspace nodrag nopan nowheel ${compact ? 'docx-workspace--compact' : ''}`}
    data-superdoc-editor={attachment.id} data-superdoc-ready={session.status === 'ready'}
    data-superdoc-active={active} data-superdoc-dirty={session.dirty}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
    onFocus={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}>
    {compact && ownsView && <CanvasDocxViewportSync viewport={session.viewport} />}
    {compact ? <>
      {statusHost && createPortal(status, statusHost)}
      {actionsHost && createPortal(actions, actionsHost)}
    </> : <div className="docx-document-actions">
      <span className="text-meta text-ink-muted">{status}</span><div className="flex-1" />{actions}
    </div>}
    {hasPreviousCopy && <p className="docx-notice">{t('docx.previousCopy')} <button type="button"
      className="text-accent hover:underline disabled:opacity-50" disabled={exportingPrevious}
      data-superdoc-export-previous onClick={() => void exportPrevious()}>{t('docx.exportPreviousCopy')}</button></p>}
    {session.missingFonts.length > 0 && <p className="docx-notice">{fmt(t('docx.missingFonts'), { fonts: session.missingFonts.join('、') })}</p>}
    {session.conflict && <div className="docx-notice">{t('docx.conflict')} <button type="button" onClick={() => void startDocxSession(session, true)}>{t('docx.reloadSaved')}</button></div>}
    <div data-type-surface="docx-viewport" className="docx-view-host" ref={setHost} />
    {!ownsView && session.status === 'ready' && <button type="button" className="docx-return-view text-control"
      onClick={() => { if (host) claimDocxHost(session, host); activateDocx(session); }}>{t('docx.editHere')}</button>}
    {preview && !session.dirty && !session.saving && <DocumentEditPreview attachment={attachment} preview={preview} />}
    {session.status === 'loading' && <div className="docx-load-state text-control"><Loader2 size={18} className="animate-spin" />{t('richDocument.loading')}</div>}
    {session.status === 'error' && <div className="docx-load-state text-control" role="alert">{t('document.originalUnavailable')}
      <button type="button" onClick={() => void startDocxSession(session, true)}>{t('docx.retry')}</button></div>}
    {active && session.instance && createPortal(<div className={`${readerToolbar ? 'docx-toolbar-inline' : 'docx-toolbar-dock'} nodrag nopan nowheel`} data-type-surface="portal" data-superdoc-toolbar>
      <SuperDocToolbar key={session.instance.superdocId} instance={session.instance} viewport={session.viewport} name={attachment.name} dirty={needsSave} saving={session.saving} canSave={!session.conflict}
        onSave={save} onExport={exportFile} onHide={() => activateDocx(null)} />
    </div>, readerToolbar ?? document.body)}
  </div>;
}
