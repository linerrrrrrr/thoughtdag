import { useState, useRef, useCallback, useEffect, useMemo, type RefObject } from 'react';
import { describeModel } from '../../lib/use-models';
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCopy, RefreshCw, Trash2, Pencil } from 'lucide-react';
import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { isImeComposing } from '../../utils';
import { copyText } from '../../lib/export';
import { Markdown, HighlightedMarkdown } from '../Markdown';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import { collectExploreMarksKey, type ExploreMark } from '../../lib/explore-marks';
import type { useTextHighlighter } from '../../lib/use-text-highlighter';
import ReasoningDisclosure from '../ui/ReasoningDisclosure';
import { ApprovalCard, DecisionsDisclosure } from '../ui/ApprovalCard';
import { AgentTrace } from '../ui/AgentTrace';
import { AgentActivityView } from '../ui/AgentActivityView';
import { activeAgentActivity } from '../../lib/agent-activity';
import { AgentRerunButton } from '../ui/AgentRerunButton';
import type { ThoughtData } from '../../types';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';

const isConversationResizeTarget = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('[data-conversation-divider]');

export default function ResponseSection({
  nodeId,
  data,
  hasMultipleVersions,
  highlightedTexts,
  highlighter,
  responseRef,
  onFocusNode,
}: {
  nodeId: string;
  data: ThoughtData;
  hasMultipleVersions: boolean;
  highlightedTexts: Set<string>;
  highlighter: ReturnType<typeof useTextHighlighter>;
  responseRef: RefObject<HTMLDivElement | null>;
  onFocusNode?: (id: string) => void;
}) {
  const editResponse = useStore((s) => s.editResponse);
  const editQuestion = useStore((s) => s.editQuestion);
  const setEditingResponse = useStore((s) => s.setEditingResponse);
  const navigateVersion = useStore((s) => s.navigateVersion);
  const rerunNode = useStore((s) => s.rerunNode);
  const deleteVersion = useStore((s) => s.deleteVersion);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  // Passages child branches explore from (derived from the children).
  // Clicking a mark walks the panel to that branch and centers it. The
  // selector returns the serialized form: a fresh array from a selector
  // re-renders forever (Object.is snapshot comparison).
  const exploreMarksKey = useStore((s) => collectExploreMarksKey(nodeId, s.nodes, s.edges));
  const exploreMarks = useMemo(() => JSON.parse(exploreMarksKey) as ExploreMark[], [exploreMarksKey]);
  const t = useT();
  const editingHere = data.isEditingResponse && data.responseEditor === 'panel';
  const activity = activeAgentActivity(data);
  const exploreSpecs = exploreMarks.map((m) => ({
    text: m.text,
    nodeId: m.nodeId,
    title: `${t('node.exploredHere')} · ${m.question.slice(0, 80)}`,
  }));
  const handleExploreMarkClick = (e: React.MouseEvent) => {
    if (highlighter.active) return;
    const m = (e.target as HTMLElement).closest?.('mark[data-explore-target]');
    if (!m) return;
    if (window.getSelection()?.toString()) return; // a drag-select, not a click
    e.stopPropagation();
    const childId = m.getAttribute('data-explore-target');
    // the same guard the card's click has: a mark whose node is gone (deleted, or written by the model) does
    // nothing, instead of selecting an id the panel cannot show (#56)
    if (!childId || !useStore.getState().nodes.some((n) => n.id === childId)) return;
    setSelectedNodeId(childId);
    onFocusNode?.(childId);
  };

  const draftKey = `response-edit:${nodeId}`;
  const [editResponseValue, setEditResponseValue] = useState(() => useUiStore.getState().drafts[draftKey] ?? data.response);
  const editorRef = useRef<HTMLDivElement>(null);
  const cancelEdit = () => { useUiStore.getState().setDraft(draftKey, ''); setEditingResponse(nodeId, false); };
  const dismiss = useInlineEditDismiss({
    active: !!editingHere,
    ref: editorRef,
    onOutside: () => setEditingResponse(nodeId, false),
    onCancel: cancelEdit,
    ignoreOutside: event => isConversationResizeTarget(event.target),
    ignoreFocusOutside: isConversationResizeTarget,
  });
  const streamRef = useRef<HTMLDivElement>(null);
  const followingStreamRef = useRef(true);
  const { markSelection } = highlighter;

  // Follow the stream — but only while the reader is at the bottom. Scroll
  // up during generation and the view stays put (read from the top while
  // the rest streams in); return to the live tail to re-engage following.
  useEffect(() => {
    if (!data.isLoading) { followingStreamRef.current = true; return; }
    const content = streamRef.current;
    const el = content?.closest<HTMLElement>('[data-conversation-split-answer]') ?? content;
    if (!content || !el) return;
    // Follow only the live text inside its pane; the surrounding page keeps
    // its own scroll position for metadata and inspection.
    const tailScrollTop = () => Math.max(0, el === content
      ? el.scrollHeight - el.clientHeight
      : content.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight);
    const atTail = () => Math.abs(tailScrollTop() - el.scrollTop) <= 1;
    let previousScrollTop = el.scrollTop;
    let upwardWheelPending = false;
    // Upward intent suspends following before the browser scrolls, including
    // tiny movements in a short answer pane. Only an actual return resumes it.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey
        || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.deltaY < 0) {
        followingStreamRef.current = false;
        upwardWheelPending = true;
      } else if (event.deltaY > 0) {
        upwardWheelPending = false;
        if (atTail()) followingStreamRef.current = true;
      }
    };
    // Track the reader before the next chunk changes the scroll height.
    const onScroll = () => {
      const movedDown = el.scrollTop > previousScrollTop;
      if (!atTail()) {
        followingStreamRef.current = false;
        upwardWheelPending = false;
      } else if (!upwardWheelPending && movedDown) {
        followingStreamRef.current = true;
      }
      previousScrollTop = el.scrollTop;
    };
    if (followingStreamRef.current) el.scrollTop = tailScrollTop();
    previousScrollTop = el.scrollTop;
    el.addEventListener('wheel', onWheel, { passive: true, capture: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      el.removeEventListener('scroll', onScroll);
    };
  }, [data.isLoading, data.response, data.reasoning]);

  // Text selection handler
  const handleTextSelection = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    if (!(e.target instanceof Element) || e.target.closest('input, textarea, button')) return;
    if (!responseRef.current?.contains(e.target)) return;

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (selection && range && selection.toString().trim().length > 0
      && responseRef.current?.contains(range.startContainer)
      && responseRef.current.contains(range.endContainer)) {
      markSelection(selection, nodeId);
    }
  }, [markSelection, nodeId, responseRef]);

  useEffect(() => {
    if (!highlighter.active) return;
    document.addEventListener('mouseup', handleTextSelection);
    return () => document.removeEventListener('mouseup', handleTextSelection);
  }, [handleTextSelection, highlighter.active]);

  // Button-triggered (see ThoughtNode): double-click stays a text gesture.
  const startEditResponse = () => {
    if (isViewerMode) return;
    const draftKey = `response-edit:${nodeId}`;
    const draft = useUiStore.getState().drafts[draftKey] ?? data.response;
    setEditResponseValue(draft);
    useUiStore.getState().setDraft(draftKey, draft, true);
    setEditingResponse(nodeId, true, 'panel');
  };

  const handleResponseEditSubmit = () => {
    editResponse(nodeId, editResponseValue);
    useUiStore.getState().setDraft(draftKey, '');
  };

  const handleResponseEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isImeComposing(e)) {
      e.preventDefault();
      handleResponseEditSubmit();
    }
  };

  // No response yet and nothing in flight (e.g. a fresh ask node or a
  // paradigm human turn) — the card would be an empty box, so skip it.
  if (!data.response && !data.isLoading && !data.isEditingResponse && !data.generationFailed && !activity.length) {
    return null;
  }

  return (
    <section className="focus-response-section" aria-label={t('panel.response')} data-conversation-answer>

      {data.isLoading && !!data.pendingApprovals?.length && (
        <div className="py-1 flex flex-col gap-1.5">{data.pendingApprovals.map((req) => <ApprovalCard key={req.id} nodeId={nodeId} request={req} />)}</div>
      )}
      {!data.isLoading && activity.length > 0 && <AgentActivityView key={`${nodeId}:${data.responseIndex}`} entries={activity} base={data.agentSession?.cwd ?? data.importSource?.cwd} failed={data.generationFailed} />}
      {data.isLoading && activity.length > 0 ? (
        <AgentActivityView entries={activity} running base={data.agentSession?.cwd ?? data.importSource?.cwd} />
      ) : data.isLoading && data.agentTrace && data.agentTrace.length > 0 && (!data.response || data.restreaming) ? (
        <div className="py-1"><AgentTrace entries={data.agentTrace} /></div>
      ) : data.isLoading && (!data.response || data.restreaming) ? (
        data.reasoning ? (
          <div className="py-1">
            <div className="text-control text-ink-faint mb-1">💭 {t('node.reasoningLive')}</div>
            <div ref={streamRef} className="text-body text-ink-faint italic whitespace-pre-wrap break-words">
              {data.reasoning.length > 4000 ? '…' + data.reasoning.slice(-4000) : data.reasoning}
            </div>
          </div>
        ) : (
        <div className="flex items-center gap-2 text-body text-ink-muted">
          <span className="animate-pulse text-accent">●</span> {t('common.thinking')}
        </div>
        )
      ) : data.isLoading && data.response && !data.restreaming ? (
        <div ref={streamRef} className="focus-assistant-message markdown-body text-body text-ink">
          <Markdown base={data.agentSession?.cwd ?? data.importSource?.cwd}>{data.response}</Markdown>
          <span className="inline-block w-2 h-4 bg-accent animate-pulse rounded-none ml-0.5 align-text-bottom" />
        </div>
      ) : editingHere ? (
        <div ref={editorRef} onBlur={dismiss.onBlur} className="focus-message-editor">
          <textarea
            value={editResponseValue}
            onChange={(e) => { setEditResponseValue(e.target.value); useUiStore.getState().setDraft(`response-edit:${nodeId}`, e.target.value, true); }}
            onKeyDown={handleResponseEditKeyDown}
            className="w-full bg-wash border border-accent rounded-control p-3 text-body text-ink resize-y focus:outline-none focus:ring-2 focus:ring-accent/20 min-h-[150px]"
            rows={10}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={cancelEdit} className="text-control text-ink-muted hover:text-ink px-3 py-1.5 rounded-control hover:bg-wash transition-colors">{t('common.cancel')}</button>
            <button onClick={handleResponseEditSubmit} className="text-control bg-action hover:bg-action-strong text-white px-4 py-1.5 rounded-control transition-colors">{t('common.save')}</button>
          </div>
          <p className="mt-1.5 text-control text-ink-faint">{t('edit.draftHint')}</p>
        </div>
      ) : (
        <div>
          {data.approvals && data.approvals.length > 0 && <DecisionsDisclosure records={data.approvals} />}
          {data.reasonings?.[data.responseIndex] && !activity.length && (
            <ReasoningDisclosure text={data.reasonings[data.responseIndex]!} />
          )}
          <div ref={responseRef} className="focus-assistant-message markdown-body text-body text-ink cursor-text" onClick={handleExploreMarkClick} data-highlighter-active={highlighter.active || undefined}>
            {highlightedTexts.size > 0 || exploreSpecs.length > 0 ? (
              <HighlightedMarkdown base={data.agentSession?.cwd ?? data.importSource?.cwd} content={data.response} highlights={highlightedTexts} exploreMarks={exploreSpecs} />
            ) : (
              <Markdown base={data.agentSession?.cwd ?? data.importSource?.cwd}>{data.response}</Markdown>
            )}
          </div>

        </div>
      )}

      {/* Response action row — the actions that act on THIS answer live
          under it (LLM-chat convention); the sibling-branch variant is in
          the header's ⋯ menu */}
      {data.response && !data.isLoading && !editingHere && !data.generationFailed && (
        <div className="focus-response-actions flex flex-wrap items-center gap-0.5 text-ink-faint">
          {!isViewerMode && <button
            onClick={() => void rerunNode(nodeId, {})}
            className="rounded-control w-7 h-7 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
            data-tooltip={t('common.regenerate')}
            aria-label={t('common.regenerate')}
          >
            <RefreshCw size={15} strokeWidth={1.75} />
          </button>}
          <button
            onClick={() => void copyText(data.response)}
            className="rounded-control w-7 h-7 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
            aria-label={t('actions.copyResponse')}
            data-tooltip={t('actions.copyResponse')}
          >
            <ClipboardCopy size={14} strokeWidth={1.75} />
          </button>
          {!isViewerMode && (
            <button
              onClick={startEditResponse}
              className="rounded-control w-7 h-7 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
              aria-label={t('actions.editResponse')}
              data-tooltip={t('actions.editResponse')}
              data-edit-response
            >
              <Pencil size={14} strokeWidth={1.75} />
            </button>
          )}
          <AgentRerunButton nodeId={nodeId} data={data} size="md" />
          {(data.generatedBy?.[data.responseIndex]) && (
            <span
              className="focus-model-source text-meta text-ink-faint ml-1 truncate flex-1 min-w-0"

            >
              {describeModel(data.generatedBy[data.responseIndex], data.generatedEfforts?.[data.responseIndex])}
            </span>
          )}
          {hasMultipleVersions && (
            <div className="flex items-center gap-1 text-control text-ink-muted ml-1">
              <button onClick={() => navigateVersion(nodeId, 'prev')} className="hover:text-accent hover:bg-wash rounded-control w-5 h-5 flex items-center justify-center transition-colors"><ChevronLeft size={14} strokeWidth={1.75} /></button>
              <span className="text-accent font-medium">v{data.responseIndex + 1}/{data.responses.length}</span>
              <button onClick={() => navigateVersion(nodeId, 'next')} className="hover:text-accent hover:bg-wash rounded-control w-5 h-5 flex items-center justify-center transition-colors"><ChevronRight size={14} strokeWidth={1.75} /></button>
              {!isViewerMode && <button
                onClick={() => deleteVersion(nodeId, data.responseIndex)}
                className="rounded-control w-5 h-5 flex items-center justify-center transition-colors object-action-danger" data-icon-only
                aria-label={t('common.deleteVersion')}
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>}
            </div>
          )}
        </div>
      )}

      {/* Web references consulted for this response */}
      {data.references && data.references.length > 0 && !data.isLoading && (
        <div className="mt-3 pt-2 border-t border-line/60">
          <p className="text-control text-ink-faint font-medium mb-1.5">{t('refs.title')}</p>
          <ol className="space-y-1">
            {data.references.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-control leading-snug">
                <span className="shrink-0 text-meta text-ink-faint font-mono mt-0.5">[{i + 1}]</span>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-strong hover:underline break-all">
                    {r.title}
                  </a>
                ) : (
                  <span className="text-ink-muted">{r.title}</span>
                )}
                {(r.media || r.date) && (
                  <span className="shrink-0 text-meta text-ink-faint">{[r.media, r.date].filter(Boolean).join(' · ')}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Failed generation: retry in place */}
      {data.generationFailed && !data.isLoading && (
        <div className="mt-2 flex items-center gap-2 text-control text-red-600 bg-red-50 border border-red-100 rounded-content px-3 py-2">
          <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" />
          {t('common.generationFailed')}
          {!isViewerMode && <button
            onClick={() => editQuestion(nodeId, data.question)}
            className="ml-auto bg-card border border-red-200 hover:bg-red-100 text-red-600 px-2.5 py-1 rounded-control transition-colors flex items-center gap-1"
          >
            <RefreshCw size={12} strokeWidth={1.75} /> {t('common.retry')}
          </button>}
        </div>
      )}
    </section>
  );
}
