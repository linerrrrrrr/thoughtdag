import { appSettings } from '../lib/disk-storage';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useSessionDraft } from '../lib/use-session-draft';
import { canHighlightConversation, useTextHighlighter } from '../lib/use-text-highlighter';
import { attachmentHighlights, conversationHighlightTexts } from '../lib/highlight-match';
import { useProjects } from '../store/projects';
import { ChevronDown, ChevronRight, Crosshair, FileText, Link2, Loader2, Maximize2, PanelLeft, RefreshCw, ScanText, Send, Sparkles, StickyNote, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Attachment, ThoughtNode } from '../types';
import { useStore } from '../store';
import { useUiStore, toast } from '../lib/ui-store';
import { useModels } from '../lib/use-models';
import { generateDigest, recognitionPageCount, recognizePdfPages, spawnContentNode, extractImage } from '../lib/content';
import { Markdown, HighlightedMarkdown } from './Markdown';
import { generateId, isImeComposing } from '../utils';
import { useT, fmt } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import { HtmlMaterialView } from './HtmlMaterialView';
import { NotebookView } from './NotebookView';
import { isNotebook } from '../lib/notebook';
import { documentCopyText, hasNativeDocxSource, isEditableDocument, isDocxDocument } from '../lib/document-copy';
import DocumentRichBody from './DocumentRichBody';
import { StreamingFileText } from './FileTextPreview';
import { previewTextParts, useFileEditPreview } from '../lib/document-edit-preview';
import DocumentOriginalButton from './DocumentOriginalButton';
import SearchToggles from './ui/SearchToggles';
import HighlighterButton from './ui/HighlighterButton';
import { useReaderDock, READER_MIN_WIDTH, READER_DEFAULT_WIDTH, READER_STRIP_WIDTH, DOCK_MIN_WINDOW, type ReaderDock } from '../lib/reader-dock';
import { screenToUi, uiToScreen, uiViewport } from '../lib/ui-scale';
import { findHighlightedPassage, revealHighlight, revealMountedPdfHighlight } from '../lib/highlight-navigation';
import { findRichHighlightRange } from '../lib/document-highlights';
import { readPdfTextSelection } from '../lib/pdf-text-selection';
import { formatAnchorPages } from '../lib/pdf-mark';

// MaterialReader: the reading overlay — a VIEW onto a material node, never a
// container. Select a passage (in the original PDF's text layer, or in the
// extracted Markdown copy) and ask: the question lands on the canvas
// IMMEDIATELY as a branch node wired to this material (the One Rule; nothing
// happens at close time). Scanned PDFs have no text layer, so the extracted
// copy is the readable surface there; "Recognize" rewrites page images into
// Markdown through the same visible-extraction channel image nodes use.

const SuperDocEditor = lazy(() => import('./SuperDocEditor'));
const PdfDocumentView = lazy(() => import('./PdfDocumentView'));

const PAGE_MARK_SPLIT = /<!--\s*tdag-page:(\d+)\s*-->/;

/** Split the extracted copy on page markers so each section knows its page. */
function splitByPageMarks(text: string): { page: number | null; md: string }[] {
  const parts = text.split(PAGE_MARK_SPLIT);
  const sections: { page: number | null; md: string }[] = [];
  if (parts[0].trim()) sections.push({ page: null, md: parts[0] });
  for (let i = 1; i < parts.length; i += 2) {
    sections.push({ page: Number(parts[i]), md: parts[i + 1] ?? '' });
  }
  return sections.length > 0 ? sections : [{ page: null, md: text }];
}

// Where you were in each material, per session — reopening finds your place.
const scrollMemory = new Map<string, number>();

