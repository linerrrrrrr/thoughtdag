import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Highlighter, Loader2, MessageSquare, MousePointer2, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { Attachment, PdfAnnotation } from '../types';
import { documentCopyText } from '../lib/document-copy';
import { acquirePdfDocument, cachePdfPage, getCachedPdfPage, pdfDocumentKey, peekPdfDocument, releasePdfDocument, type PdfDocumentResource } from '../lib/pdf-document-cache';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useSessionDraft } from '../lib/use-session-draft';
import { toast, useUiStore } from '../lib/ui-store';
import { DocumentSourceError, documentWriteError } from '../lib/document-errors';
import { encodeBytes, savePdfFileRevision } from '../lib/attachment-vault';
import { isViewerMode } from '../lib/viewer';
import { useProjects } from '../store/projects';
import { useStore } from '../store';
import { generateId, isImeComposing } from '../utils';
import { fmt, useT } from '../i18n';
import { Markdown } from './Markdown';
import './PdfDocumentView.css';

type Pdfjs = typeof import('pdfjs-dist');
type Rect = [number, number, number, number];
type Mode = 'read' | 'highlight' | 'comment';
type Anchor = { id: string; question: string; rects: Rect[] };
type ScreenRect = { left: number; top: number; width: number; height: number };
type ClipHandler = (pageNo: number, rect: Rect, dataUrl: string, screenRect?: ScreenRect) => void;
const YELLOW = '#f4cc48';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const areaStyle = (rect: Rect) => ({ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${rect[2] * 100}%`, height: `${rect[3] * 100}%` });
const pendingKey = (projectId: string | null, nodeId: string, attachmentId: string) => `pdf-comment-anchor:${projectId ?? 'default'}:${nodeId}:${attachmentId}`;
const commentKey = (projectId: string | null, nodeId: string, attachmentId: string, annotationId: string) => `pdf-comment:${projectId ?? 'default'}:${nodeId}:${attachmentId}:${annotationId}`;

const annotationRevision = (annotations?: PdfAnnotation[]) => annotations?.length ? JSON.stringify(annotations) : undefined;

/** Render the imported pages and the undoable canvas marks exactly once. */
export default function PdfDocumentView({ nodeId, attachment, compact = false, actionsHost, statusHost, anchorsByPage, activeThreadId, onAnchorClick, clipMode = false, onClipped, onEditingChange }: {
  nodeId: string; attachment: Attachment; compact?: boolean;
  actionsHost?: HTMLElement | null; statusHost?: HTMLElement | null;
  anchorsByPage?: Map<number, Anchor[]>; activeThreadId?: string | null; onAnchorClick?: (id: string) => void;
  clipMode?: boolean; onClipped?: ClipHandler; onEditingChange?: (editing: boolean) => void;
}) {
  const t = useT();
  const projectId = useProjects(state => state.activeId);
  const [saving, setSaving] = useState(false);
  const revision = useMemo(() => annotationRevision(attachment.pdfAnnotations), [attachment.pdfAnnotations]);
  const needsWrite = revision !== annotationRevision(attachment.pdfSavedAnnotations);
  const cacheKey = pdfDocumentKey(projectId, nodeId, attachment.id);
  const cached = peekPdfDocument(cacheKey, attachment);
  const initialResource = cached?.document && cached.pdfjs ? { doc: cached.document, pdfjs: cached.pdfjs, resource: cached } : null;
  const root = useRef<HTMLDivElement>(null);
  const resourceRef = useRef<PdfDocumentResource | null>(null);
  const previousRetry = useRef(0);
  const [mode, setMode] = useState<Mode>('read');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ doc: PDFDocumentProxy; pdfjs: Pdfjs; resource: PdfDocumentResource } | null>(initialResource);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  const [retry, setRetry] = useState(0);
  const [width, setWidth] = useState(() => cached?.widths.get(compact ? 'compact' : 'reader') ?? (compact ? 380 : 680));
  const selectedCommentAt = useRef(0);
  const anchorDraftKey = pendingKey(projectId, nodeId, attachment.id);
  const pendingRaw = useUiStore(state => state.drafts[anchorDraftKey]);
  const pendingAnnotations = useMemo<PdfAnnotation[]>(() => {
    try { const parsed = pendingRaw ? JSON.parse(pendingRaw) : []; return Array.isArray(parsed) ? parsed : [parsed]; } catch { return []; }
  }, [pendingRaw]);
  const annotations = attachment.pdfAnnotations ?? [];
  const pending = pendingAnnotations.find(annotation => annotation.id === activeId);
  const active = annotations.find(annotation => annotation.id === activeId) ?? pending;
  const effectiveMode = isViewerMode || clipMode || error || !loaded ? 'read' : mode;
  useDismissableLayer({ open: effectiveMode !== 'read', refs: [root], dismissOnOutside: false, onDismiss: () => setMode('read') });
  const editingChanged = useRef(onEditingChange);
  editingChanged.current = onEditingChange;
  const isEditing = !!active && !!loaded && !error && !isViewerMode;
  useEffect(() => {
    editingChanged.current?.(isEditing);
    return () => editingChanged.current?.(false);
  }, [isEditing]);
  useEffect(() => { if (activeId && !active) setActiveId(null); }, [activeId, active]);

  useEffect(() => {
    let dead = false;
    const retryRequested = retry !== previousRetry.current;
    previousRetry.current = retry;
    const resource = acquirePdfDocument(cacheKey, attachment, retryRequested);
    resourceRef.current = resource;
    setLoaded(resource.document && resource.pdfjs ? { doc: resource.document, pdfjs: resource.pdfjs, resource } : null);
    setError(null);
    setWidth(resource.widths.get(compact ? 'compact' : 'reader') ?? (compact ? 380 : 680));
    void resource.promise.then(({ doc, pdfjs }) => {
      if (!dead) setLoaded(current => current?.doc === doc ? current : { doc, pdfjs, resource });
    }).catch((error: unknown) => {
      if (!dead) setError(error instanceof Error && error.message === 'PDF source missing' ? 'missing' : 'failed');
    });
    return () => {
      dead = true;
      if (resourceRef.current === resource) resourceRef.current = null;
      releasePdfDocument(resource);
    };
    // Vault migrations change storage location, not the immutable PDF identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, attachment.pdfFileRevision, retry]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      if (!element.isConnected || entries[0].contentRect.width <= 0) return;
      const next = Math.max(160, Math.min(900, entries[0].contentRect.width - 32));
      resourceRef.current?.widths.set(compact ? 'compact' : 'reader', next);
      setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => {
    // Once the original has moved to the vault, the short-lived cache should
    // not keep an extra reference to its former inline base64 payload.
    if (attachment.contentInVault && resourceRef.current) resourceRef.current.source = undefined;
  }, [attachment.contentInVault]);

  useEffect(() => {
    if (!compact) return;
    const scroller = root.current?.closest<HTMLElement>('[data-content-body]');
    const resource = resourceRef.current;
    if (!scroller || !resource) return;
    if (resource.canvasScroll) {
      scroller.scrollTop = resource.canvasScroll.top;
      scroller.scrollLeft = resource.canvasScroll.left;
    }
    const remember = () => { resource.canvasScroll = { top: scroller.scrollTop, left: scroller.scrollLeft }; };
    scroller.addEventListener('scroll', remember, { passive: true });
    return () => {
      if (scroller.isConnected) remember();
      scroller.removeEventListener('scroll', remember);
    };
  }, [cacheKey, retry, compact]);

  const currentAttachment = () => {
    const projects = useProjects.getState();
    if (projects.switching || projects.activeId !== projectId) return undefined;
    return useStore.getState().nodes.find(node => node.id === nodeId)?.data.attachments?.find(item => item.id === attachment.id);
  };
  const commit = (change: (current: PdfAnnotation[]) => PdfAnnotation[]) => {
    if (isViewerMode) return;
    const state = useStore.getState();
    const current = currentAttachment();
    if (!current) return;
    state.pushHistory();
    state.setAttachmentData(nodeId, attachment.id, { pdfAnnotations: change(current.pdfAnnotations ?? []) });
    state.pushHistory();
  };
  const annotate = (page: number, rects: Rect[], text?: string, pointNote = false) => {
    if (effectiveMode === 'read' || rects.length === 0) return;
    if (effectiveMode === 'comment' && !text && Date.now() - selectedCommentAt.current < 150) return;
    const annotation: PdfAnnotation = { id: generateId(), page, rects, text, kind: pointNote ? 'note' : 'highlight', color: YELLOW, createdAt: new Date().toISOString() };
    if (effectiveMode === 'highlight') {
      commit(current => [...current, annotation]);
    } else {
      // An unfinished comment keeps its anchor alongside the shared text draft.
      // It is visible as a draft marker, but never enters the persisted annotation list.
      useUiStore.getState().setDraft(anchorDraftKey, JSON.stringify([...pendingAnnotations, annotation]), true);
      setActiveId(annotation.id);
    }
  };
  const selectText = (event: MouseEvent<HTMLDivElement>) => {
    if (effectiveMode === 'read') return;
    event.stopPropagation();
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, textarea, [data-pdf-region-layer]'))) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    if (!root.current?.contains(range.startContainer) || !root.current.contains(range.endContainer)) return;
    const text = selection.toString().trim();
    const screenRects = Array.from(range.getClientRects());
    const additions: PdfAnnotation[] = [];
    for (const page of root.current.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
      const bounds = page.getBoundingClientRect();
      const rects = screenRects.flatMap<Rect>(rect => {
        const left = Math.max(rect.left, bounds.left), top = Math.max(rect.top, bounds.top);
        const right = Math.min(rect.right, bounds.right), bottom = Math.min(rect.bottom, bounds.bottom);
        if (right - left < 1 || bottom - top < 1 || rect.height > bounds.height * .3) return [];
        return [[clamp((left - bounds.left) / bounds.width), clamp((top - bounds.top) / bounds.height), clamp((right - left) / bounds.width), clamp((bottom - top) / bounds.height)]];
      }).slice(0, 200);
      if (!rects.length) continue;
      const pageNo = Number(page.dataset.page);
      if (effectiveMode === 'comment') { selectedCommentAt.current = Date.now(); annotate(pageNo, rects, text); break; }
      additions.push({ id: generateId(), page: pageNo, rects, text, color: YELLOW, createdAt: new Date().toISOString() });
    }
    if (additions.length) commit(current => [...current, ...additions]);
    selection.removeAllRanges();
  };
  const saveAnnotations = async (edited?: PdfAnnotation) => {
    const current = currentAttachment();
    if (isViewerMode || !loaded || !current || saving) return false;
    const previous = current.pdfAnnotations;
    const marks = previous ?? [];
    const next = !edited ? marks : marks.some(mark => mark.id === edited.id)
      ? marks.map(mark => mark.id === edited.id ? edited : mark) : [...marks, edited];
    const assertCurrent = () => {
      const live = currentAttachment();
      if (!live || live.pdfAnnotations !== previous || live.pdfFileRevision !== current.pdfFileRevision
        || resourceRef.current !== loaded.resource) throw new DocumentSourceError('document.editChanged');
    };
    setSaving(true);
    try {
      const [{ annotatedPdf }, { saveNodeFile }] = await Promise.all([import('../lib/pdf-annotations'), import('../lib/node-files')]);
      const blob = await annotatedPdf(loaded.doc, next);
      const content = encodeBytes(new Uint8Array(await blob.arrayBuffer()));
      const pdfFileRevision = await savePdfFileRevision(content);
      assertCurrent();
      await saveNodeFile(projectId ?? 'default', nodeId, current, content, assertCurrent, nodeFileRevision => {
        const state = useStore.getState();
        state.pushHistory();
        state.setAttachmentData(nodeId, attachment.id, { pdfFileRevision, pdfFileContent: undefined,
          pdfAnnotations: next, pdfSavedAnnotations: next, nodeFileRevision, size: blob.size });
        state.pushHistory();
      });
      return true;
    } catch (error) { toast('error', t(documentWriteError(error))); return false; }
    finally { setSaving(false); }
  };
  const saveComment = async (annotation: PdfAnnotation, comment: string) => {
    if (!await saveAnnotations({ ...annotation, comment })) return false;
    clearPending(annotation.id);
    setActiveId(null);
    return true;
  };
  const clearPending = (annotationId: string) => {
    const next = pendingAnnotations.filter(annotation => annotation.id !== annotationId);
    useUiStore.getState().setDraft(anchorDraftKey, next.length ? JSON.stringify(next) : '');
  };
  const cancelComment = (annotation: PdfAnnotation) => {
    clearPending(annotation.id);
    setActiveId(null);
  };
  const removeAnnotation = (annotation: PdfAnnotation) => {
    if (pending?.id !== annotation.id) commit(current => current.filter(item => item.id !== annotation.id));
    useUiStore.getState().setDraft(commentKey(projectId, nodeId, attachment.id, annotation.id), '');
    cancelComment(annotation);
  };

  const saveButton = <button type="button" data-pdf-save disabled={!needsWrite || saving || !loaded}
    onClick={() => void saveAnnotations()} aria-label={t('common.save')} data-tooltip={t('document.saveNode')}
    className={actionsHost ? undefined : 'pdf-document-tool text-control text-ink-muted hover:bg-wash'}><Save size={15} strokeWidth={1.75} /></button>;
  const status = <span role="status" className="text-meta text-ink-faint">{saving ? t('richDocument.saving')
    : needsWrite ? t('docx.unsaved') : t('nativeDocument.saved')}</span>;
  return <div ref={root} className={`pdf-document-view nodrag nopan nowheel ${compact ? 'pdf-document-compact' : ''}`}
    data-pdf-document={attachment.id} onDoubleClick={event => event.stopPropagation()} onMouseUp={selectText}>
    <div className="pdf-document-controls">
      {!isViewerMode && loaded && !error && <div className="pdf-document-toolbar" role="group" aria-label={t('pdfDocument.read')}>
        {([{ value: 'read', icon: MousePointer2, label: 'pdfDocument.read' }, { value: 'highlight', icon: Highlighter, label: 'pdfDocument.highlight' }, { value: 'comment', icon: MessageSquare, label: 'pdfDocument.comment' }] as const).map(({ value, icon: Icon, label }) => (
          <button key={value} type="button" disabled={clipMode} aria-pressed={effectiveMode === value} onClick={() => setMode(current => current === value ? 'read' : value)} data-pdf-mode={value}
            className={`pdf-document-tool text-control ${effectiveMode === value ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-wash'}`}>
            <Icon size={15} strokeWidth={1.75} />{t(label)}
          </button>
        ))}
        {actionsHost ? createPortal(saveButton, actionsHost) : <div className="ml-auto flex items-center gap-2">{!statusHost && status}{saveButton}</div>}
        {statusHost && createPortal(status, statusHost)}
      </div>}
      {!isViewerMode && effectiveMode !== 'read' && <p className="pdf-document-mode-hint text-control text-ink-faint">{t(effectiveMode === 'highlight' ? 'pdfDocument.highlightHint' : 'pdfDocument.commentHint')}</p>}
      {active && loaded && !error && <PdfComment key={active.id} annotation={active} nodeId={nodeId} attachmentId={attachment.id} isNew={pending?.id === active.id} saving={saving}
        onClose={() => setActiveId(null)} onCancel={() => cancelComment(active)} onSave={comment => saveComment(active, comment)} onDelete={() => removeAnnotation(active)} />}
    </div>
    {error ? <div className="pdf-document-fallback" data-pdf-fallback>
      <div className="flex items-center gap-2 flex-wrap text-control text-ink-muted">
        <p className="flex-1 min-w-0">{t('pdfDocument.textFallback')}</p>
        {!isViewerMode && <button type="button" onClick={() => setRetry(value => value + 1)} className="pdf-document-tool text-control text-accent"><RefreshCw size={14} />{t('pdfDocument.retry')}</button>}
      </div>
      {documentCopyText(attachment).trim() && <div className="markdown-body text-body text-ink" data-pdf-fallback-text><Markdown>{documentCopyText(attachment)}</Markdown></div>}
      {annotations.length > 0 && <section className="pdf-document-fallback-comments" aria-label={t('pdfDocument.comment')} data-pdf-fallback-annotations>
        {annotations.map(annotation => <article key={annotation.id} className="pdf-document-fallback-comment" data-pdf-fallback-annotation={annotation.id}>
          <div className="text-meta text-ink-faint">{fmt(t('pdfDocument.page'), { page: annotation.page })}</div>
          {annotation.text && <blockquote className="pdf-document-quote text-body text-ink-muted">{annotation.text}</blockquote>}
          {annotation.comment && <p className="text-body text-ink whitespace-pre-wrap">{annotation.comment}</p>}
          {!annotation.text && !annotation.comment && <p className="text-control text-ink-muted">{t('pdfDocument.savedMark')}</p>}
        </article>)}
      </section>}
    </div> : !loaded ? <div className="pdf-document-status text-control text-ink-muted"><Loader2 size={16} className="animate-spin" />{t('pdfDocument.loading')}</div>
      : <div className="pdf-document-pages">{Array.from({ length: loaded.doc.numPages }, (_, index) => (
        <PdfOriginalPage key={`${attachment.id}:${index + 1}`} doc={loaded.doc} pdfjs={loaded.pdfjs} resource={loaded.resource} pageNo={index + 1} width={width} mode={effectiveMode}
          annotations={annotations.filter(annotation => annotation.page === index + 1)} pending={pendingAnnotations.filter(annotation => annotation.page === index + 1)}
          activeId={activeId} onAnnotationClick={setActiveId} onAnnotate={annotate} anchors={anchorsByPage?.get(index + 1)} activeThreadId={activeThreadId}
          onAnchorClick={onAnchorClick} clipMode={clipMode} onClipped={onClipped} />
      ))}</div>}
  </div>;
}

