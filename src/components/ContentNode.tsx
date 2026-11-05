import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { BookOpen, ExternalLink, FileText, Link2, Link2Off, Loader2, Paperclip, RefreshCw, StickyNote, Trash2, X } from 'lucide-react';
import type { Attachment, ThoughtNode as ThoughtNodeType } from '../types';
import { useStore } from '../store';
import { useNodeDetail } from '../lib/node-detail';
import { useUiStore } from '../lib/ui-store';
import { triggerParadigmCascade } from '../store/streaming';
import { extractImage, fetchLinkIntoNode, ingestFiles } from '../lib/content';
import { FILE_INPUT_ACCEPT } from '../lib/attachments';
import { Markdown } from './Markdown';
import NodeOverview from './NodeOverview';
import NodeConnectionHandles from './NodeConnectionHandles';
import NodeResizeControls from './NodeResizeControls';
import FileIdentity from './FileIdentity';
import { fileIdentity, fileSizeLabel } from '../lib/file-identity';
import { getNodeDisplayName, getNodeNameSource } from '../lib/node-display-name';
import { countTokens } from '../utils';
import { useT, fmt } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import { recallSourceLine } from '../lib/recall';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';

// Content nodes: canvas material, not turns. A note (markdown), a file
// (attachments) or a link (stamped web snapshot) that never generates — it
// feeds downstream context ONLY via its outgoing edge (the One Rule), so it
// has no target handle: nothing flows INTO material. autoLayout never moves
// them. In a paradigm, an empty content node is a MATERIAL SLOT: the
// cascade waits until the human fills it, like a human turn.

/** Where an unresized note stops growing: the answer box's cap. */
const NOTE_BODY_MAX = 400;
const isGeometryControl = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('.react-flow__resize-control, .react-flow__controls');

function ExtractionEditor({ nodeId, attachment, onClose }: { nodeId: string; attachment: Attachment; onClose: () => void }) {
  const t = useT();
  const draftKey = `extraction:${nodeId}:${attachment.id}`;
  const [draft, setDraft] = useState(() => useUiStore.getState().drafts[draftKey] ?? attachment.extractedText ?? '');
  const editRef = useRef<HTMLDivElement>(null);
  const discard = () => { useUiStore.getState().setDraft(draftKey, ''); onClose(); };
  const isExtractToggle = (target: EventTarget | null) => target instanceof Element && target.closest('[data-extract-toggle]')?.getAttribute('data-extract-toggle') === attachment.id;
  const edit = useInlineEditDismiss({
    active: true, ref: editRef, onOutside: onClose, onCancel: discard,
    ignoreOutside: event => isExtractToggle(event.target) || isGeometryControl(event.target),
    ignoreFocusOutside: target => isExtractToggle(target) || isGeometryControl(target),
  });
  const save = () => {
    if (draft !== (attachment.extractedText ?? '')) {
      useStore.getState().pushHistory();
      useStore.getState().setAttachmentData(nodeId, attachment.id, { extractedText: draft, extractedBy: 'manual' });
      useStore.getState().pushHistory();
    }
    discard();
  };
  return (
    <div ref={editRef} onBlur={edit.onBlur} className="mt-2 space-y-2" onClick={event => event.stopPropagation()} data-extraction-editor>
      <textarea
        value={draft}
        onChange={event => { setDraft(event.target.value); useUiStore.getState().setDraft(draftKey, event.target.value, true); }}
        rows={7}
        autoFocus
        className="w-full text-body text-ink bg-surface border border-line rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-y nopan nowheel"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { discard(); void extractImage(nodeId, attachment.id); }} className="text-control text-ink-muted hover:text-ink px-2 py-1.5 rounded-control flex items-center gap-1">
          <RefreshCw size={12} strokeWidth={1.75} /> {t('content.reExtractAgain')}
        </button>
        <div className="flex-1" />
        <button onClick={discard} className="text-control text-ink-muted hover:bg-wash px-3 py-1.5 rounded-control">{t('common.cancel')}</button>
        <button onClick={save} className="text-control bg-accent text-white hover:bg-accent/90 px-3 py-1.5 rounded-control">{t('common.save')}</button>
      </div>
      <p className="text-control text-ink-faint">{t('content.draftExitHint')}</p>
    </div>
  );
}