/** A material's name as the reader's header and its material switcher show it. */
function materialTitle(n: ThoughtNode): string {
  const d = n.data;
  const pdf = d.attachments?.find((a) => a.type === 'application/pdf');
  if (pdf?.name) return pdf.name;
  if (d.stepKind === 'link') return d.linkTitle || d.linkUrl || '';
  return d.attachments?.[0]?.name || d.question.split('\n')[0].replace(/^#+\s*/, '').slice(0, 48) || '…';
}

/** The nodes the reader can show: files, links, and plain nodes carrying a PDF. */
const isReadable = (n: ThoughtNode): boolean =>
  n.data.stepKind === 'file' || n.data.stepKind === 'link'
  || (!n.data.stepKind && (n.data.attachments ?? []).some((a) => a.type === 'application/pdf'));

export default function MaterialReader({ onLocate }: { onLocate: (id: string) => void }) {
  const readerNodeId = useUiStore((s) => s.readerNodeId);
  const readerAttachmentId = useUiStore((s) => s.readerAttachmentId);
  const conversationTurn = useUiStore(s => s.readerConversationTurn);
  const node = useStore((s) => (readerNodeId ? s.nodes.find((n) => n.id === readerNodeId) : undefined));
  const dock = useReaderDock();
  useEffect(() => {
    // the node can be deleted from the canvas while the reader is open
    if (readerNodeId && !node) useUiStore.getState().setReaderNodeId(null);
  }, [readerNodeId, node]);
  if (!node) return null;
  const bodyOnly = !!conversationTurn || (readerAttachmentId === '' && !!node.data.attachments?.length
    && (node.data.stepKind === 'note' || node.data.stepKind === 'link'));
  const documents = node.data.attachments?.filter(isEditableDocument) ?? [];
  const attachment = bodyOnly ? undefined : node.data.attachments?.find(att => att.id === readerAttachmentId) ?? documents[0];
  return <ReaderOverlay key={JSON.stringify([node.id, attachment?.id, bodyOnly, conversationTurn])} node={node} onLocate={onLocate}
    dock={dock} activeAttachment={attachment} conversationTurn={conversationTurn} bodyOnly={bodyOnly} />;
}

type ExportReaderBody = { extra: string; fileId?: string; fileHtml?: string; imageSrc?: string; original?: boolean; textHtml?: string };
type SelectionGeometry = Pick<NonNullable<ThoughtNode['data']['anchor']>, 'rects' | 'additionalPages'>;

// Keep the first material on its native reading surface. Saved annotations,
// alternate text and additional attachments remain available in the same sheet.
export function CanvasExportReader({ node, body, dock }: { node: ThoughtNode; body: string; dock: ReaderDock }) {
  const att = node.data.attachments?.[0];
  const content: ExportReaderBody = { extra: body };
  if (att && node.data.stepKind === 'file' && body) {
    const template = document.createElement('template');
    template.innerHTML = body;
    const file = template.content.querySelector<HTMLElement>('[data-reading-file="' + CSS.escape(att.id) + '"]');
    if (file) {
      const section = file.closest('.reading-attachment')!;
      const image = att.type.startsWith('image/') ? file.querySelector('img') : null;
      if (image?.getAttribute('src')) {
        content.imageSrc = image.getAttribute('src')!;
        image.remove();
      }
      content.original = !!(content.imageSrc || file.querySelector('[data-notebook], .pdf-sheet, .document-page'));
      content.fileId = att.id;
      content.fileHtml = file.innerHTML;
      file.remove();
      section.querySelector('[data-file-header]')?.remove();
      section.replaceWith(...section.childNodes);
      content.extra = template.innerHTML;
    }
  } else if (body && (node.data.stepKind === 'note' || !node.data.stepKind)) {
    const template = document.createElement('template');
    template.innerHTML = body;
    const primary = template.content.querySelector(node.data.stepKind === 'note' ? '[data-reading-primary]' : '[data-reading-answer]');
    if (primary) {
      primary.classList.add('markdown-body', 'text-body', 'text-ink');
      primary.setAttribute('data-reader-highlight-content', '');
      content.textHtml = primary.outerHTML;
      primary.remove();
      content.extra = template.innerHTML;
    }
  }
  return <ReaderOverlay node={node} onLocate={() => {}} dock={dock} bodyOnly={false}
    activeAttachment={att} conversationTurn={node.data.stepKind ? undefined : 'response'} exportBody={content} />;
}

function ReaderOverlay({ node, onLocate, dock, activeAttachment, conversationTurn, bodyOnly, exportBody }: { node: ThoughtNode; onLocate: (id: string) => void; dock: ReaderDock; activeAttachment?: Attachment; conversationTurn?: 'question' | 'response'; bodyOnly: boolean; exportBody?: ExportReaderBody }) {
  const t = useT();
  const projectId = useProjects(s => s.activeId) ?? 'default';
  const draftPrefix = `reader:${projectId}:${node.id}`;
  const layerRef = useRef<HTMLDivElement>(null);
  const data = node.data;
  const documentAttachment = activeAttachment && isEditableDocument(activeAttachment) ? activeAttachment : undefined;
  const editableAttachment = documentAttachment && isDocxDocument(documentAttachment) ? documentAttachment : undefined;
  const [readDocumentCopy, setReadDocumentCopy] = useState(false);
  const nativeDocx = !readDocumentCopy && editableAttachment && hasNativeDocxSource(editableAttachment) ? editableAttachment : undefined;
  // Three faces, one body (lib/reader-dock decides which): the full-screen
  // overlay; the column docked on the canvas's left, where the canvas and
  // the node panel stay live beside the text; and, when not even the
  // narrowest column fits, a strip that keeps the material's name. Docked,
  // a question asked here still lands on the canvas (the One Rule), but its
  // answer reads right here, in the thread view stacked under the text; the
  // canvas's selection and camera stay where they were.
  const [expandedForJump, setExpandedForJump] = useState(false);
  const docked = dock.docked && !(expandedForJump && dock.collapsed);
  const collapsed = docked && dock.collapsed;
  const [resizing, setResizing] = useState(false);
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    useUiStore.getState().setReaderWidth(Math.min(dock.maxWidth, Math.max(READER_MIN_WIDTH, Math.round(screenToUi(e.clientX)))));
  };
  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizing) return;
    setResizing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    appSettings.setItem('thoughtdag.readerWidth', String(useUiStore.getState().readerWidth));
  };
  const onResizeDoubleClick = () => {
    useUiStore.getState().setReaderWidth(READER_DEFAULT_WIDTH);
    appSettings.removeItem('thoughtdag.readerWidth');
  };
  // the material switcher: every readable node on the canvas, this one marked
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ dismissOnFocusOutside: true, open: pickerOpen, refs: [pickerRef], onDismiss: () => setPickerOpen(false) });
  // Plain thought nodes carrying a PDF read as files too — the reading
  // loop belongs to the material, not to the node kind.
  const kind = conversationTurn ?? (activeAttachment || data.stepKind === 'file' || (!data.stepKind && (data.attachments ?? []).some((a) => a.type === 'application/pdf'))
    ? 'file' : data.stepKind === 'link' ? 'link' : 'note');
  const attachments = useMemo(() => bodyOnly ? [] : activeAttachment ? [activeAttachment] : data.attachments ?? [], [bodyOnly, activeAttachment, data.attachments]);
  const attachmentOptions = conversationTurn ? [] : data.attachments ?? [];
  const scrollKey = JSON.stringify([node.id, activeAttachment?.id, conversationTurn]);
  const pdfAtt = attachments.find((a) => a.type === 'application/pdf');
  // HTML material: original view renders the sanitized page(s), the text
  // view its extracted Markdown — the same dual channel PDFs use
  const htmlAtt = attachments.find((a) => a.type === 'text/html');
  // Notebook: original view draws its cells, outputs and figures; the text
  // view is the converted copy the model reads
  const nbAtt = attachments.find(isNotebook);
  // Link snapshots carry the same dual channel: the page HTML captured at
  // fetch time renders as the original view, `question` (the extracted
  // Markdown) stays the model channel. Reader parity via a pseudo-attachment.
  const linkHtml = kind === 'link' ? data.linkSnapshotHtml : undefined;
  const linkPseudoAtt = useMemo<Attachment | null>(() => (linkHtml ? {
    id: `link-snapshot-${node.id}`,
    name: data.linkTitle || data.linkUrl || 'snapshot',
    type: 'text/html',
    size: linkHtml.length,
    content: linkHtml,
  } : null), [linkHtml, node.id, data.linkTitle, data.linkUrl]);
  // Image material reads as material too: the original view shows the
  // image itself (canvas cards only show it small), the text view its
  // vision companion. Image payloads are never vaulted — content is here.
  const imageAtts = useMemo(() => attachments.filter((a) => a.type.startsWith('image/')), [attachments]);
  const close = () => useUiStore.getState().setReaderNodeId(null);

  // ── the readable copy for the text view ──
  const textSources = useMemo((): { text: string; attachmentId?: string; heading?: string }[] => {
    if (kind === 'response') return [{ text: data.response }];
    if (documentAttachment) return [{ text: documentCopyText(documentAttachment), attachmentId: documentAttachment.id }];
    if (kind === 'file') {
      const textAtts = attachments.filter((a) => !a.type.startsWith('image/') && a.type !== 'application/pdf');
      // an HTML file's or a notebook's readable copy is its extracted text, never the source
      const parts = textAtts.map((a) => {
        const body = a.type === 'text/html' || isNotebook(a) ? (a.extractedText ?? '') : a.content;
        return { text: body ?? '', attachmentId: a.id, heading: textAtts.length > 1 ? a.name : undefined };
      });
      // an image's readable copy is its extraction companion
      for (const a of attachments) {
        if (a.type.startsWith('image/') && a.extractedText?.trim()) parts.push({
          text: a.extractedText, attachmentId: a.id, heading: attachments.length > 1 ? a.name : undefined,
        });
      }
      return parts;
    }
    return [{ text: data.question }];
  }, [documentAttachment, kind, attachments, data.question, data.response]);
  const textBody = useMemo(() => textSources.map(part => part.text).join('\n\n'), [textSources]);
  const stream = useFileEditPreview(projectId, node.id, attachments.length === 1 ? attachments[0].id : '');
  const previewParts = !documentAttachment ? previewTextParts(textBody, stream) : null;
  const sections = useMemo(() => textSources.flatMap(({ text, attachmentId, heading }) => {
    const highlights = attachmentId ? new Set(attachmentHighlights(data, attachmentId).map(mark => mark.text))
      : conversationHighlightTexts(data.highlights, conversationTurn ?? 'response');
    return splitByPageMarks(text).map((section, index) => ({ ...section, attachmentId, highlights,
      heading: index === 0 ? heading : undefined }));
  }), [data, textSources, conversationTurn]);

  // ── PDF document + text-layer probe ──
  const [view, setView] = useState<'original' | 'text' | 'digest'>(documentAttachment
    ? (pdfAtt ? 'original' : 'text')
    : imageAtts.length || htmlAtt || nbAtt || linkHtml ? 'original' : 'text');
  // image view zoom: 1 = fit the column; beyond it the row scrolls sideways
  const [imgZoom, setImgZoom] = useState(1);
  // zoomed past the column, the mouse drags the picture around: horizontal
  // pan on the image row, vertical on the reader body — one grab, both axes
  const imgPanRef = useRef<HTMLDivElement>(null);
  const [imageCanPan, setImageCanPan] = useState(false);
  const [imagePanning, setImagePanning] = useState(false);
  const imagePan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  // the digest works off extractedText, so HTML materials digest the same
  // way PDFs do — docAtt is whichever document this material carries
  const docAtt = documentAttachment ?? htmlAtt;
  const startDigest = async () => {
    if (!docAtt || digestBusy) return;
    setDigestBusy(true);
    setView('digest'); // the digest node streams; watch it arrive in place
    if (isViewerMode) return;
    const ok = await generateDigest(node.id, docAtt.id);
    setDigestBusy(false);
    if (!ok) setView(pdfAtt || htmlAtt ? 'original' : 'text');
  };
  // (p.N) references in the digest jump back into the original pages
  const jumpToPage = (n: number) => {
    setView('original');
    window.setTimeout(() => {
      bodyRef.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };
  // ── selection → ask bar ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ask, setAsk] = useState<{ text: string; page: number | null; x: number; y: number; targetNodeId?: string; geometry?: SelectionGeometry } | null>(null);
  const askPages = ask?.page != null ? formatAnchorPages(ask.page, ask.geometry?.additionalPages) : null;
  const [draft, setDraft] = useSessionDraft(`${draftPrefix}:selection`);
  const askRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open: !!ask, refs: [askRef], onDismiss: () => setAsk(null) });

  const handleMouseUp = (event: React.MouseEvent) => {
    if (isViewerMode || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('[data-superdoc-editor]')) return;
    window.setTimeout(() => {
      const sel = window.getSelection();
      // a plain click (no selection) anywhere in the reading surface
      // dismisses the ask bar — the draft survives for the next selection
      if (!sel || !sel.rangeCount || sel.isCollapsed || !bodyRef.current) { setAsk(null); return; }
      const range = sel.getRangeAt(0);
      if (!bodyRef.current.contains(range.commonAncestorContainer)) return;
      if (materialHighlighter.active) {
        const surface = bodyRef.current.querySelector('[data-reader-highlight-surface]');
        if (!surface?.contains(range.startContainer) || !surface.contains(range.endContainer)) return;
        const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
        const content = start?.closest('[data-reader-highlight-content]');
        // Each extracted page renders independently; a mark must fit one source.
        if (!content || content !== end?.closest('[data-reader-highlight-content]')) return;
        if (materialHighlighter.markSelection(sel, node.id, {
          source: conversationTurn === 'question' ? 'question' : undefined,
          attachmentId: content.getAttribute('data-reading-attachment') ?? undefined,
        })) {
          setAsk(null);
          sel.removeAllRanges();
          return;
        }
      }
      const pdfPages = pdfAtt && view === 'original' && bodyRef.current.querySelector<HTMLElement>('[data-pdf-document] .pdf-document-pages');
      if (pdfPages) {
        const pages = readPdfTextSelection(pdfPages, range);
        const text = pages.map(passage => passage.text).join('\n\n');
        if (!pages.length || text.length < 2) { setAsk(null); return; }
        const [first, ...rest] = pages;
        const additionalPages = rest.map(({ page, rects }) => ({ page, rects }));
        setAsk({ text, page: first.page, x: event.clientX, y: event.clientY,
          geometry: { rects: first.rects, ...(additionalPages.length && { additionalPages }) } });
        return;
      }
      const raw = sel.toString();
      const text = (view === 'original' ? raw.replace(/\s+/g, ' ') : raw).trim();
      if (text.length < 2) return;
      const rect = range.getBoundingClientRect();
      const el = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const pageEl = el?.closest('[data-page]') as HTMLElement | null;
      const page = pageEl?.getAttribute('data-page');
      setAsk({ text, page: page ? Number(page) : null, x: rect.left + rect.width / 2, y: rect.bottom });
    }, 0);
  };

  // ── the annotation rail: answers arrive WHERE you read. It shows one
  // thread (a question node grown from this material plus its linear
  // continuations) — a live view of canvas nodes, never a separate store.
  // A canvas p.N chip can pre-address the landing: open on that thread,
  // scroll to that page (one-shot; consumed here so reopen starts clean).
  const readerJump = useUiStore(s => s.readerJump);
  const [landing, setLanding] = useState<typeof readerJump>(null);
  const [threadId, setThreadId] = useState<string | null>(readerJump?.threadId ?? null);

  const submitAsk = () => {
    const q = draft.trim();
    if (!q || !ask) return;
    // p.N provenance rides inside the quoted passage (document selections only)
    const passage = askPages && !ask.targetNodeId ? `(p.${askPages}) ${ask.text}` : ask.text;
    const prevSelected = useStore.getState().selectedNodeId;
    const question = passage.trim() ? `${passage.split('\n').map(line => `> ${line}`).join('\n')}\n\n${q}` : q;
    useStore.getState().addQuestion(question, { parentId: ask.targetNodeId ?? node.id });
    const freshId = useStore.getState().selectedNodeId;
    // docked, the reader keeps the floor: the canvas's selection (and so the
    // node panel) stay as they were; the answer reads in the thread view below
    if (docked) useStore.getState().setSelectedNodeId(prevSelected);
    // document selections remember the page they came from (both views);
    // original-view ones additionally leave a mark on that page
    if (!ask.targetNodeId && ask.page != null && freshId) {
      const anchor = { page: ask.page, ...ask.geometry, ...(documentAttachment && { attId: documentAttachment.id }) };
      useStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === freshId ? { ...n, data: { ...n.data, anchor } } : n)),
      }));
    }
    setThreadId(freshId); // the freshly landed node
    setDraft('');
    setAsk(null);
    window.getSelection()?.removeAllRanges();
  };

  // Clips land beside the material, scanning DOWN for the first free slot —
  // a fixed modulo grid overlaps as soon as clips outnumber its cells.
  const findClipSpot = (): { x: number; y: number } => {
    const st = useStore.getState();
    const base = st.nodes.find((n) => n.id === node.id);
    if (!base) return { x: 120, y: 120 };
    const W = 440, H = 280, x = base.position.x + 460;
    const boxes = st.nodes.map((n) => ({
      x: n.position.x, y: n.position.y,
      w: (n.width as number) || 460, h: (n.height as number) || 280,
    }));
    let y = base.position.y;
    for (let i = 0; i < 60; i++) {
      const free = !boxes.some((b) => x < b.x + b.w && b.x < x + W && y < b.y + b.h && b.y < y + H);
      if (free) return { x, y };
      y += 90;
    }
    return { x, y };
  };

  // A short "the selection flies onto the canvas" ghost: makes it legible
  // that the clip became a node behind the reader. Skipped under
  // prefers-reduced-motion.
  const flyToCanvas = (from: { left: number; top: number; width: number; height: number }) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ghost = document.createElement('div');
    ghost.style.cssText = `position:fixed;left:${screenToUi(from.left)}px;top:${screenToUi(from.top)}px;width:${Math.max(60, screenToUi(from.width))}px;height:${Math.max(28, screenToUi(from.height))}px;border:2px solid var(--color-warm);background:color-mix(in srgb, var(--color-warm) 12%, white);border-radius:var(--radius-control);z-index:200;pointer-events:none;`;
    document.body.appendChild(ghost);
    const dx = screenToUi(window.innerWidth * 0.82 - from.left), dy = screenToUi(window.innerHeight * 0.85 - from.top);
    ghost.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 0.95 },
        { transform: `translate(${dx}px,${dy}px) scale(0.12)`, opacity: 0 },
      ],
      { duration: 460, easing: 'cubic-bezier(.45,0,.65,1)' },
    ).onfinish = () => ghost.remove();
  };

  // ── selection → an edge-less note node (clip): the passage becomes its
  // own material on the canvas, provenance rides anchor.attId instead of a
  // wire — wiring the note to the document would drag the WHOLE document
  // back into any context the note joins, defeating the point of clipping.
  const saveSelectionAsNote = () => {
    if (!ask || ask.targetNodeId) return;
    flyToCanvas({ left: ask.x - uiToScreen(90), top: ask.y - uiToScreen(40), width: uiToScreen(180), height: uiToScreen(36) });
    const freshId = spawnContentNode('note', findClipSpot(), { question: ask.text });
    const srcAttId = pdfAtt?.id ?? attachments?.[0]?.id;
    if (ask.page != null || srcAttId) {
      const anchor = {
        page: ask.page ?? 1,
        ...ask.geometry,
        ...(srcAttId ? { attId: srcAttId } : {}),
      };
      useStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === freshId ? { ...n, data: { ...n.data, anchor } } : n)),
      }));
    }
    toast('success', t('reader.clippedNote'));
    setAsk(null);
    window.getSelection()?.removeAllRanges();
  };

  // ── area capture → an edge-less image node: the figure becomes its own
  // material, cropped straight from the rendered page canvas. Provenance
  // rides anchor.attId, the same as clipped notes; wire it into a question
  // and the image flows to a vision model.
  const [clipMode, setClipMode] = useState(false);
  const updateImagePanAvailability = useCallback(() => {
    const scroller = imgPanRef.current, body = bodyRef.current;
    setImageCanPan(!!scroller && !!body && (scroller.scrollWidth > scroller.clientWidth + 1 || body.scrollHeight > body.clientHeight + 1));
  }, []);
  useEffect(() => {
    const scroller = imgPanRef.current, body = bodyRef.current;
    if (!scroller || !body) return;
    // Both viewport and intrinsic image sizes can change after rendering.
    const observer = new ResizeObserver(updateImagePanAvailability);
    observer.observe(scroller);
    observer.observe(body);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener('load', updateImagePanAvailability, true);
    return () => {
      observer.disconnect();
      scroller.removeEventListener('load', updateImagePanAvailability, true);
      imagePan.current = null;
      setImagePanning(false);
    };
  }, [view, collapsed, docked, imageAtts, updateImagePanAvailability]);
  const startImagePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (clipMode || event.button !== 0) return;
    const scroller = imgPanRef.current, body = bodyRef.current;
    if (!scroller || !body || (scroller.scrollWidth <= scroller.clientWidth + 1 && body.scrollHeight <= body.clientHeight + 1)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    imagePan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: body.scrollTop };
    setImagePanning(false);
  };
  const moveImagePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = imagePan.current, scroller = imgPanRef.current, body = bodyRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !scroller || !body) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    setImagePanning(true);
    scroller.scrollLeft = drag.left - screenToUi(event.clientX - drag.x);
    body.scrollTop = drag.top - screenToUi(event.clientY - drag.y);
  };
  const finishImagePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== imagePan.current?.pointerId) return;
    imagePan.current = null;
    setImagePanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleClipped = (pageNo: number, rect: [number, number, number, number], dataUrl: string, screenRect?: { left: number; top: number; width: number; height: number }) => {
    const base64 = dataUrl.split(',')[1] ?? '';
    if (!base64) return;
    if (screenRect) flyToCanvas(screenRect);
    const freshId = spawnContentNode('file', findClipSpot());
    const attId = generateId();
    const img = new Image();
    img.onload = () => {
      const cap = 320;
      const scale = Math.min(1, cap / img.width);
      const tc = document.createElement('canvas');
      tc.width = Math.max(1, Math.round(img.width * scale));
      tc.height = Math.max(1, Math.round(img.height * scale));
      tc.getContext('2d')!.drawImage(img, 0, 0, tc.width, tc.height);
      const thumb = tc.toDataURL('image/jpeg', 0.8);
      useStore.getState().addAttachment(freshId, {
        id: attId,
        name: `clip-p${pageNo}.png`,
        type: 'image/png',
        size: Math.round(base64.length * 0.75),
        addedAt: new Date().toISOString(),
        content: base64,
        thumbnailUrl: thumb,
      });
      // link snapshots aren't attachments — their clips point at the link node
      const anchor = { page: pageNo, rects: [rect], ...(docAtt ? { attId: docAtt.id } : kind === 'link' ? { attId: node.id } : {}) };
      useStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === freshId ? { ...n, data: { ...n.data, anchor } } : n)),
      }));
      // auto-read once (when a vision model exists): the companion text makes
      // the clip legible to text-only models too. The toast names the call
      // BEFORE it happens — no silent API spend from a drag.
      if (hasVisionModel) {
        toast('success', t('reader.clippedImageReading'));
        void extractImage(freshId, attId);
      } else {
        toast('success', t('reader.clippedImage'));
      }
    };
    img.src = dataUrl;
    setClipMode(false);
  };

  // area capture on an IMAGE material: crop from the original resolution,
  // same provenance grammar (anchor.attId), page is meaningless here.
  const handleImageClipped = (srcAtt: Attachment, rect: [number, number, number, number], dataUrl: string, screenRect?: { left: number; top: number; width: number; height: number }) => {
    const base64 = dataUrl.split(',')[1] ?? '';
    if (!base64) return;
    if (screenRect) flyToCanvas(screenRect);
    const freshId = spawnContentNode('file', findClipSpot());
    const attId = generateId();
    const img = new Image();
    img.onload = () => {
      const cap = 320;
      const scale = Math.min(1, cap / img.width);
      const tc = document.createElement('canvas');
      tc.width = Math.max(1, Math.round(img.width * scale));
      tc.height = Math.max(1, Math.round(img.height * scale));
      tc.getContext('2d')!.drawImage(img, 0, 0, tc.width, tc.height);
      const thumb = tc.toDataURL('image/jpeg', 0.8);
      useStore.getState().addAttachment(freshId, {
        id: attId,
        name: `clip-${srcAtt.name.replace(/\.\w+$/, '')}.png`,
        type: 'image/png',
        size: Math.round(base64.length * 0.75),
        addedAt: new Date().toISOString(),
        content: base64,
        thumbnailUrl: thumb,
      });
      const anchor = { page: 1, rects: [rect], attId: srcAtt.id };
      useStore.setState((st) => ({
        nodes: st.nodes.map((n) => (n.id === freshId ? { ...n, data: { ...n.data, anchor } } : n)),
      }));
      if (hasVisionModel) {
        toast('success', t('reader.clippedImageReading'));
        void extractImage(freshId, attId);
      } else {
        toast('success', t('reader.clippedImage'));
      }
    };
    img.src = dataUrl;
    setClipMode(false);
  };

  // The pen reads either side of a turn. Passage questions branch from answers.
  const handleRailMouseUp = (event: React.MouseEvent) => {
    if (isViewerMode || event.button !== 0) return;
    if (railHighlighter.active) {
      const turn = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reader-turn]') : null;
      if (turn?.dataset.readerTurn) railHighlighter.markConversationSelection(event, turn.dataset.readerTurn);
      return;
    }
    window.setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed || !railRef.current) { setAsk((a) => (a?.targetNodeId ? null : a)); return; }
      const range = sel.getRangeAt(0);
      if (!railRef.current.contains(range.commonAncestorContainer)) return;
      const el = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const wrap = el?.closest('[data-turn-answer]');
      if (!wrap || !wrap.contains(range.endContainer)) return;
      const targetNodeId = wrap.getAttribute('data-turn-answer');
      if (!targetNodeId) return;
      const text = sel.toString().trim();
      if (text.length < 2) return;
      const rect = range.getBoundingClientRect();
      setAsk({ text, page: null, x: rect.left + rect.width / 2, y: rect.bottom, targetNodeId });
    }, 0);
  };

  // whole-material question: no passage, the full text flows along the wire.
  // Selection is the hero gesture; this keeps "the whole thing" one step away.
  const [wholeDraft, setWholeDraft] = useSessionDraft(`${draftPrefix}:whole`);
  const submitWhole = () => {
    const q = wholeDraft.trim();
    if (!q) return;
    const prevSelected = useStore.getState().selectedNodeId;
    useStore.getState().addQuestion(q, { parentId: node.id });
    const freshId = useStore.getState().selectedNodeId;
    if (docked) useStore.getState().setSelectedNodeId(prevSelected);
    setThreadId(freshId);
    setWholeDraft('');
  };

  // ── recognize (per-page vision rewrite) ──
  const hasVisionModel = (useModels()?.models ?? []).some((m) => m.vision);
  const [recog, setRecog] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const cancelRef = useRef(false);
  const pagesToRecognize = recognitionPageCount(pdfAtt);
  const startRecognize = async () => {
    if (!pdfAtt || !pagesToRecognize || isViewerMode) return;
    setRecog('running');
    cancelRef.current = false;
    try {
      await recognizePdfPages(node.id, pdfAtt.id, (a, b) => setProgress([a, b]), () => cancelRef.current);
    } catch {
      toast('error', t('content.extractFailed'));
    } finally {
      setRecog('idle');
      setProgress(null);
    }
  };

  const canMarkBody = !documentAttachment && view === 'text' && !!textBody.trim()
    && (!conversationTurn || canHighlightConversation(data));
  const materialHighlighter = useTextHighlighter({
    scopeKey: `reader:${node.id}:${view}:${textBody}`,
    enabled: canMarkBody && !collapsed,
    surfaceRef: bodyRef,
  });

  // ── questions grown from this material ──
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const children = useMemo(() => {
    const ids = edges.filter((e) => e.source === node.id && !e.data?.isCrossLink).map((e) => e.target);
    return nodes.filter((n) => ids.includes(n.id));
  }, [edges, nodes, node.id]);

  // the guided digest lives on the canvas as a child node (One Rule: wire
  // it downstream to ride the material's compression); the digest tab is
  // that node's reading view. Legacy graphs may still carry a digest on
  // the attachment itself — shown until a node replaces it.
  const digestNode = docAtt ? children.find((c) => c.data.digestOf === docAtt.id) : undefined;
  const digestText = digestNode?.data.response?.trim() || docAtt?.digest || '';
  const digesting = digestBusy || !!digestNode?.data.isLoading;
  const digestModel = digestNode
    ? digestNode.data.generatedBy?.[digestNode.data.responseIndex]
    : docAtt?.digestBy;
  // the digest node has its own tab; the footer chips list the questions
  const grownChildren = useMemo(() => children.filter((c) => !c.data.digestOf), [children]);
  // every material on the canvas, for the header's switcher (docked, the
  // reader stays up across materials; the switcher is how you move between them)
  const materials = useMemo(() => nodes.filter(isReadable), [nodes]);

  // interacted places wear marks on the original pages: every child of this
  // material that carries an anchor, grouped by page
  const anchorsByPage = useMemo(() => {
    const map = new Map<number, { id: string; question: string; rects: [number, number, number, number][] }[]>();
    const attIds = new Set((attachments ?? []).map((a) => a.id));
    // children carry anchors via their edge; edge-less clips (notes/images
    // extracted from this document) carry them via anchor.attId instead
    const childIds = new Set(children.map((c) => c.id));
    const anchored = [
      ...children,
      ...nodes.filter((n) => !childIds.has(n.id) && n.data.anchor?.attId && attIds.has(n.data.anchor.attId)),
    ];
    for (const c of anchored) {
      const a = c.data.anchor;
      if (!a?.rects?.length) continue;
      if (documentAttachment && (a.attId ? a.attId !== documentAttachment.id
        : documentAttachment.id !== data.attachments?.find(isEditableDocument)?.id)) continue;
      for (const { page, rects } of [{ page: a.page, rects: a.rects }, ...(a.additionalPages ?? [])]) {
        const list = map.get(page) ?? [];
        list.push({ id: c.id, question: c.data.question, rects });
        map.set(page, list);
      }
    }
    return map;
  }, [children, nodes, attachments, documentAttachment, data.attachments]);

  // the rail's thread: the asked node plus its linear structural
  // continuations (follow-ups append here; forks belong to the canvas)
  const thread = useMemo(() => {
    if (!threadId) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const chain: ThoughtNode[] = [];
    let cur = byId.get(threadId);
    while (cur) {
      chain.push(cur);
      const kids = edges
        .filter((e) => e.source === cur!.id && !e.data?.isCrossLink)
        .map((e) => byId.get(e.target))
        .filter((n): n is ThoughtNode => !!n);
      cur = kids.length === 1 ? kids[0] : undefined;
    }
    return chain;
  }, [threadId, nodes, edges]);
  useEffect(() => {
    // the thread's node can be deleted from the canvas while the rail shows it
    if (threadId && thread.length === 0) setThreadId(null);
  }, [threadId, thread.length]);

  const [followDraft, setFollowDraft] = useSessionDraft(`${draftPrefix}:follow:${threadId ?? ''}`);
  const submitFollow = () => {
    const q = followDraft.trim();
    const last = thread[thread.length - 1];
    if (!q || !last) return;
    const prevSelected = useStore.getState().selectedNodeId;
    useStore.getState().addQuestion(q, { parentId: last.id });
    if (docked) useStore.getState().setSelectedNodeId(prevSelected);
    setFollowDraft('');
  };

  // stream follows the reading eye: keep the rail pinned to the newest text
  const railRef = useRef<HTMLDivElement>(null);
  const railCanHighlight = thread.some(turn => canHighlightConversation(turn.data));
  const railHighlighter = useTextHighlighter({
    scopeKey: JSON.stringify(thread.map(({ id, data }) => [id, data.responseIndex, data.question, data.response, canHighlightConversation(data)])),
    enabled: !collapsed && railCanHighlight,
    surfaceRef: railRef,
  });
  const lastTurn = thread[thread.length - 1];
  useEffect(() => {
    const el = railRef.current;
    if (!lastTurn?.data.isLoading || !el) return;
    // follow the stream only while the reader is near the bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastTurn?.data.response, lastTurn?.data.isLoading]);

  // per-material scroll memory (session): reopening finds your place.
  // Recorded live on scroll (at unmount the DOM is already detached and
  // reads 0); restored once the document has grown tall enough to hold it.
  const scrollRestored = useRef(false);

  // Take each request once, whether the reader just opened or is already docked.
  useEffect(() => {
    if (!readerJump || readerJump !== useUiStore.getState().readerJump) return;
    useUiStore.setState({ readerJump: null });
    if (readerJump.threadId) setThreadId(readerJump.threadId);
    if (!readerJump.page && !readerJump.rulerMark) return;
    scrollRestored.current = true;
    const mark = readerJump.rulerMark;
    if (mark) {
      if (dock.collapsed) setExpandedForJump(true);
      // Legacy text highlights may refer to the extracted copy of a native file.
      setReadDocumentCopy(!!editableAttachment && !mark.documentMarkId);
      setView(mark.page ? 'original' : 'text');
    } else if (pdfAtt) setView('original');
    setLanding(mark ? { ...readerJump, rulerMark: { ...mark } } : readerJump);
  }, [readerJump, pdfAtt, editableAttachment, dock.collapsed]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!landing || !body) return;
    const mark = landing.rulerMark;
    if (nativeDocx && mark?.documentMarkId) return; // the native viewport owns its scrolling
    const attempt = () => {
      let target: Range | Element | null;
      if (!mark) {
        target = body.querySelector(`[data-page="${landing.page}"]`);
      } else if (mark.page && mark.documentMarkId) {
        if (!revealMountedPdfHighlight(body, mark)) return false;
        setLanding(null);
        return true;
      } else {
        const rich = body.querySelector<HTMLElement>('[data-document-rich-body]');
        const saved = editableAttachment?.documentHighlights?.find(item => item.id === mark.documentMarkId);
        target = rich && saved ? findRichHighlightRange(rich, saved)
          : findHighlightedPassage(body.querySelectorAll<HTMLElement>('[data-reader-highlight-content], [data-document-rich-body]'), mark.text, mark.occurrence);
      }
      if (!target) return false;
      if (mark) revealHighlight(body, target, !!mark.documentMarkId);
      else if (target instanceof Element) target.scrollIntoView({ block: 'start' });
      setLanding(null);
      return true;
    };
    if (attempt()) return;
    // Lazy PDF pages and rich document bodies arrive after the reader's shell.
    const observer = new MutationObserver(() => { if (attempt()) observer.disconnect(); });
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pdf-sized', 'style'] });
    return () => observer.disconnect();
  }, [landing, nativeDocx, editableAttachment, view, collapsed]);

  useEffect(() => {
    const el = bodyRef.current;
    const saved = scrollMemory.get(scrollKey);
    if (!el || !saved || scrollRestored.current) return;
    let tries = 0;
    const attempt = () => {
      if (scrollRestored.current) return;
      if (el.scrollHeight - el.clientHeight >= saved) {
        el.scrollTop = saved;
        scrollRestored.current = true;
        return;
      }
      if (++tries < 25) window.setTimeout(attempt, 100);
    };
    window.setTimeout(attempt, 100);
  }, [scrollKey, view]);

  // Docked reading is a workspace: canvas clicks keep it open. Child
  // editors and selection popups own their own Escape before this layer.
  useDismissableLayer({
    open: !docked || !!threadId, refs: [layerRef], dismissOnOutside: false, modal: !docked,
    onDismiss: () => { if (threadId) setThreadId(null); else close(); },
  });

  const title = (conversationTurn ? data.displayName || data.question.split('\n')[0] || t(conversationTurn === 'question' ? 'panel.question' : 'panel.response') : undefined) ?? activeAttachment?.name
    ?? (kind === 'link' ? (data.linkTitle || data.linkUrl || '') : '')
    ?? '';
  const noteTitle = kind === 'note' ? (data.question.split('\n')[0].replace(/^#+\s*/, '').slice(0, 48) || t('reader.empty')) : '';
  const headerIcon = kind === 'note'
    ? <StickyNote size={15} strokeWidth={1.75} className="text-amber-600 shrink-0" />
    : kind === 'link'
      ? <Link2 size={15} strokeWidth={1.75} className="text-accent shrink-0" />
      : <FileText size={15} strokeWidth={1.75} className="text-ink-muted shrink-0" />;
  const fileFallbackTitle = kind === 'file' && !pdfAtt ? (attachments[0]?.name ?? '') : '';
  const numPages = pdfAtt?.numPages ?? htmlAtt?.numPages;

  const askLeft = ask ? Math.max(180, Math.min(screenToUi(ask.x), uiViewport().width - 200)) : 0;
  const askTop = ask ? Math.min(screenToUi(ask.y) + 10, uiViewport().height - 150) : 0;

  const shownTitle = title || noteTitle || fileFallbackTitle;
  const iconButton = 'w-7 h-7 rounded-control text-ink-faint hover:bg-wash hover:text-ink flex items-center justify-center transition-colors shrink-0';

  const imagePane = view === 'original' && !pdfAtt && !htmlAtt && imageAtts.length > 0 && (
    <div className="relative">
      {/* h-0 keeps the bar out of the layout flow; items-start stops
          flex from stretching the toolbar into that zero height */}
      <div className="sticky top-3 z-10 flex items-start justify-end pr-4 h-0">
        <div className="flex items-center gap-1 bg-card border border-line rounded-overlay px-1.5 py-1" data-image-zoom>
          <button onClick={() => setImgZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label={t('reader.imageZoomOut')} data-zoom-out
            className="w-7 h-7 rounded-control hover:bg-wash flex items-center justify-center text-ink-muted hover:text-ink transition-colors"><ZoomOut size={14} strokeWidth={1.75} /></button>
          <button onClick={() => setImgZoom(1)} data-tooltip={t('reader.imageZoomFit')} data-zoom-fit
            className="px-2 h-7 rounded-control hover:bg-wash font-mono text-control text-ink-muted hover:text-ink transition-colors min-w-[52px]">{Math.round(imgZoom * 100)}%</button>
          <button onClick={() => setImgZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label={t('reader.imageZoomIn')} data-zoom-in
            className="w-7 h-7 rounded-control hover:bg-wash flex items-center justify-center text-ink-muted hover:text-ink transition-colors"><ZoomIn size={14} strokeWidth={1.75} /></button>
        </div>
      </div>
      <div
        ref={imgPanRef}
        onPointerDown={startImagePan}
        onPointerMove={moveImagePan}
        onPointerUp={finishImagePan}
        onPointerCancel={finishImagePan}
        onLostPointerCapture={finishImagePan}
        data-cursor={!clipMode && imageCanPan ? imagePanning ? 'dragging' : 'draggable' : 'neutral'} className="overflow-x-auto"
        style={{ touchAction: !clipMode && imageCanPan ? 'none' : undefined }}
        data-image-pan
      >
        {/* w-max + mx-auto instead of items-center: a centered flex
            child that overflows spills PAST scrollLeft 0 — its left
            half becomes unreachable. Auto margins center when there
            is room and pin to 0 when there is not. */}
        <div className="flex flex-col gap-6 py-6 px-6 w-max min-w-full">
          {imageAtts.map((att) => (
            <div key={att.id} className="mx-auto">
              <ImageFigure att={att} source={exportBody?.imageSrc} zoom={imgZoom} clipMode={clipMode} onClipped={handleImageClipped} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // the three faces share this body: header, reading column (+ rail), footer
  const inner = (
    <>
        {/* header */}
        <div className="flex items-center gap-3 flex-wrap px-5 py-3 border-b border-line bg-card shrink-0">
          {headerIcon}
          {!conversationTurn && materials.length > 1 ? (
            <div ref={pickerRef} className="relative min-w-0" data-reader-material-picker>
              <button data-export-reading-label
                onClick={() => setPickerOpen((v) => !v)}
                aria-label={t('reader.switchMaterial')}
                className="flex items-center gap-1 text-title font-semibold text-ink min-w-0 max-w-full hover:text-accent transition-colors"
              >
                <span className="truncate">{shownTitle}</span>
                <ChevronDown size={13} strokeWidth={1.75} className="shrink-0 text-ink-faint" />
              </button>
              {pickerOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-line rounded-overlay shadow-lg py-1 min-w-[240px] max-w-[420px] max-h-[calc(50*var(--ui-vh))] overflow-y-auto">
                  {materials.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setPickerOpen(false); if (m.id !== node.id) useUiStore.getState().setReaderNodeId(m.id); }}
                      className={`w-full text-left px-3 py-1.5 text-control truncate transition-colors ${m.id === node.id ? 'text-accent bg-accent/10' : 'text-ink hover:bg-wash'}`}
                    >
                      {materialTitle(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-title font-semibold text-ink truncate min-w-0" data-tooltip={shownTitle} data-tooltip-overflow>{shownTitle}</span>
          )}
          {numPages != null && <span className="text-meta text-ink-faint font-mono shrink-0">{numPages}p</span>}
          {attachmentOptions.length > 1 && <select aria-label={t('document.selectAttachment')} data-reader-attachment-select
            value={activeAttachment?.id ?? ''}
            onChange={event => useUiStore.getState().setReaderNodeId(node.id, { attachmentId: event.target.value })}
            className="min-w-0 max-w-full text-control bg-card text-ink border border-line rounded-control px-2 py-1.5">
            {!activeAttachment && <option value="">{t('document.allAttachments')}</option>}
            {attachmentOptions.map(att => <option key={att.id} value={att.id}>{att.name}</option>)}
          </select>}
          <div className="flex-1" />
          {(documentAttachment || imageAtts.length > 0 || htmlAtt || nbAtt || linkHtml) && (
            <div className="flex items-center rounded-control border border-line overflow-hidden shrink-0 text-control">
              {(!documentAttachment || !!pdfAtt) && <button
                onClick={() => { setLanding(null); setView('original'); }}
                aria-pressed={view === 'original'}
                className={`px-3 py-1.5 transition-colors ${view === 'original' ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'}`}
              >
                {t('reader.viewOriginal')}
              </button>}
              <button
                onClick={() => { setLanding(null); setReadDocumentCopy(false); setView('text'); }}
                aria-pressed={view === 'text'}
                className={`px-3 py-1.5 transition-colors ${!documentAttachment || pdfAtt ? 'border-l border-line' : ''} ${view === 'text' ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'}`}
              >
                {documentAttachment ? t('document.body') : t('reader.viewText')}
              </button>
              {(digestText || digesting) && (
                <button
                  onClick={() => { setLanding(null); setView('digest'); }}
                  aria-pressed={view === 'digest'}
                  className={`px-3 py-1.5 transition-colors border-l border-line ${view === 'digest' ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'}`}
                >
                  {t('reader.viewDigest')}
                </button>
              )}
            </div>
          )}
          {!isViewerMode && canMarkBody && (
            <HighlighterButton
              active={materialHighlighter.active}
              buttonRef={materialHighlighter.buttonRef}
              onClick={() => {
                if (!materialHighlighter.active && railHighlighter.active) railHighlighter.toggle();
                setAsk(null);
                materialHighlighter.toggle();
              }}
              className="w-7 h-7 shrink-0"
            />
          )}
          {(pdfAtt || imageAtts.length > 0 || htmlAtt || linkHtml) && view === 'original' && !isViewerMode && (
            <button
              onClick={() => setClipMode((v) => !v)}

              data-reader-clip-toggle
              className={`flex items-center gap-1.5 text-control px-3 py-1.5 rounded-control border transition-colors shrink-0 ${clipMode ? 'border-warm bg-warm/10 text-warm font-medium' : 'border-line text-ink-muted hover:bg-wash'}`}
            >
              <Crosshair size={13} strokeWidth={1.75} />
              {clipMode ? t('reader.clipActive') : t('reader.clip')}
            </button>
          )}
          {!pdfAtt && imageAtts.length > 0 && !isViewerMode && (
            <button
              onClick={() => { if (hasVisionModel) imageAtts.forEach((a) => void extractImage(node.id, a.id)); }}
              disabled={!hasVisionModel || imageAtts.some((a) => a.isExtracting)}

              data-image-recognize
              className="flex items-center gap-1.5 text-control px-3 py-1.5 rounded-control border border-line text-ink-muted hover:bg-wash transition-colors shrink-0 disabled:opacity-40"
            >
              {imageAtts.some((a) => a.isExtracting)
                ? <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                : <ScanText size={13} strokeWidth={1.75} />}
              {t(imageAtts.every((a) => a.extractedText?.trim()) ? 'reader.imageReRecognize' : 'reader.imageRecognize')}
            </button>
          )}
          {docAtt && !digestText && !digesting && !!textBody.trim() && !isViewerMode && (
            <button
              data-export-omit="run" onClick={() => void startDigest()}

              className="flex items-center gap-1.5 text-control px-3 py-1.5 rounded-control border border-line text-ink-muted hover:bg-wash transition-colors shrink-0"
            >
              <Sparkles size={13} strokeWidth={1.75} />
              {t('reader.digest')}
            </button>
          )}
          {pdfAtt && view === 'text' && !isViewerMode && (
            recog === 'running' ? (
              <span className="flex items-center gap-2 text-control text-accent shrink-0">
                <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                {progress ? fmt(t('reader.recognizing'), { a: progress[0], b: progress[1] }) : '…'}
                <button data-export-omit="run" onClick={() => { cancelRef.current = true; }} className="text-ink-muted hover:text-red-500 underline decoration-dotted">
                  {t('reader.stop')}
                </button>
              </span>
            ) : (
              <button
                data-export-omit="run" onClick={() => (recog === 'confirm' ? void startRecognize() : setRecog('confirm'))}
                onBlur={() => setRecog((r) => (r === 'confirm' ? 'idle' : r))}
                disabled={!pagesToRecognize || !hasVisionModel}

                className={`flex items-center gap-1.5 text-control px-3 py-1.5 rounded-control border transition-colors shrink-0 disabled:opacity-40 when-unavailable ${
                  recog === 'confirm' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-line text-ink-muted hover:bg-wash'
                }`}
              >
                <ScanText size={13} strokeWidth={1.75} />
                {recog === 'confirm' ? fmt(t('reader.recognizeConfirm'), { n: pagesToRecognize }) : t('reader.recognize')}
              </button>
            )
          )}
          {documentAttachment && <DocumentOriginalButton attachment={documentAttachment} />}
          {/* dock beside the canvas, or expand to the overlay */}
          {docked ? (
            <button onClick={() => useUiStore.getState().setReaderMode('full')} aria-label={t('reader.expand')} data-reader-expand className={iconButton}>
              <Maximize2 size={14} strokeWidth={1.75} />
            </button>
          ) : uiViewport().width >= DOCK_MIN_WINDOW && (
            <button onClick={() => { setExpandedForJump(false); useUiStore.getState().setReaderMode('dock'); }} data-tooltip={t('reader.dock')} aria-label={t('reader.dock')} data-reader-dock className={iconButton}>
              <PanelLeft size={14} strokeWidth={1.75} />
            </button>
          )}
          <button onClick={close} data-material-reader-close aria-label={t('panel.close')} className={iconButton}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* body: document column + (optional) thread view — beside the text
            in the overlay, stacked under it in the docked column */}
        <div className={`flex-1 min-h-0 flex ${docked ? 'flex-col' : ''}`}>
        <div ref={bodyRef} data-cursor={view === 'original' && pdfAtt ? 'neutral' : 'native'} onMouseUp={handleMouseUp} onScroll={(e) => scrollMemory.set(scrollKey, e.currentTarget.scrollTop)}
          className={`flex-1 min-w-0 min-h-0 overscroll-contain bg-wash/60 ${exportBody === undefined && nativeDocx && view === 'text' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`} data-reader-body>
          {nativeDocx && view === 'text' && <div data-docx-reader-toolbar className="shrink-0" />}
          {exportBody !== undefined ? <div data-export-reading-body>
            {exportBody.textHtml && <div className="max-w-[820px] mx-auto px-surface-inset py-6" data-reader-highlight-surface>
              <div dangerouslySetInnerHTML={{ __html: exportBody.textHtml }} />
            </div>}
            {exportBody.fileId && <div data-reading-file={exportBody.fileId}>
              {exportBody.imageSrc && imagePane}
              {exportBody.fileHtml && <div className={exportBody.original && !exportBody.imageSrc ? undefined : 'max-w-[820px] mx-auto px-surface-inset py-6 markdown-body text-body text-ink'}
                dangerouslySetInnerHTML={{ __html: exportBody.fileHtml }} />}
            </div>}
            {exportBody.extra && <div className="max-w-[820px] mx-auto px-surface-inset py-6 markdown-body text-body text-ink" dangerouslySetInnerHTML={{ __html: exportBody.extra }} />}
          </div> : <>
          {view === 'original' && pdfAtt && (
            <Suspense fallback={<p className="p-4 text-control text-ink-faint">{t('reader.loading')}</p>}>
              <PdfDocumentView nodeId={node.id} attachment={pdfAtt} anchorsByPage={anchorsByPage}
                activeThreadId={threadId} onAnchorClick={setThreadId} clipMode={clipMode} onClipped={handleClipped} />
            </Suspense>
          )}

          {view === 'original' && !pdfAtt && htmlAtt && (
            <HtmlMaterialView key={htmlAtt.id} att={htmlAtt} onSelect={(s) => setAsk(s ? { ...s } : null)} clipMode={clipMode} onClipped={handleClipped} />
          )}

          {view === 'original' && !pdfAtt && !htmlAtt && nbAtt && (
            <NotebookView key={nbAtt.id} att={nbAtt} />
          )}

          {view === 'original' && !pdfAtt && !htmlAtt && linkPseudoAtt && (
            <HtmlMaterialView key={linkPseudoAtt.id} att={linkPseudoAtt} baseUrl={data.linkUrl} onSelect={(s) => setAsk(s ? { ...s } : null)} clipMode={clipMode} onClipped={handleClipped} />
          )}

          {imagePane}

          {view === 'digest' && docAtt && (
            <div className="max-w-[760px] mx-auto px-8 py-8">
              {digestText ? (
                <div className="markdown-body text-body text-ink">
                  <DigestBody text={digestText} onJump={jumpToPage} />
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 py-16 text-control text-ink-muted">
                  <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-accent" /> {t('reader.digesting')}
                </div>
              )}
              {digestText && !digesting && (
                <div className="mt-6 pt-4 border-t border-line flex items-center gap-3 text-control text-ink-faint">
                  <span className="font-mono">{digestModel ? digestModel.split('/').pop() : ''}</span>
                  <button data-export-omit="run" onClick={() => void startDigest()} className="flex items-center gap-1 hover:text-ink-muted transition-colors">
                    <RefreshCw size={11} strokeWidth={1.75} /> {t('reader.redigest')}
                  </button>
                  {digestNode && (
                    <button onClick={() => { if (!docked) close(); onLocate(digestNode.id); }} className="flex items-center gap-1 hover:text-accent transition-colors">
                      <Crosshair size={11} strokeWidth={1.75} /> {t('reader.digestOnCanvas')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {view === 'text' && (
            <div className={nativeDocx ? 'flex-1 min-h-0 flex flex-col p-surface-inset' : 'max-w-[820px] mx-auto px-surface-inset py-6'} data-reader-highlight-surface data-highlighter-active={materialHighlighter.active || undefined}>
              {editableAttachment && !nativeDocx && !readDocumentCopy && !isViewerMode && <p className="text-control text-ink-faint mb-4">
                {t('document.legacySource')}
              </p>}
              {editableAttachment && !readDocumentCopy ? (
                nativeDocx
                  ? <Suspense fallback={<p className="text-control text-ink-faint">{t('richDocument.loading')}</p>}>
                    <SuperDocEditor nodeId={node.id} attachment={nativeDocx} readOnly={isViewerMode} rulerMark={landing?.rulerMark} />
                    </Suspense>
                  : <DocumentRichBody attachment={editableAttachment} />
              ) : previewParts ? <StreamingFileText parts={previewParts} /> : !textBody.trim() && !sections.some(section => section.heading) ? (
                htmlAtt?.isExtracting ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-control text-ink-muted">
                    <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-accent" /> {t('reader.loading')}
                  </div>
                ) : (
                  <p className="text-control text-ink-faint italic py-10 text-center px-8">
                    {htmlAtt ? t('reader.htmlNoText') : t('reader.empty')}
                  </p>
                )
              ) : (
                sections.map((s, i) => (
                  <div key={i} data-page={s.page ?? undefined}>
                    {s.heading && <div className="markdown-body text-body text-ink"><h3>{s.heading}</h3></div>}
                    {s.page != null && !documentAttachment && (
                      <div className="text-meta text-ink-faint font-mono text-center select-none pt-4 pb-1">— p.{s.page} —</div>
                    )}
                    <div className="markdown-body text-body text-ink" data-reader-highlight-content data-reading-attachment={s.attachmentId}>
                      <Markdown highlights={s.highlights} preserveListNumbers={conversationTurn === 'question'}>{s.md}</Markdown>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          </>}
        </div>

        {/* thread view: the thread lives on the canvas; this is its reading
            view — quote, streaming answer, follow-up. A rail beside the text
            in the overlay; docked, a band under the text (the column has
            no width to spare, and the answer belongs where you read). */}
        {threadId && thread.length > 0 && (
          <div className={docked ? 'w-full h-[42%] shrink-0 border-t border-line bg-card flex flex-col min-h-0' : 'w-[420px] shrink-0 border-l border-line bg-card flex flex-col min-h-0'} data-reader-rail data-reader-thread={docked || undefined}>
            <div className="flex items-start gap-2 px-4 py-2.5 border-b border-line shrink-0">
              <div className="flex-1 min-w-0">
                <div className="text-control text-ink-faint leading-snug line-clamp-2">{thread[0].data.question}</div>
              </div>
              {!isViewerMode && railCanHighlight && (
                <HighlighterButton
                  active={railHighlighter.active}
                  buttonRef={railHighlighter.buttonRef}
                  onClick={() => {
                    if (!railHighlighter.active && materialHighlighter.active) materialHighlighter.toggle();
                    setAsk(null);
                    railHighlighter.toggle();
                  }}
                  className="w-7 h-7 shrink-0"
                />
              )}
              <button
                onClick={() => { if (!docked) close(); onLocate(thread[0].id); }}
                data-tooltip={t('reader.locate')} aria-label={t('reader.locate')}
                className="w-6 h-6 rounded-control text-ink-faint hover:text-accent hover:bg-wash flex items-center justify-center transition-colors shrink-0"
              >
                <Crosshair size={13} strokeWidth={1.75} />
              </button>
              <button
                onClick={() => setThreadId(null)}
                aria-label={t('reader.threadClose')}
                className="w-6 h-6 rounded-control text-ink-faint hover:text-ink hover:bg-wash flex items-center justify-center transition-colors shrink-0"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
            <div ref={railRef} data-cursor="native" onMouseUp={handleRailMouseUp} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {thread.map((turn) => (
                <div key={turn.id} data-reader-turn={turn.id}>
                  <div className="markdown-body text-body font-semibold text-ink mb-1.5" data-turn-question={turn.id}
                    data-highlight-turn={canHighlightConversation(turn.data) ? 'question' : undefined}
                    data-highlighter-active={(railHighlighter.active && canHighlightConversation(turn.data)) || undefined}>
                    <Markdown base={turn.data.agentSession?.cwd ?? turn.data.importSource?.cwd} preserveListNumbers
                      highlights={conversationHighlightTexts(turn.data.highlights, 'question')}>{turn.data.question}</Markdown>
                  </div>
                  {turn.data.isLoading && !turn.data.response ? (
                    <div className="flex items-center gap-2 text-control text-ink-muted py-1">
                      <Loader2 size={13} strokeWidth={1.75} className="animate-spin text-accent" /> {t('common.thinking')}
                    </div>
                  ) : (
                    <div className="markdown-body text-body text-ink" data-turn-answer={turn.id}
                      data-highlight-turn={canHighlightConversation(turn.data) ? 'response' : undefined}
                      data-highlighter-active={(railHighlighter.active && canHighlightConversation(turn.data)) || undefined}>
                      {(turn.data.highlights?.length ?? 0) > 0 ? (
                        <HighlightedMarkdown base={turn.data.agentSession?.cwd ?? turn.data.importSource?.cwd} content={turn.data.response} highlights={conversationHighlightTexts(turn.data.highlights, 'response')} />
                      ) : (
                        <Markdown base={turn.data.agentSession?.cwd ?? turn.data.importSource?.cwd}>{turn.data.response}</Markdown>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div data-export-omit="run" className="border-t border-line px-3 py-2.5 shrink-0 flex items-end gap-1.5">
              <textarea
                value={followDraft}
                onChange={(e) => setFollowDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); submitFollow(); } }}
                placeholder={t('common.followUp')}
                rows={1}
                className="flex-1 bg-wash text-body text-ink rounded-control px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none placeholder-ink-faint"
                style={{ minHeight: 32, maxHeight: 120 }}
                onInput={(e) => {
                  const ta = e.currentTarget;
                  ta.style.height = 'auto';
                  ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
                }}
              />
              <button
                onClick={submitFollow}
                disabled={!followDraft.trim()}
                className="w-8 h-8 rounded-control bg-action text-white flex items-center justify-center disabled:opacity-30 transition-opacity shrink-0"
              >
                <Send size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
        </div>

        {/* footer: ask about the whole material + the questions grown from it */}
        <div data-export-omit={grownChildren.length ? undefined : 'run'} className="border-t border-line bg-card px-5 py-2.5 shrink-0 flex items-center gap-2.5">
          <div className="contents" data-export-omit="run">
          <input
            value={wholeDraft}
            onChange={(e) => setWholeDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); submitWhole(); } }}
            placeholder={t(conversationTurn ? 'common.followUp' : 'reader.askWhole')}
            className="flex-1 min-w-[200px] bg-wash text-control text-ink rounded-control px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder-ink-faint"
            data-reader-wholeask
          />
          {/* the reader's one set of per-ask switches: every ask from here
              (whole material, a selection, a follow-up in the rail) uses them */}
          <SearchToggles size={15} />
          <button
            onClick={submitWhole}
            disabled={!wholeDraft.trim()}
            className="w-8 h-8 rounded-control bg-action text-white flex items-center justify-center disabled:opacity-30 transition-opacity shrink-0"
          >
            <Send size={14} strokeWidth={1.75} />
          </button>
          </div>
          {grownChildren.length > 0 && (
            <div className="flex flex-wrap items-center content-start gap-1.5 max-w-[45%] shrink-0 max-h-[3.75rem] overflow-y-auto" data-grown-chips>
              <span className="text-meta text-ink-faint shrink-0">{fmt(t('reader.grown'), { n: grownChildren.length })}</span>
              {grownChildren.map((c) => (
                <span
                  key={c.id}
                  className={`text-control rounded-tag pl-2.5 pr-1 py-0.5 shrink-0 max-w-[220px] transition-colors flex items-center gap-1 ${
                    threadId === c.id ? 'bg-accent/10 text-accent' : 'bg-wash text-ink-muted hover:bg-line'
                  }`}
                >
                  <button data-export-reading-label onClick={() => setThreadId(c.id)} className="flex items-center gap-1.5 min-w-0">
                    {c.data.isLoading && <Loader2 size={10} strokeWidth={2} className="animate-spin text-accent shrink-0" />}
                    {/* provenance at a glance: page-anchored vs whole-material */}
                    {c.data.anchor && (
                      <span className={`font-mono shrink-0 ${threadId === c.id ? 'text-accent' : 'text-ink-faint'}`}>
                        {`p.${c.data.anchor.page}`}
                      </span>
                    )}
                    <span className="truncate">{c.data.question.replace(/\s+/g, ' ').slice(0, 32) || '…'}</span>
                  </button>
                  <button
                    onClick={() => { if (!docked) close(); onLocate(c.id); }}
                    data-tooltip={t('reader.locate')} aria-label={t('reader.locate')}
                    className="w-4.5 h-4.5 rounded-control flex items-center justify-center text-ink-faint hover:text-accent shrink-0"
                  >
                    <Crosshair size={11} strokeWidth={1.75} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
    </>
  );

  // floating ask bar under the selection: fixed, the same in every face
  const askBar = ask && (
        <div
          ref={askRef}
          className="fixed z-[95] bg-card border border-line rounded-overlay shadow-lg p-2.5 w-[360px] animate-fade-in"
          style={{ left: askLeft - 180, top: askTop }}
          data-reader-askbar
        >
          <div className="text-control text-ink-faint leading-snug mb-1.5 line-clamp-2 border-l-2 border-warm pl-2">
            “{ask.text.slice(0, 120)}{ask.text.length > 120 ? '…' : ''}”
            {askPages && <span className="font-mono"> · p.{askPages}</span>}
          </div>
          <div className="flex items-end gap-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); submitAsk(); }
              }}
              placeholder={t('reader.askPlaceholder')}
              rows={1}
              autoFocus
              className="flex-1 bg-wash text-body text-ink rounded-control px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none placeholder-ink-faint"
              style={{ minHeight: 32, maxHeight: 120 }}
              onInput={(e) => {
                const ta = e.currentTarget;
                ta.style.height = 'auto';
                ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
              }}
            />
            {!ask.targetNodeId && (
              <button
                onClick={saveSelectionAsNote}
                aria-label={t('reader.saveAsNote')}
                data-reader-clip-note
                className="w-8 h-8 rounded-control bg-wash text-ink-muted hover:text-warm hover:bg-warm/10 flex items-center justify-center transition-colors shrink-0"
              >
                <StickyNote size={14} strokeWidth={1.75} />
              </button>
            )}
            <button
              onClick={submitAsk}
              disabled={!draft.trim()}
              className="w-8 h-8 rounded-control bg-action text-white flex items-center justify-center disabled:opacity-30 transition-opacity shrink-0"
            >
              <Send size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
  );

  // the strip: not even the narrowest column fits beside the node panel. The
  // material's name stays in view; the chevron closes the panel (deselects)
  // so the column returns.
  if (docked && collapsed) {
    return (
      <div className="absolute left-0 top-0 bottom-0 z-[30] bg-card border-r border-line flex flex-col items-center py-3 gap-3" style={{ width: READER_STRIP_WIDTH }} data-type-surface="reading" data-material-reader data-reader-strip>
        <button onClick={() => useStore.getState().setSelectedNodeId(null)} aria-label={t('reader.stripExpand')} data-reader-strip-expand className="w-7 h-7 rounded-control text-ink-muted hover:bg-wash hover:text-ink flex items-center justify-center transition-colors">
          <ChevronRight size={15} strokeWidth={1.75} />
        </button>
        {headerIcon}
        <span className="text-control text-ink-muted truncate [writing-mode:vertical-rl] max-h-[calc(45*var(--ui-vh))]" data-tooltip={shownTitle} data-tooltip-overflow>{shownTitle}</span>
        <div className="flex-1" />
        <button onClick={() => useUiStore.getState().setReaderMode('full')} aria-label={t('reader.expand')} data-reader-expand className={iconButton}>
          <Maximize2 size={14} strokeWidth={1.75} />
        </button>
        <button onClick={close} data-material-reader-close aria-label={t('panel.close')} className={iconButton}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  // the docked column: a sheet along the canvas's left edge, resizable on
  // its right; the canvas steps aside by its width (App reads lib/reader-dock)
  if (docked) {
    return (
      <div ref={layerRef} className={`absolute left-0 top-0 bottom-0 z-[30] bg-surface border-r border-line flex flex-col ${resizing ? 'select-none' : ''}`} style={{ width: dock.width }} data-type-surface="reading" data-material-reader data-reader-docked>
        {inner}
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onDoubleClick={onResizeDoubleClick}
          data-cursor="resize-column" className={`absolute right-0 top-0 h-full w-[8px] -mr-[3px] z-20 hover:bg-accent/20 transition-colors flex items-center justify-center ${resizing ? 'bg-accent/30' : ''}`}
          aria-label={t('panel.resizeTitle')}
          data-reader-resize
        >
          <div className={`w-[3px] h-9 rounded-control transition-colors ${resizing ? 'bg-accent' : 'bg-line-strong'}`} />
        </div>
        {askBar}
      </div>
    );
  }

  // the overlay: the reader as a focused sheet over the canvas
  return (
    <div className="fixed inset-0 z-[80] bg-ink/25 flex items-center justify-center animate-fade-in" data-type-surface="reading" data-material-reader>
      <div ref={layerRef} role="dialog" aria-modal="true" aria-label={shownTitle} tabIndex={-1} className={`bg-surface rounded-panel shadow-lg border border-line ${threadId ? "w-[min(1480px,calc(96*var(--ui-vw)))]" : "w-[min(1060px,calc(94*var(--ui-vw)))]"} h-[calc(93*var(--ui-vh))] flex flex-col overflow-hidden transition-all duration-200`}>
        {inner}
      </div>
      {askBar}
    </div>
  );
}

// One image material: the picture at column width × zoom, with the same
// rubber-band capture as PDF pages — cropped from the ORIGINAL resolution,
// so a clip of a zoomed-out image loses nothing.
function ImageFigure({ att, source, zoom, clipMode, onClipped }: {
  att: Attachment; source?: string; zoom: number; clipMode: boolean;
  onClipped: (att: Attachment, rect: [number, number, number, number], dataUrl: string, screenRect?: { left: number; top: number; width: number; height: number }) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const frac = (e: React.MouseEvent) => {
    const pb = holderRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - pb.left) / pb.width)), y: Math.min(1, Math.max(0, (e.clientY - pb.top) / pb.height)) };
  };
  const finishClip = () => {
    if (!band) return;
    const x = Math.min(band.x0, band.x1), y = Math.min(band.y0, band.y1);
    const w = Math.abs(band.x1 - band.x0), h = Math.abs(band.y1 - band.y0);
    setBand(null);
    if (w < 0.02 || h < 0.01) return;
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    const sx = Math.floor(x * img.naturalWidth), sy = Math.floor(y * img.naturalHeight);
    const sw = Math.max(1, Math.floor(w * img.naturalWidth)), sh = Math.max(1, Math.floor(h * img.naturalHeight));
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    out.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const pb = holderRef.current!.getBoundingClientRect();
    const screenRect = { left: pb.left + x * pb.width, top: pb.top + y * pb.height, width: w * pb.width, height: h * pb.height };
    onClipped(att, [x, y, w, h], out.toDataURL('image/png'), screenRect);
  };
  return (
    <figure className="shrink-0" data-reader-image style={{ width: `${Math.round(820 * zoom)}px`, maxWidth: zoom <= 1 ? '100%' : undefined }}>
      <div ref={holderRef} className="relative">
        <img
          ref={imgRef}
          src={source ?? `data:${att.type};base64,${att.content}`}
          alt={att.name}
          draggable={false}
          className="w-full rounded-content border border-line bg-white select-none"
        />
        {clipMode && (
          <div
            data-cursor="crosshair" className="absolute inset-0"
            style={{ zIndex: 6 }}
            data-clip-overlay={att.id}
            onMouseDown={(e) => { e.preventDefault(); const p = frac(e); setBand({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
            onMouseMove={(e) => { if (band) { const p = frac(e); setBand({ ...band, x1: p.x, y1: p.y }); } }}
            onMouseUp={finishClip}
            onMouseLeave={() => { if (band) finishClip(); }}
          >
            {band && (
              <div
                className="absolute border-2 border-warm bg-warm/10 rounded-none pointer-events-none"
                style={{
                  left: `${Math.min(band.x0, band.x1) * 100}%`,
                  top: `${Math.min(band.y0, band.y1) * 100}%`,
                  width: `${Math.abs(band.x1 - band.x0) * 100}%`,
                  height: `${Math.abs(band.y1 - band.y0) * 100}%`,
                }}
              />
            )}
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-meta text-ink-faint font-mono truncate">{att.name}</figcaption>
    </figure>
  );
}

// One PDF page: canvas render + selectable text layer, lazily rendered as it
// scrolls into range so long papers stay light.
// Digest markdown with (p.N) references turned into jump buttons back into
// the original pages — a digest with provenance, not a floating summary.
function DigestBody({ text, onJump }: { text: string; onJump: (page: number) => void }) {
  const parts = text.split(/(\(p\.\s?\d+\))/g);
  return (
    <>
      {parts.map((seg, i) => {
        const m = seg.match(/^\(p\.\s?(\d+)\)$/);
        if (m) {
          return (
            <button
              key={i}
              onClick={() => onJump(Number(m[1]))}
              className="inline-flex items-center text-control text-accent bg-accent/10 hover:bg-accent/20 rounded-tag px-1.5 py-0.5 mx-0.5 align-middle transition-colors"
            >
              p.{m[1]}
            </button>
          );
        }
        return <Markdown key={i}>{seg}</Markdown>;
      })}
    </>
  );
}