function PdfComment({ annotation, nodeId, attachmentId, isNew, saving, onClose, onCancel, onSave, onDelete }: {
  annotation: PdfAnnotation; nodeId: string; attachmentId: string; isNew: boolean; saving: boolean;
  onClose: () => void; onCancel: () => void; onSave: (value: string) => Promise<boolean>; onDelete: () => void;
}) {
  const t = useT();
  const projectId = useProjects(state => state.activeId);
  const key = commentKey(projectId, nodeId, attachmentId, annotation.id);
  const [draft, setDraft] = useSessionDraft(key, annotation.comment ?? '');
  const boundary = useRef<HTMLDivElement>(null);
  const cancel = () => { if (!saving) { useUiStore.getState().setDraft(key, ''); onCancel(); } };
  const save = async () => {
    if (isViewerMode || saving || (isNew && !draft.trim())) return;
    if (await onSave(draft)) useUiStore.getState().setDraft(key, '');
  };
  const dismiss = useInlineEditDismiss({ active: true, ref: boundary, onOutside: onClose, onCancel: cancel });
  return <div ref={boundary} onBlur={dismiss.onBlur} className="pdf-document-comment" data-pdf-comment-editor={annotation.id}
    onMouseUp={event => event.stopPropagation()} onKeyDown={event => {
      if (!isImeComposing(event) && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); save(); }
    }}>
    <div className="flex items-center gap-2 text-control text-ink-muted"><MessageSquare size={15} />{fmt(t('pdfDocument.page'), { page: annotation.page })}{isNew && <span className="text-ink-faint">{t('pdfDocument.commentDraft')}</span>}</div>
    {annotation.text && <blockquote className="pdf-document-quote text-control text-ink-muted">{annotation.text}</blockquote>}
    {isViewerMode ? <p className="text-body whitespace-pre-wrap text-ink">{annotation.comment || annotation.text || t('pdfDocument.savedMark')}</p>
      : <textarea value={draft} readOnly={saving} onChange={event => setDraft(event.target.value)} autoFocus rows={3} aria-label={t('pdfDocument.commentBody')}
        className="w-full resize-y min-h-[80px] text-body text-ink bg-card border border-line rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />}
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {!isViewerMode && <button type="button" disabled={saving} onClick={onDelete} className="mr-auto pdf-document-tool text-control text-ink-muted hover:text-red-500" data-pdf-delete-annotation><Trash2 size={14} />{t('pdfDocument.delete')}</button>}
      <button type="button" disabled={saving} onClick={isViewerMode ? onClose : cancel} className="pdf-document-tool text-control text-ink-muted hover:bg-wash">{t(isViewerMode ? 'panel.close' : 'common.cancel')}</button>
      {!isViewerMode && <button type="button" onClick={save} disabled={saving || (isNew && !draft.trim())} className="pdf-document-tool text-control text-white bg-action disabled:opacity-40">{t('common.save')}</button>}
    </div>
  </div>;
}