export default function ContentNode({ id, data, selected }: NodeProps<ThoughtNodeType>) {
  const t = useT();
  const deleteNode = useStore((s) => s.deleteNode);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  // Blindspot #8: on-canvas ≠ in-context — unlinked material is decoration
  const isLinked = useStore((s) => s.edges.some((e) => e.source === id));
  // Wiring material happens mostly from the overview — grow the handle there
  const { tier: zoomTier, fixed: fixedDetail } = useNodeDetail(data.detailLevel);
  const zoomedOut = zoomTier !== 'work';
  const rf = useReactFlow();
  const nodePos = useStore((s) => { const n = s.nodes.find((x) => x.id === id); return n ? n.position : null; });
  // Does this material actually reach any context? 'none' and 'quote' are
  // the two silent traps a card must confess to (One Rule's honest face).
  const wireState = useStore((s) => {
    const outs = s.edges.filter((e) => e.source === id);
    if (outs.length === 0) return 'none:0';
    const full = outs.filter((e) => !e.data?.isCrossLink).length;
    return full > 0 ? `full:${full}` : 'quote:0';
  });
  const glyphTier = zoomTier === 'glyph';
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [zoomTier, id, updateNodeInternals]);

  const kind = data.stepKind === 'file' ? 'file' : data.stepKind === 'link' ? 'link' : 'note';
  // a height of the card's own (the corner handle) vs. the measured one React Flow passes in props
  const resized = useStore((s) => s.nodes.find((n) => n.id === id)?.height != null);
  const [editing, setEditing] = useState(!isViewerMode && kind === 'note' && !data.question);
  const draftKey = `note:${id}`;
  const [draft, setDraft] = useState(() => useUiStore.getState().drafts[draftKey] ?? data.question);
  const retainedDraft = useUiStore(s => s.drafts[draftKey]);
  const editRef = useRef<HTMLDivElement>(null);
  const [openExtract, setOpenExtract] = useState<string | null>(null); // attId whose extraction panel is open
  const fileRef = useRef<HTMLInputElement>(null);
  const canContinueWorkflow = useStore(s => s.edges.some(edge => edge.source === id && !edge.data?.isCrossLink && s.nodes.some(node => node.id === edge.target && node.data.stepKind === 'prompt' && !node.data.response && !node.data.isLoading && !node.data.generationFailed)));

  // Material may advance a workflow, so only the explicit save can commit.
  const commit = () => {
    setEditing(false);
    useUiStore.getState().setDraft(draftKey, '');
    const text = draft.trim() === '' ? '' : draft;
    if (text === data.question) return;
    useStore.getState().pushHistory();
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, question: text, tokenCount: countTokens(text) } } : n)),
    }));
    useStore.getState().pushHistory();
    // Filling a material slot advances a waiting paradigm run (idempotent)
    triggerParadigmCascade(useStore.getState, id);
  };
  const cancel = () => {
    useUiStore.getState().setDraft(draftKey, '');
    setDraft(data.question);
    setEditing(false);
  };
  const edit = useInlineEditDismiss({ active: editing, ref: editRef, onOutside: () => setEditing(false), onCancel: cancel,
    ignoreOutside: event => isGeometryControl(event.target), ignoreFocusOutside: isGeometryControl });
  const startEditing = () => {
    if (isViewerMode) return;
    setDraft(useUiStore.getState().drafts[draftKey] ?? data.question);
    setEditing(true);
  };

  const attachments = data.attachments || [];
  const fileTypes = [...new Set(attachments.map(att => fileIdentity(att.name).extension).filter(Boolean))];
  const materialLabel = t(kind === 'note' ? 'content.textMaterial' : kind === 'file' ? 'content.fileMaterial' : 'glyph.link');
  const linkLoading = kind === 'link' && !data.question && !data.linkTitle?.startsWith('⚠');

  // Clip provenance: an edge-less clip finds its source through anchor.attId
  const clipAnchor = data.anchor?.attId ? data.anchor : undefined;
  const clipSource = useStore((s) => {
    if (!clipAnchor) return null;
    const src = s.nodes.find((n) => n.data.attachments?.some((a) => a.id === clipAnchor.attId));
    if (!src) {
      // link-snapshot clips carry the link NODE's id (snapshots aren't attachments)
      const link = s.nodes.find((n) => n.id === clipAnchor.attId && n.data.stepKind === 'link');
      return link ? [link.id, link.data.linkTitle || link.data.linkUrl || ''].join(String.fromCharCode(0)) : null;
    }
    const att = src.data.attachments!.find((a) => a.id === clipAnchor.attId)!;
    return `${src.id}\u0000${att.name}`;
  });
  const [clipSourceId, clipSourceName] = clipSource ? clipSource.split('\u0000') : [null, null];
  const openClipSource = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!clipAnchor || !clipSourceId) return;
    useUiStore.getState().setReaderNodeId(clipSourceId, { page: clipAnchor.page });
  };
  const linkDomain = (() => { try { return new URL(data.linkUrl ?? '').hostname; } catch { return data.linkUrl ?? ''; } })();

  const headerIcon = kind === 'note'
    ? <StickyNote size={14} strokeWidth={1.75} className="text-amber-600 shrink-0" />
    : kind === 'link'
      ? <Link2 size={14} strokeWidth={1.75} className="text-accent shrink-0" />
      : <Paperclip size={14} strokeWidth={1.75} className="text-ink-muted shrink-0" />;

  const nodeName = getNodeDisplayName(data, t(kind === 'file' ? 'glyph.file' : kind === 'link' ? 'glyph.link' : 'glyph.note'));
  const nodeNameSource = getNodeNameSource(data, nodeName);
  const noteBody = kind === 'note' ? data.question.replace(/^\s*#+\s*[^\n]+\n?/, '') : '';
  // Keep active input, empty slots and retry controls in their working form.
  const showPlaque = zoomedOut && !openExtract && (kind === 'note'
    ? !editing && !!data.question
    : kind === 'file' ? attachments.length > 0 : !linkLoading && !data.linkTitle?.startsWith('⚠'));

  if (glyphTier && !editing && !openExtract) {
    // Glyph tier: material collapses to its own icon — a note, a document,
    // a link. The footprint stays (edge anchors must not shift); only the
    // centered seal renders.
    return (
      <div data-node-detail-level="compact" data-node-detail-locked={data.detailLevel || undefined} className={`material-${kind} drag-handle cursor-grab active:cursor-grabbing w-full h-full min-w-[340px] flex items-center justify-center ${selected || selectedNodeId === id ? 'glyph-selected' : ''}`}
        onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setSelectedNodeId(id); }} data-glyph-node data-selection-sized={data.keepOverviewHeight || undefined}
        onDoubleClick={(e) => {
          e.stopPropagation();
          // documents open where they are read; notes zoom to working scale
          if (kind === 'file' || kind === 'link' || fixedDetail) useUiStore.getState().setReaderNodeId(id);
          else rf.setCenter((nodePos?.x ?? 0) + 200, (nodePos?.y ?? 0) + 120, { zoom: 1, duration: 300 });
        }}
        title={`${t(kind === 'file' ? 'glyph.file' : kind === 'link' ? 'glyph.link' : 'glyph.note')}\n${kind === 'file' ? (attachments[0]?.name ?? '') : kind === 'link' ? (data.linkTitle || data.linkUrl || '') : data.question.replace(/\s+/g, ' ').slice(0, 120)}`}>
        <NodeOverview name={nodeName} source={nodeNameSource} compact icon={headerIcon} variant={kind} fileTypes={kind === 'file' ? fileTypes : undefined} />
        <NodeConnectionHandles id={id} isTargetAllowed={false} muted large />
      </div>
    );
  }

  if (showPlaque) {
    return (
      <div
        className={`content-card material-${kind} w-full h-full min-w-[340px] flex flex-col rounded-node border animate-fade-in ${selected || selectedNodeId === id ? 'node-selected' : ''}`}
        onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setSelectedNodeId(id); }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (kind === 'file' || kind === 'link' || fixedDetail) useUiStore.getState().setReaderNodeId(id);
          else rf.setCenter((nodePos?.x ?? 0) + 200, (nodePos?.y ?? 0) + 120, { zoom: 1, duration: 300 });
        }}
        onDrop={async (e) => {
          if (kind !== 'file' || isViewerMode) return;
          e.preventDefault();
          e.stopPropagation();
          await ingestFiles(id, e.dataTransfer.files);
        }}
        onDragOver={(e) => { if (kind === 'file') { e.preventDefault(); e.stopPropagation(); } }}
        data-content-plaque={kind}
        data-node-detail-level="summary" data-node-detail-locked={data.detailLevel || undefined}
      >
        <div className="drag-handle cursor-grab active:cursor-grabbing overflow-hidden">
          <NodeOverview
            name={nodeName}
            source={nodeNameSource}
            preview={kind === 'note' ? noteBody : kind === 'link' ? data.question : undefined}
            previewAlways={!!fixedDetail}
            icon={headerIcon}
            variant={kind}
            typeLabel={materialLabel}
            fileTypes={kind === 'file' ? fileTypes : undefined}
            meta={kind === 'link' ? linkDomain : kind === 'file' ? `${t('glyph.file')} · ${attachments.length}` : undefined}
          />
        </div>
        <NodeConnectionHandles id={id} isTargetAllowed={false} muted large />
      </div>
    );
  }

  return (
    <div
      className={`content-card material-${kind} w-full h-full min-w-[340px] flex flex-col rounded-node border animate-fade-in transition-colors duration-200 ${selected || selectedNodeId === id ? 'node-selected' : ''}`}
      data-node-detail-level="full" data-node-detail-locked={data.detailLevel || undefined}
      onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setSelectedNodeId(id); }}
      onDoubleClick={() => {
        // notes keep dblclick=edit (on the body); files and links open the reader
        if (kind !== 'note') useUiStore.getState().setReaderNodeId(id);
      }}
      onDrop={async (e) => {
        if (kind !== 'file' || isViewerMode) return;
        e.preventDefault();
        e.stopPropagation();
        await ingestFiles(id, e.dataTransfer.files);
      }}
      onDragOver={(e) => { if (kind === 'file') { e.preventDefault(); e.stopPropagation(); } }}
    >
      {/* Pure source: material feeds context, nothing flows INTO it — hence no target handle. */}

      {/* header: drag handle + identity + linked state + delete */}
      <div className="material-header flex items-center justify-between px-surface-inset py-section-gap border-b cursor-grab active:cursor-grabbing drag-handle shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {headerIcon}
          <span className="text-control font-medium material-label">{materialLabel}</span>
          {kind === 'link'
            ? <span className="text-control text-ink-muted truncate">{linkDomain}</span>
            : <span className="text-meta text-ink-faint font-mono">{kind === 'note' ? `${data.tokenCount} tokens` : `${attachments.length}`}</span>}
          {clipSourceName && (
            <button
              onClick={openClipSource}
              title={t('content.clipSourceTitle')}
              data-clip-source
              className="text-control font-mono text-warm bg-warm/10 hover:bg-warm/20 px-1.5 py-0.5 rounded-tag truncate max-w-[180px] transition-colors shrink"
            >
              {clipSourceName} &middot; p.{clipAnchor!.page}
            </button>
          )}
          {!isLinked && (
            <span className="text-control text-ink-faint bg-wash px-1.5 py-0.5 rounded-tag flex items-center gap-1 shrink-0" title={t('content.unlinkedTitle')}>
              <Link2Off size={11} strokeWidth={1.75} /> {t('content.unlinked')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); useUiStore.getState().setReaderNodeId(id); }}
            title={t('reader.open')}
            className="text-ink-faint hover:text-accent rounded-control w-6 h-6 flex items-center justify-center transition-colors"
          >
            <BookOpen size={13} strokeWidth={1.75} />
          </button>
          {kind === 'link' && data.linkUrl && (
            <a
              href={data.linkUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={t('content.linkOpen')}
              className="text-ink-faint hover:text-accent rounded-control w-6 h-6 flex items-center justify-center transition-colors"
            >
              <ExternalLink size={13} strokeWidth={1.75} />
            </a>
          )}
          {!isViewerMode && <button
            onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
            className="text-ink-faint hover:text-red-500 rounded-control w-6 h-6 flex items-center justify-center transition-colors"
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>}
        </div>
      </div>


      {/* Body: grows with content by default, a note up to the answer box's
          height (a long note would otherwise cover the cards below it once
          the canvas zooms in); when the card is resized the body becomes the
          scroll region (wheel scrolls text, not zoom) */}
      <div className="p-surface-inset nodrag flex-1 min-h-0 flex flex-col" style={kind === 'note' && !resized ? { maxHeight: NOTE_BODY_MAX } : undefined}>
      <div className="flex-1 min-h-0 overflow-y-auto nowheel" data-content-body>
        {data.displayName && <div className="mb-surface-inset text-title font-semibold text-ink" title={nodeNameSource} data-node-name>{nodeName}</div>}
        {/* a quote from the why layer says where it came from, above its text */}
        {kind === 'note' && data.recallSource && (
          <div className="text-meta text-ink-faint font-mono truncate mb-1.5" title={data.recallSource.file} data-recall-source>
            {fmt(t('node.recallSource'), { s: recallSourceLine(data.recallSource) })}
          </div>
        )}
        {kind === 'note' && (
          editing ? (
            <div ref={editRef} onBlur={edit.onBlur} className="flex flex-col gap-2" data-note-editor>
              <textarea
                value={draft}
                onChange={(e) => { setDraft(e.target.value); useUiStore.getState().setDraft(draftKey, e.target.value, true); }}
                placeholder={t('content.notePlaceholder')}
                rows={5}
                autoFocus
                className="w-full min-h-[7rem] bg-surface border border-line rounded-control px-3 py-2 text-body text-ink resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder-ink-faint nopan nowheel"
              />
              <div className="flex justify-end gap-2">
                <button onClick={cancel} className="text-control text-ink-muted hover:bg-wash px-3 py-1.5 rounded-control">{t('common.cancel')}</button>
                <button onClick={commit} className="text-control bg-accent text-white hover:bg-accent/90 px-3 py-1.5 rounded-control">{t('common.save')}</button>
              </div>
              <p className="text-control text-ink-faint">{t(canContinueWorkflow ? 'content.materialSaveHint' : 'content.draftExitHint')}</p>
            </div>
          ) : (
            <div
              onDoubleClick={startEditing}
              className="markdown-body text-body text-ink cursor-text nopan"
              title={t('content.noteEditTitle')}
            >
              {data.question
                ? <Markdown>{data.question}</Markdown>
                : <span className="text-ink-faint italic text-body">{t('content.notePlaceholder')}</span>}
              {retainedDraft !== undefined && <button onClick={startEditing} className="mt-2 block text-control text-accent hover:underline" data-resume-note-draft>{t('content.resumeDraft')}</button>}
            </div>
          )
        )}

        {kind === 'link' && (
          linkLoading ? (
            <div className="flex items-center gap-2 text-control text-ink-muted py-2">
              <Loader2 size={14} strokeWidth={1.75} className="animate-spin text-accent" /> {t('content.linkFetching')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {data.linkTitle && (
                <div className={`text-title font-semibold ${data.linkTitle.startsWith('⚠') ? 'text-red-600' : 'text-ink'}`}>{data.linkTitle}</div>
              )}
              {data.linkTitle?.startsWith('⚠') && data.linkUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); void fetchLinkIntoNode(id, data.linkUrl!); }}
                  className="text-control bg-wash hover:bg-line text-ink-muted px-3 py-1.5 rounded-control transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw size={13} strokeWidth={1.75} /> {t('common.retry')}
                </button>
              )}
              {data.question && (
                <div className="text-body text-ink-muted max-h-[200px] overflow-y-auto nopan nowheel whitespace-pre-wrap">
                  {data.question.slice(0, 1200)}{data.question.length > 1200 ? '…' : ''}
                </div>
              )}
              {data.linkFetchedAt && (
                <div className="text-meta text-ink-faint font-mono">
                  {fmt(t('content.linkStamp'), { date: data.linkFetchedAt.slice(0, 10) })} · {data.tokenCount} tokens
                </div>
              )}
            </div>
          )
        )}

        {kind === 'file' && (
          <div className="material-files">
            {attachments.map((att) => (
              att.type.startsWith('image/') ? (
                // Pasted images live on the canvas as the image itself —
                // resize the card (right edge) to scale it
                <div key={att.id} className="relative group">
                  <img
                    src={`data:${att.type};base64,${att.content}`}
                    alt={att.name}
                    title={att.extractedText ? att.extractedText.slice(0, 400) : undefined}
                    className="w-full rounded-content border border-line/60"
                  />
                  {att.isExtracting ? (
                    <span className="absolute bottom-1.5 left-1.5 text-control bg-ink/60 text-white px-2 py-0.5 rounded-tag flex items-center gap-1">
                      <Loader2 size={11} strokeWidth={1.75} className="animate-spin" /> {t('content.extracting')}
                    </span>
                  ) : att.extractedText !== undefined ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenExtract(openExtract === att.id ? null : att.id); }}
                      data-extract-toggle={att.id}
                      title={t('content.editExtractTitle')}
                      className="absolute bottom-1.5 left-1.5 text-control bg-ink/60 hover:bg-ink/80 text-white px-2 py-0.5 rounded-tag transition-colors"
                    >
                      {useUiStore.getState().drafts[`extraction:${id}:${att.id}`] !== undefined
                        ? t('content.resumeDraft')
                        : <>{t('content.extracted')}{att.extractedBy ? ` · ${att.extractedBy}` : ''}</>} ▾
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); void extractImage(id, att.id); }}
                      title={t('content.reExtractTitle')}
                      className="absolute bottom-1.5 left-1.5 text-control bg-ink/60 hover:bg-ink/80 text-white px-2 py-0.5 rounded-tag opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                    >
                      <RefreshCw size={11} strokeWidth={1.75} /> {t('content.reExtract')}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAttachment(id, att.id); }}
                    className="absolute top-1.5 right-1.5 bg-ink/60 text-white rounded-control w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                  {/* Extraction panel: SEE what the model read, fix it, or redo it —
                      this text is what downstream context receives as the image's index */}
                  {openExtract === att.id && (
                    <ExtractionEditor nodeId={id} attachment={att} onClose={() => setOpenExtract(null)} />
                  )}
                </div>
              ) : att.type === 'application/pdf' && att.pageImages?.[0] ? (
                // PDF wears its first page as a cover — same form as pasted
                // images, so material reads as material at a glance
                <div key={att.id} className="relative group">
                  <img
                    src={`data:image/png;base64,${att.pageImages[0]}`}
                    alt={att.name}
                    className="w-full rounded-content border border-line/60"
                  />
                  <span className="absolute bottom-1.5 left-1.5 max-w-[85%] text-control bg-ink/60 text-white px-2 py-0.5 rounded-tag flex items-center gap-1">
                    <FileText size={11} strokeWidth={1.75} className="shrink-0" />
                    <span className="truncate">{att.name}</span>
                    {att.numPages != null && <span className="shrink-0 opacity-80">· {att.numPages}p</span>}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAttachment(id, att.id); }}
                    className="absolute top-1.5 right-1.5 bg-ink/60 text-white rounded-control w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <div key={att.id} className="material-file-row group">
                  <FileIdentity name={att.name} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={(e) => { e.stopPropagation(); useUiStore.getState().setReaderNodeId(id); }} className="material-file-name text-left hover:text-accent" title={att.name}>{att.name}</button>
                    <div className="material-file-meta">
                      {fileSizeLabel(att.size) && <span>{fileSizeLabel(att.size)}</span>}
                      {att.isExtracting && <span className="text-accent">{t('attach.extracting')}</span>}
                      {att.numPages != null && <span>{att.numPages}p</span>}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAttachment(id, att.id); }}
                    className="text-ink-faint hover:text-red-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity shrink-0 rounded-control p-1"
                  >
                    <X size={13} strokeWidth={1.75} />
                  </button>
                </div>
              )
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              className={`material-upload w-full border border-dashed border-line hover:border-accent/40 hover:bg-accent/5 rounded-control text-control text-ink-faint hover:text-ink-muted transition-colors ${attachments.length === 0 ? 'py-6' : 'py-2'}`}
            >
              {t('attach.upload')}
              {attachments.length === 0 && <span className="block text-control mt-1">{t('attach.types')}</span>}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={FILE_INPUT_ACCEPT}
              className="hidden"
              onChange={(e) => { if (e.target.files) void ingestFiles(id, e.target.files); e.target.value = ''; }}
            />
          </div>
        )}
        {(
          <div className="px-1 pt-2" data-wire-status>
            {wireState === 'none:0' ? (
              <p className="text-control text-amber-700 leading-snug">{t('content.wireNone')}</p>
            ) : wireState === 'quote:0' ? (
              <p className="text-control text-amber-700 leading-snug">{t('content.wireQuoteOnly')}</p>
            ) : (
              <p className="text-control text-ink-faint leading-snug">{fmt(t('content.wireFull'), { n: wireState.split(':')[1] })}</p>
            )}
          </div>
        )}
      </div>

      </div>

      {!isViewerMode && (selected || selectedNodeId === id) && !zoomedOut && <NodeResizeControls id={id} />}

      <NodeConnectionHandles id={id} isTargetAllowed={false} muted large={zoomedOut} />
    </div>
  );
}