function PdfOriginalPage({ doc, pdfjs, resource, pageNo, width, mode, annotations, pending, activeId, onAnnotationClick, onAnnotate, anchors, activeThreadId, onAnchorClick, clipMode, onClipped }: {
  doc: PDFDocumentProxy; pdfjs: Pdfjs; resource: PdfDocumentResource; pageNo: number; width: number; mode: Mode;
  annotations: PdfAnnotation[]; pending: PdfAnnotation[]; activeId: string | null;
  onAnnotationClick: (id: string) => void; onAnnotate: (page: number, rects: Rect[], text?: string, pointNote?: boolean) => void;
  anchors?: Anchor[]; activeThreadId?: string | null; onAnchorClick?: (id: string) => void; clipMode: boolean; onClipped?: ClipHandler;
}) {
  const t = useT();
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNo <= 2);
  const [ratio, setRatio] = useState(() => resource.pageRatios.get(pageNo) ?? 1.4142);
  const [hasText, setHasText] = useState<boolean | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const height = Math.round(width * ratio);
  useDismissableLayer({ open: !!band, refs: [holder], dismissOnOutside: false, onDismiss: () => { drag.current = null; setBand(null); } });
  useEffect(() => {
    let dead = false;
    const cachedRatio = resource.pageRatios.get(pageNo);
    if (cachedRatio !== undefined) queueMicrotask(() => { if (!dead) setRatio(cachedRatio); });
    else void doc.getPage(pageNo).then(page => {
      const viewport = page.getViewport({ scale: 1 });
      if (!dead) {
        const value = viewport.height / viewport.width;
        resource.pageRatios.set(pageNo, value);
        setRatio(value);
      }
    }).catch(() => {});
    return () => { dead = true; };
  }, [doc, resource, pageNo]);
  useEffect(() => {
    if (visible || !holder.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '700px' });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let dead = false;
    let render: RenderTask | undefined;
    let layer: InstanceType<Pdfjs['TextLayer']> | undefined;
    const factor = Math.min(window.devicePixelRatio || 1, 1.75);
    const cachedPage = getCachedPdfPage(resource, pageNo, width, factor);
    if (cachedPage && canvas.current && textLayer.current) {
      canvas.current.width = cachedPage.canvas.width;
      canvas.current.height = cachedPage.canvas.height;
      canvas.current.getContext('2d')?.drawImage(cachedPage.canvas, 0, 0);
      const copy = cachedPage.textLayer.cloneNode(true) as HTMLElement;
      textLayer.current.replaceChildren(...Array.from(copy.childNodes));
      textLayer.current.style.setProperty('--scale-factor', String(cachedPage.scale));
      queueMicrotask(() => {
        if (!dead) { setRatio(cachedPage.ratio); setHasText(cachedPage.hasText); setRenderError(false); }
      });
      return () => { dead = true; };
    }
    const renderedCanvas = document.createElement('canvas');
    void (async () => {
      try {
        const page = await doc.getPage(pageNo);
        if (dead) return;
        const scale = width / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale });
        renderedCanvas.width = Math.ceil(viewport.width * factor); renderedCanvas.height = Math.ceil(viewport.height * factor);
        const context = renderedCanvas.getContext('2d');
        if (!context) return;
        render = page.render({ canvasContext: context, viewport, ...(factor !== 1 ? { transform: [factor, 0, 0, factor, 0, 0] } : {}) });
        await render.promise;
        const text = await page.getTextContent();
        if (dead || !canvas.current || !textLayer.current) return;
        canvas.current.width = renderedCanvas.width; canvas.current.height = renderedCanvas.height;
        canvas.current.getContext('2d')?.drawImage(renderedCanvas, 0, 0);
        textLayer.current.replaceChildren();
        textLayer.current.style.setProperty('--scale-factor', String(scale));
        layer = new pdfjs.TextLayer({ textContentSource: text, container: textLayer.current, viewport });
        await layer.render();
        if (!dead) {
          const hasPageText = text.items.some(item => 'str' in item && item.str.trim());
          setHasText(hasPageText); setRenderError(false);
          cachePdfPage(resource, pageNo, { width, pixelRatio: factor, scale, ratio: viewport.height / viewport.width,
            hasText: hasPageText, canvas: renderedCanvas, textLayer: textLayer.current.cloneNode(true) as HTMLElement });
        }
      } catch {
        if (!dead) setRenderError(true);
      }
    })();
    return () => { dead = true; render?.cancel(); layer?.cancel(); };
  }, [visible, width, doc, pdfjs, resource, pageNo]);
  const fraction = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = holder.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  };
  const finishRegion = (event: PointerEvent<HTMLDivElement>) => {
    const selection = drag.current;
    drag.current = null; setBand(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!selection) return;
    const rect: Rect = [Math.min(selection.x0, selection.x1), Math.min(selection.y0, selection.y1), Math.abs(selection.x1 - selection.x0), Math.abs(selection.y1 - selection.y0)];
    if (clipMode) {
      if (rect[2] < .01 || rect[3] < .005 || !canvas.current || !holder.current) return;
      const source = canvas.current, output = document.createElement('canvas');
      output.width = Math.max(1, Math.round(rect[2] * source.width)); output.height = Math.max(1, Math.round(rect[3] * source.height));
      output.getContext('2d')?.drawImage(source, rect[0] * source.width, rect[1] * source.height, rect[2] * source.width, rect[3] * source.height, 0, 0, output.width, output.height);
      const bounds = holder.current.getBoundingClientRect();
      onClipped?.(pageNo, rect, output.toDataURL('image/png'), { left: bounds.left + rect[0] * bounds.width, top: bounds.top + rect[1] * bounds.height, width: rect[2] * bounds.width, height: rect[3] * bounds.height });
    } else if (mode === 'comment') {
      const pointNote = rect[2] < .01 || rect[3] < .005;
      onAnnotate(pageNo, pointNote ? [[Math.min(.97, selection.x0), Math.min(.98, selection.y0), .025, .018]] : [rect], undefined, pointNote);
    } else if (rect[2] >= .01 && rect[3] >= .005) onAnnotate(pageNo, [rect]);
  };
  const allAnnotations = [...annotations, ...pending];
  return <div className="pdf-document-page-wrap">
    <div className="pdf-document-page-label text-meta text-ink-faint">{fmt(t('pdfDocument.page'), { page: pageNo })}</div>
    <div ref={holder} data-pdf-page data-page={pageNo} className="pdf-document-page" style={{ width, height }}
      onClick={event => {
        if (mode !== 'comment' || clipMode || hasText === false || (event.target instanceof Element && event.target.closest('button'))) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        onAnnotate(pageNo, [[Math.min(.97, clamp((event.clientX - bounds.left) / bounds.width)), Math.min(.98, clamp((event.clientY - bounds.top) / bounds.height)), .025, .018]], undefined, true);
      }}>
      <canvas ref={canvas} className="pdf-document-canvas" />
      <div ref={textLayer} className="tdag-textlayer" />
      {renderError && <p className="pdf-document-render-error text-control">{t('pdfDocument.failed')}</p>}
      {allAnnotations.map(annotation => <div key={annotation.id}>
        {annotation.rects.map((rect, index) => <button key={index} type="button" data-pdf-annotation={annotation.id}
          aria-label={annotation.comment || annotation.text || t(pending.some(item => item.id === annotation.id) ? 'pdfDocument.commentDraft' : 'pdfDocument.savedMark')}
          tabIndex={index === 0 ? 0 : -1} onClick={event => { event.stopPropagation(); onAnnotationClick(annotation.id); }}
          className={`pdf-document-mark ${activeId === annotation.id ? 'pdf-document-mark-active' : ''} ${pending.some(item => item.id === annotation.id) ? 'pdf-document-mark-draft' : ''}`}
          style={{ ...areaStyle(rect), backgroundColor: annotation.color || YELLOW, pointerEvents: mode === 'read' ? 'auto' : 'none' }} />)}
        {annotation.rects[0] && <button type="button" className="pdf-document-comment-pin" data-pdf-comment-pin={annotation.id}
          style={{ top: `${annotation.rects[0][1] * 100}%` }} aria-label={annotation.comment || t('pdfDocument.savedMark')}
          onClick={event => { event.stopPropagation(); onAnnotationClick(annotation.id); }}><MessageSquare size={13} /></button>}
      </div>)}
      {anchors?.map(anchor => <div key={anchor.id}>{anchor.rects.map((rect, index) => <div key={index} className="pdf-document-thread-mark" style={{ ...areaStyle(rect), opacity: activeThreadId === anchor.id ? .25 : .12 }} />)}
        <button type="button" className="pdf-document-thread-pin" data-anchor-bubble={anchor.id} style={{ top: `${(anchor.rects[0]?.[1] ?? 0) * 100}%` }}
          aria-label={anchor.question} onClick={event => { event.stopPropagation(); onAnchorClick?.(anchor.id); }}><MessageSquare size={13} /></button></div>)}
      {(clipMode || (hasText === false && mode !== 'read')) && !isViewerMode && <div data-pdf-region-layer data-clip-overlay={clipMode ? pageNo : undefined} className="pdf-document-region-layer"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          const point = fraction(event); drag.current = { x0: point.x, y0: point.y, x1: point.x, y1: point.y }; setBand(drag.current);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (drag.current) { const point = fraction(event); drag.current = { ...drag.current, x1: point.x, y1: point.y }; setBand(drag.current); } }}
        onPointerUp={finishRegion} onPointerCancel={() => { drag.current = null; setBand(null); }}>
        {band && <div className="pdf-document-region-band" style={areaStyle([Math.min(band.x0, band.x1), Math.min(band.y0, band.y1), Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0)])} />}
      </div>}
    </div>
  </div>;
}
