import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { describeModel } from '../lib/use-models';
import { conclusionOf } from '../lib/turn-insight';
import { useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Archive, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Globe, Hourglass, Minimize2, RefreshCw, Send, Square, Trash2, UserRound, X, Pencil } from 'lucide-react';
import 'katex/dist/katex.min.css';

/** A tool's status line standing in for the answer while it runs (see
 *  store/streaming.ts onToolCall): an icon, the query, an ellipsis. */
const TOOL_PLACEHOLDER = /^(?:🔍|📚|🎓|🔧) [\s\S]*…$/;
import type { ThoughtNode as ThoughtNodeType } from '../types';
import { useStore } from '../store';
import { staleHiddenByJudge, currentStaleVerdict } from '../lib/stale-judge';
import { setNodeDetail, useNodeDetail } from '../lib/node-detail';
import { isImeComposing , activeSummary, awaitingInput, formatStamp } from '../utils';
import { processFile } from '../lib/attachments';
import { copyText } from '../lib/export';
import { isRunLocked } from '../lib/paradigm';
import { useTextHighlighter } from '../lib/use-text-highlighter';
import NodeHighlightsSection from './NodeHighlightsSection';
import { useUiStore, toast } from '../lib/ui-store';
import SearchToggles from './ui/SearchToggles';
import NodeExecutionPicker, { NodeExecutionBadge } from './ui/NodeExecutionPicker';
import { Markdown, HighlightedMarkdown } from './Markdown';
import ReasoningDisclosure from './ui/ReasoningDisclosure';
import NodeOverview from './NodeOverview';
import NodeDetailsButton from './NodeDetailsButton';
import NodeConnectionHandles from './NodeConnectionHandles';
import NodeResizeControls from './NodeResizeControls';
import { isConversationStart } from '../lib/graph';
import { getNodeDisplayName, getNodeNameSource } from '../lib/node-display-name';
import NodeMetadataEditor from './NodeMetadataEditor';
import NodeTokenUsage from './NodeTokenUsage';
import NodeContextSources from './NodeContextSources';
import './ConversationSurface.css';
import ConversationSplit from './ConversationSplit';
import './ConversationNodeSplit.css';
import { ApprovalCard } from './ui/ApprovalCard';
import { AgentTrace } from './ui/AgentTrace';
import { AgentActivityView } from './ui/AgentActivityView';
import { activeAgentActivity, originalQuestionBeforeInstructions } from '../lib/agent-activity';
import { AgentRerunButton } from './ui/AgentRerunButton';
import { SquareTerminal } from 'lucide-react';
import { useT, fmt } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { useSessionDraft } from '../lib/use-session-draft';
import { condenseGuard } from '../lib/condense-guard';
import { measureConversationContentHeight, pixelDimension, registerNodeContentHeightMeasure } from '../lib/node-content-height';
import { useStableNodeViewHeight } from '../lib/use-stable-node-view-height';

// Camera and resize controls change presentation, not the active editing task.
const isGeometryControl = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('.react-flow__resize-control, .react-flow__controls, [data-conversation-divider]');

export default function ThoughtNode({ id, data, selected }: NodeProps<ThoughtNodeType>) {
  // Actions are stable references: selecting them one by one (instead of a
  // bare useStore() destructure) means this card no longer re-renders on
  // EVERY store change — with N cards mounted that multiplied every
  // streamed chunk into N markdown re-renders.
  const deleteNode = useStore((s) => s.deleteNode);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const setEditing = useStore((s) => s.setEditing);
  const editQuestion = useStore((s) => s.editQuestion);
  const submitHumanTurn = useStore((s) => s.submitHumanTurn);
  const stopGeneration = useStore((s) => s.stopGeneration);
  const setEditingResponse = useStore((s) => s.setEditingResponse);
  const editResponse = useStore((s) => s.editResponse);
  const navigateVersion = useStore((s) => s.navigateVersion);
  const deleteVersion = useStore((s) => s.deleteVersion);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const addAttachment = useStore((s) => s.addAttachment);
  const rerunNode = useStore((s) => s.rerunNode);
  const t = useT();
  const activity = activeAgentActivity(data);
  const [isDropTarget, setIsDropTarget] = useState(false);
  // An ask node's first question lives in shared drafts until sent:
  // undoing the node and redoing it brings the words back.
  const questionEditKey = `question-edit:${id}`;
  const responseEditKey = `response-edit:${id}`;
  const [editValue, setEditValue] = useSessionDraft(questionEditKey, data.question);
  const [editResponseValue, setEditResponseValue] = useState(() => useUiStore.getState().drafts[responseEditKey] ?? data.response);
  const [metadataEditing, setMetadataEditing] = useState(false);
  const customWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.width);
  const customHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.height);
  const customStyleWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.style?.width);
  const customStyleHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.style?.height);
  const configuredWidth = customWidth ?? pixelDimension(customStyleWidth);
  const configuredHeight = customHeight ?? pixelDimension(customStyleHeight);
  const responseRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const questionTaRef = useRef<HTMLTextAreaElement>(null);
  const questionEditorRef = useRef<HTMLDivElement>(null);
  const responseEditorRef = useRef<HTMLDivElement>(null);
  const hasQuestionDraft = useUiStore(s => s.drafts[questionEditKey] !== undefined && s.drafts[questionEditKey] !== data.question);
  const hasResponseDraft = useUiStore(s => s.drafts[responseEditKey] !== undefined && s.drafts[responseEditKey] !== data.response);
  const rf = useReactFlow();
  const { tier: zoomTier, fixed: fixedDetail } = useNodeDetail(data.detailLevel);
  const fullDetail = fixedDetail === 'full';
  const mapMode = zoomTier !== 'work';

  // ── Paradigm run semantics (instantiated human/prompt steps) ──
  const isHuman = data.stepKind === 'human';
  // Awaiting its own question (empty ask node / human turn): shared
  // predicate — the focus panel derives the same state from it.
  const awaiting = awaitingInput(data);
  const isAwaitingHuman = awaiting === 'human';
  // A prompt step that hasn't started yet — the cascade runs it once all its
  // structural parents complete (triggerParadigmCascade in store/streaming).
  const isWaitingUpstream = data.stepKind === 'prompt' && !data.response && !data.isLoading && !data.generationFailed;
  const isParadigmNode = isHuman || data.stepKind === 'prompt';
  const isAwaitingAsk = awaiting === 'ask';
  const isFailedQuestion = awaiting === 'failed';
  const isQuestionComposer = isAwaitingAsk || isFailedQuestion;
  const questionEditActive = data.isEditing && data.questionEditor !== 'panel';
  // Unsent and failed questions keep a composer on both surfaces. Editor ownership
  // controls focus and zoom protection, not whether a draft looks sent.
  const editingQuestionHere = !isViewerMode && (!!awaiting || questionEditActive);
  const editingResponseHere = data.isEditingResponse && data.responseEditor !== 'panel';
  // While any paradigm step is incomplete the run is in progress: structure
  // is fixed (no follow-ups, no deletion) until the performance finishes.
  const runLocked = useStore((s) => isParadigmNode && isRunLocked(s.nodes));
  // Detail and selection never own an editing session. Only active editors
  // pin the working card; an idle draft (including an unsent first question)
  // follows the shared zoom tier. Live workflow/approval cards stay visible.
  const hasOpenQuestion = !!data.isLoading && (data.pendingApprovals ?? []).some((p) => !p.answered);
  const protectWorkingCard = questionEditActive || editingResponseHere || metadataEditing
    || hasOpenQuestion || (isParadigmNode && runLocked);
  const isCollapsed = data.isCollapsed && !fullDetail && !protectWorkingCard;
  const zoomedOut = mapMode && !protectWorkingCard;
  const overview = zoomedOut || isCollapsed;
  const viewHeight = useStableNodeViewHeight(nodeRef, !overview && configuredHeight == null,
    [id, data.question, data.response, data.responseIndex, data.isLoading, overview], configuredWidth,
    !!(metadataEditing || questionEditActive || editingResponseHere));
  // Glyph tier: the node collapses to one seal — the thinking's skeleton
  const glyphTier = zoomTier === 'glyph' && zoomedOut;
  // Handles move to hug the seal at glyph tier — tell React Flow to re-measure
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [glyphTier, zoomedOut, isCollapsed, metadataEditing, configuredWidth, configuredHeight, id, updateNodeInternals]);
  const contentCeiling = useRef<{ question: string; response: string; responseIndex: number; width: number | undefined; height: number } | undefined>(undefined);
  useLayoutEffect(() => {
    // Live tails and textareas intentionally bound their own content. Resume
    // the complete-reading limit when the turn or editing session settles.
    const canLimit = !data.isLoading && !editingQuestionHere && !editingResponseHere && !metadataEditing;
    const unregister = registerNodeContentHeightMeasure(id, width => canLimit
      ? measureConversationContentHeight(nodeRef.current, width) : undefined);
    const root = nodeRef.current;
    if (!root || !canLimit || zoomedOut || isCollapsed) return unregister;
    const previous = contentCeiling.current;
    if (!previous || previous.question !== data.question || previous.response !== data.response
      || previous.responseIndex !== data.responseIndex || previous.width !== configuredWidth) {
      contentCeiling.current = { question: data.question, response: data.response, responseIndex: data.responseIndex, width: configuredWidth, height: 0 };
    }
    const normalize = () => {
      const measured = measureConversationContentHeight(root);
      if (measured === undefined) return;
      // A closed disclosure is a view state, not shorter saved prose. Keep
      // the largest limit observed for this content and width so collapsing
      // highlights, reasoning or activity cannot permanently shrink the card.
      const ceiling = contentCeiling.current!;
      ceiling.height = Math.max(ceiling.height, 240, measured);
      const limit = ceiling.height;
      // Existing saved sizes obey the same content ceiling as new resizes.
      // Reconcile the active history baseline too: normalization must not
      // become a dirty undo step that immediately repeats itself.
      useStore.getState().normalizeNodeContentHeight(id, limit);
    };
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = undefined; normalize(); });
    });
    observer.observe(root);
    for (const element of root.querySelectorAll<HTMLElement>(':scope > *, [data-conversation-split="node"], .conversation-split-content')) observer.observe(element);
    // Wait until the split has reconciled its new panes after a content
    // change; an intermediate layout must not become the saved ceiling.
    frame = requestAnimationFrame(() => { frame = undefined; normalize(); });
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      unregister();
    };
  }, [id, data.question, data.response, data.responseIndex, data.isLoading, editingQuestionHere, editingResponseHere, metadataEditing, zoomedOut, isCollapsed, configuredWidth, customStyleHeight]);
  // Upstream changed since this answer was written (see recomputeStaleness)
  const isStale = useStore((s) => s.staleIds.includes(id) && !staleHiddenByJudge(s, id));
  const staleVerdict = useStore((s) => currentStaleVerdict(s, id));
  const staleTitle = staleVerdict ? fmt(t('node.staleJudged'), { p: staleVerdict.p.toFixed(2) }) : t('node.staleTitle');
  // Lit while its condense-dialog segment row is hovered — the list points,
  // the canvas answers.
  const condenseLit = useUiStore((s) => s.condenseHighlightIds.includes(id));
  // Page-anchored questions wear a p.N chip that reopens the reader right
  // there — the material node this question grew from is the reader target
  const anchorMaterialId = useStore((s) => {
    if (!data.anchor) return null;
    const attachmentSource = data.anchor.attId && s.nodes.find((n) =>
      n.data.attachments?.some((attachment) => attachment.id === data.anchor?.attId));
    if (attachmentSource) return attachmentSource.id;
    const e = s.edges.find((e) =>
      e.target === id && !e.data?.isCrossLink &&
      s.nodes.some((n) => n.id === e.source && (n.data.stepKind === 'file' || n.data.stepKind === 'link' || n.data.stepKind === 'note')));
    return e?.source ?? null;
  });
  const openReaderAtAnchor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.anchor || !anchorMaterialId) return;
    useUiStore.getState().setReaderNodeId(anchorMaterialId, { page: data.anchor.page, attachmentId: data.anchor.attId, threadId: id });
  };

  // Sync local edit buffer when the response changes externally (streaming, undo)
  const [prevResponse, setPrevResponse] = useState(data.response);
  if (prevResponse !== data.response) {
    setPrevResponse(data.response);
    setEditResponseValue(data.response);
  }

  // React Flow mounts new nodes visibility:hidden until measured, so the
  // textarea's autoFocus fires against a hidden element and is dropped.
  // Re-focus an explicitly opened first question after measurement. Idle
  // empty nodes must not claim focus when zoom or viewport culling remounts them.
  useEffect(() => {
    if ((!isAwaitingAsk && !isAwaitingHuman) || !questionEditActive) return;
    const focusAtActivation = document.activeElement;
    // Activating the composer through one of its controls must leave focus
    // on that control rather than closing its menu on the next frame.
    if (focusAtActivation && questionEditorRef.current?.contains(focusAtActivation)) return;
    let frame: number;
    const focusWhenVisible = () => {
      const input = questionTaRef.current;
      if (!input || getComputedStyle(input).visibility === 'hidden' || !input.getClientRects().length) {
        frame = requestAnimationFrame(focusWhenVisible);
        return;
      }
      if (document.activeElement !== focusAtActivation && document.activeElement !== document.body) return;
      input.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(focusWhenVisible);
    return () => cancelAnimationFrame(frame);
  }, [isAwaitingAsk, isAwaitingHuman, questionEditActive]);

  const highlighter = useTextHighlighter({
    scopeKey: `${id}:${data.responseIndex}:${data.response}`,
    enabled: !isViewerMode && !!data.response && !data.isLoading && !data.isEditingResponse && !zoomedOut && !isCollapsed,
    surfaceRef: responseRef,
  });
  const { markSelection } = highlighter;
  const handleTextSelection = useCallback((event: MouseEvent) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, input, textarea'))) return;
    if (!(event.target instanceof Node) || !responseRef.current?.contains(event.target)) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (selection && range && selection.toString().trim().length > 0
      && responseRef.current?.contains(range.startContainer) && responseRef.current.contains(range.endContainer)) {
      markSelection(selection, id);
    }
  }, [id, markSelection]);

  useEffect(() => {
    if (!highlighter.active) return;
    document.addEventListener('mouseup', handleTextSelection);
    return () => document.removeEventListener('mouseup', handleTextSelection);
  }, [handleTextSelection, highlighter.active]);

  const handleDoubleClickQuestion = (e: React.MouseEvent) => {
    e.stopPropagation(); // inline edit, not the panel
    if (isViewerMode) return;
    // Editing mid-generation is ambiguous by design: stop first, then edit.
    if (data.isLoading) { toast('info', t('question.lockedWhileGenerating')); return; }
    setEditValue(useUiStore.getState().drafts[questionEditKey] ?? data.question);
    setEditing(id, true);
  };

  // Editing an answer is a BUTTON, not a double-click: double-click is the
  // system's select-a-word gesture, and hijacking it made selecting text
  // inside answers a trap. The button lives with regenerate/copy.
  const startEditResponse = () => {
    if (isViewerMode) return;
    const draft = useUiStore.getState().drafts[responseEditKey] ?? data.response;
    setEditResponseValue(draft);
    useUiStore.getState().setDraft(responseEditKey, draft, true);
    setEditingResponse(id, true);
  };

  const cancelQuestionEdit = () => {
    useUiStore.getState().setDraft(questionEditKey, '');
    setEditing(id, false);
  };
  const cancelResponseEdit = () => {
    useUiStore.getState().setDraft(responseEditKey, '');
    setEditingResponse(id, false);
  };
  const questionDismiss = useInlineEditDismiss({
    active: !!questionEditActive,
    ref: questionEditorRef,
    onOutside: () => setEditing(id, false),
    onCancel: () => {
      if (!awaiting) { cancelQuestionEdit(); return; }
      // A persistent generation input loses focus, never its unsent draft.
      setEditing(id, false);
      if (document.activeElement instanceof HTMLElement && questionEditorRef.current?.contains(document.activeElement)) document.activeElement.blur();
    },
    restoreFocus: awaiting ? false : undefined,
    independentOutside: !!awaiting,
    ignoreOutside: event => isGeometryControl(event.target),
    ignoreFocusOutside: isGeometryControl,
  });
  const responseDismiss = useInlineEditDismiss({
    active: !!editingResponseHere,
    ref: responseEditorRef,
    onOutside: () => setEditingResponse(id, false),
    onCancel: cancelResponseEdit,
    ignoreOutside: event => isGeometryControl(event.target),
    ignoreFocusOutside: isGeometryControl,
  });
  const handleEditSubmit = () => {
    if (!editValue.trim() || condenseGuard()) return;
    useUiStore.getState().setDraft(questionEditKey, '');
    // Successful answers stay intact on an unchanged revision; a failed
    // attempt can explicitly resend the same question.
    if (!data.generationFailed && editValue.trim() === data.question) { setEditing(id, false); return; }
    if (isHuman) {
      // Human turn: record the question only — no generation on this node;
      // downstream prompt steps answer (and the cascade advances).
      submitHumanTurn(id, editValue.trim());
    } else {
      editQuestion(id, editValue.trim());
    }
  };

  const handleResponseEditSubmit = () => {
    editResponse(id, editResponseValue);
    useUiStore.getState().setDraft(responseEditKey, '');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || isImeComposing(e)) return;
    // Both surfaces keep multiline questions and explicit submission alike.
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); handleEditSubmit(); }
  };

  const autoGrowTa = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(400, el.scrollHeight)}px`;
  };

  const handleResponseEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isImeComposing(e)) {
      e.preventDefault();
      handleResponseEditSubmit();
    }
  };

  const isStart = useStore(s => isConversationStart(id, s.edges));
  const hasMultipleVersions = data.responses.length > 1;

  const highlightedTexts = new Set(data.highlights.map((h) => h.text));
  const handleCitationClick = (event: React.MouseEvent) => {
    if (highlighter.active || window.getSelection()?.toString()) return;
    const target = (event.target as HTMLElement).closest?.('[data-node-cite]')?.getAttribute('data-node-cite');
    const cited = target ? rf.getNode(target) : undefined;
    if (!target || !cited) return;
    event.stopPropagation();
    setSelectedNodeId(target);
    rf.setCenter(cited.position.x + 260, cited.position.y + 110, { zoom: rf.getZoom(), duration: 300 });
  };
  // The canvas overview leads with a name; summaries are quiet close-range previews.
  const versionSummary = data.displaySummary ?? activeSummary(data);
  const namingData = isAwaitingAsk ? { ...data, question: editValue } : data;
  const nameFallback = t(isAwaitingAsk ? 'node.unsentQuestion' : 'panel.question');
  const nodeName = getNodeDisplayName(namingData, nameFallback);
  const nodeNameSource = getNodeNameSource(namingData, nameFallback);
  const takeawayType = data.summaryTypes?.[data.responseIndex] ?? undefined;
  const takeawayConfidence = data.summaryTypeConfidences?.[data.responseIndex] ?? undefined;
  const conclusive = data.summaryConclusiveness?.[data.responseIndex] ?? undefined;
  const conclusiveNote = conclusive !== undefined ? fmt(t('takeaway.conclusive'), { l: t(`takeaway.level${conclusive}` as Parameters<typeof t>[0]) }) : undefined;
  // Reasoning of the ACTIVE version (models that emit it); display only
  const versionReasoning = data.reasonings?.[data.responseIndex] ?? undefined;
  // Only the rare, high-signal moves wear a badge — a map where every node
  // has one is a map where none do. insight = the unmarked default.
  const TYPE_BADGE: Record<string, { glyph: string; cls: string; solid: string; key: string; nudge?: string }> = {
    ruleout: { glyph: '✕', cls: 'text-red-500 bg-red-50', solid: 'bg-red-500 text-white', key: 'takeaway.ruleout' },
    // ⚖'s ink sits low in its em box (tall ascent, glyph rides the baseline),
    // so a centered line box leaves it optically LOW — nudge up to visual
    // center (pixel-measured on macOS system fonts; em unit tracks font size)
    decision: { glyph: '⚖', cls: 'text-accent bg-accent/10', solid: 'bg-action text-white', key: 'takeaway.decision', nudge: 'block -translate-y-[0.08em]' },
    pivot: { glyph: '↩', cls: 'text-warm bg-warm/10', solid: 'bg-warm text-white', key: 'takeaway.pivot' },
    open: { glyph: '?', cls: 'text-amber-600 bg-amber-500/10', solid: 'bg-amber-500 text-white', key: 'takeaway.open' },
    // glyph tier only: steps WITH a takeaway spark; plain steps stay dots
    insight: { glyph: '✦', cls: 'text-sky-600 bg-sky-500/10', solid: 'bg-sky-500 text-white', key: 'takeaway.insight' },
  };
  const badge = takeawayType && takeawayType !== 'insight' && TYPE_BADGE[takeawayType] ? TYPE_BADGE[takeawayType] : null;
  const badgeTitle = badge ? [takeawayConfidence !== undefined ? `${t(badge.key as Parameters<typeof t>[0])} · ${fmt(t('takeaway.judged'), { p: takeawayConfidence.toFixed(2) })}` : t(badge.key as Parameters<typeof t>[0]), conclusiveNote].filter(Boolean).join(' · ') : undefined;
  // The glyph seal: typed moves keep their seal; insight sparks.
  // Everything else is a neutral waypoint dot.
  const glyphSeal = takeawayType && TYPE_BADGE[takeawayType]
    ? TYPE_BADGE[takeawayType]
    : (versionSummary ? TYPE_BADGE.insight : null);
  // Stale compact cards keep the warning on their named outline.
  // "Continue last thread" hover: this node is the flight destination
  const isBeacon = useUiStore((s) => s.beaconNodeId === id);
  // Reduced representations fit their content. Full cards retain their
  // footprint while temporary editors and disclosures change their contents.
  const fixedHeight = !overview ? configuredHeight ?? viewHeight.height : undefined;
  const splitEnabled = !isHuman && !isAwaitingAsk && !!(data.response || data.isLoading || editingResponseHere || data.generationFailed || activity.length);

  return (
    <div
      ref={nodeRef}
      style={{ width: configuredWidth ?? 520, height: fixedHeight }}
      data-thought-natural-height={overview || undefined}
      data-node-detail-level={overview ? (glyphTier ? 'compact' : 'summary') : 'full'}
      data-node-overview-surface={overview ? (glyphTier ? 'compact' : 'summary') : undefined}
      data-node-overview-kind={overview ? (isHuman ? 'human' : isStart ? 'start' : 'thought') : undefined}
      data-node-stale={isStale || undefined}
      data-node-detail-locked={data.detailLevel || undefined}
      data-thought-resized={fixedHeight != null || undefined}
      data-awaiting-ask={isAwaitingAsk || undefined}
      onPointerDownCapture={viewHeight.capture}
      onKeyDownCapture={event => { if (event.key === 'Enter' || event.key === ' ') viewHeight.capture(); }}
      onClickCapture={viewHeight.capture}
      onDoubleClickCapture={viewHeight.capture}
      className={glyphTier
        ? `animate-fade-in ${isBeacon ? 'beacon-node ' : ''}${data.archived ? 'opacity-35 saturate-50 ' : ''}${selected || selectedNodeId === id ? 'glyph-selected ' : ''}`
        : `thought-node conversation-node relative flex flex-col rounded-node animate-fade-in ${isBeacon ? 'beacon-node ' : ''}${zoomedOut ? 'map-node ' : ''}${condenseLit ? 'condense-lit ' : ''}${data.archived ? 'opacity-35 saturate-50 ' : ''}${isWaitingUpstream ? 'opacity-60 ' : ''}${
        isHuman ? 'human-node' : isStart ? 'root-node' : 'conversation-step-node'
      } ${data.isLoading ? 'loading-border' : ''} ${selected || selectedNodeId === id ? 'node-selected' : ''} ${isDropTarget ? 'node-drop-target' : ''}`}
      onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setSelectedNodeId(id); }}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDropTarget(false);
        for (const file of Array.from(e.dataTransfer.files)) {
          await processFile(file, {
            add: (att) => addAttachment(id, att),
            update: (attId, patch) => useStore.getState().setAttachmentData(id, attId, patch),
          });
        }
        setSelectedNodeId(id);
      }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDropTarget(true); }}
      onDragLeave={() => setIsDropTarget(false)}
    >
      {!isViewerMode && (selected || selectedNodeId === id) && !zoomedOut && !isCollapsed && (
        <NodeResizeControls id={id} />
      )}
      {data.focusRole === 'down' && !glyphTier && (
        // Context Focus: floating corner tag — the card may have no meta
        // row yet (unanswered follow-up), so it cannot live there
        <span className="absolute -top-2.5 right-4 z-10 text-control text-accent/80 bg-card border border-line rounded-tag px-2 py-px whitespace-nowrap" data-focus-down>
          {t('focus.downstream')}
        </span>
      )}
      <NodeConnectionHandles id={id} large={overview} />

      {/* Stale dot pins to the CARD's corner — at glyph tier the card is
          gone (one centered seal), so the seal wears an amber ring instead
          of a dot floating where the card used to be */}
      {isStale && zoomedOut && !glyphTier && (
        <span className="absolute top-2.5 right-2.5 w-3.5 h-3.5 rounded-full bg-amber-500 z-10" role="img" aria-label={staleTitle} data-stale-dot />
      )}
      {glyphTier ? (
        <div
          className="drag-handle w-full"
          data-glyph-node
          data-node-details-header
          data-node-stale={isStale || undefined}
        >
          <NodeOverview
            name={nodeName}
            action={<NodeDetailsButton nodeId={id} />}
            source={nodeNameSource}
            compact
            variant={isStart ? 'start' : 'thought'}
            icon={data.generationFailed ? <AlertTriangle className="text-red-600" /> : data.isLoading ? <Hourglass /> : data.digestOf ? <BookOpen /> : glyphSeal ? <span role="img" aria-label={badgeTitle} className={glyphSeal.cls}>{glyphSeal.glyph}</span> : undefined}
          />
        </div>
      ) : (
      <>
      {/* Header */}
      <div data-node-details-header className="thought-node-header shrink-0 flex items-center justify-between gap-related px-surface-inset py-related border-b border-line drag-handle">
        <div className="node-header-status flex flex-wrap items-center gap-2 min-w-0">
          <button onClick={() => zoomedOut ? setNodeDetail(id, 'full') : fullDetail ? setNodeDetail(id, 'summary') : toggleCollapse(id)}
            aria-label={t(zoomedOut || isCollapsed ? 'node.expandCard' : 'node.collapseCard')} className={`nodrag nopan rounded-control w-7 h-7 flex items-center justify-center transition-colors text-body font-bold ${
            isHuman ? 'text-warm bg-warm/10 hover:bg-warm/15'
                : isStart || isCollapsed ? 'text-accent bg-accent/10 hover:bg-accent/15'
                  : 'text-ink-faint hover:bg-wash'
          }`}>
            {zoomedOut || isCollapsed ? <ChevronRight size={18} strokeWidth={1.75} /> : <ChevronDown size={18} strokeWidth={1.75} />}
          </button>
          <NodeTokenUsage data={data} />
          <NodeContextSources nodeId={id} />
          {data.condensedFrom && data.condensedFrom.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                // provenance travels by chip, context by wires: highlight the
                // original run and glide the viewport onto it
                const src = useStore.getState().nodes.filter((n) => data.condensedFrom!.includes(n.id));
                if (src.length === 0) return;
                useUiStore.getState().setCondenseHighlightIds(data.condensedFrom!);
                const xs = src.map((n) => n.position.x), ys = src.map((n) => n.position.y);
                rf.fitBounds({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) + 520 - Math.min(...xs), height: Math.max(...ys) + 240 - Math.min(...ys) }, { duration: 350, padding: 0.2 });
                window.setTimeout(() => useUiStore.getState().setCondenseHighlightIds([]), 2600);
              }}

              data-condensed-from
              className="nodrag nopan text-control bg-accent/10 text-accent hover:bg-accent/20 px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium transition-colors"
            >
              <Minimize2 size={11} strokeWidth={1.75} /> {fmt(t('node.condensedFrom'), { n: String(data.condensedFrom.length) })}
            </button>
          )}
          {isStale && !data.isLoading && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!isViewerMode) void rerunNode(id); }}

              data-stale-badge
              className="nodrag nopan text-control bg-amber-500/10 text-amber-600 hover:bg-amber-500/25 px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium transition-colors"
            >
              <RefreshCw size={11} strokeWidth={1.75} /> {t('node.staleBadge')}
            </button>
          )}
          {data.archived && (
            <span className="text-control bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium" data-tooltip={t('archive.badgeTitle')}>
              <Archive size={11} strokeWidth={1.75} /> {t('archive.badge')}
            </span>
          )}
          {isHuman && (
            <span className="text-control bg-warm/10 text-warm px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium">
              <UserRound size={11} strokeWidth={1.75} /> {isAwaitingHuman ? t('paradigm.yourTurn') : t('paradigm.kind.human')}
            </span>
          )}
          {isWaitingUpstream && (
            <span className="text-control bg-wash text-ink-faint px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium">
              <Hourglass size={11} strokeWidth={1.75} /> {t('paradigm.waitingUpstream')}
            </span>
          )}
          {!isHuman && <NodeExecutionBadge data={data} />}
          {(() => {
            // The chip answers "who wrote THIS answer" — the actual model
            // recorded at generation time, following version paging. The
            // per-node pin (data.model) is only the fallback before any
            // answer exists; when both are known and differ, the tooltip
            // names the pin so the next generation holds no surprise.
            const gen = data.generatedBy?.[data.responseIndex] ?? undefined;
            const label = gen ?? data.model;
            if (!label) return null;
            const pinNote = gen && data.model && data.model !== gen
              ? `\n${fmt(t('node.pinnedModel'), { m: data.model })}`
              : '';
            return (
              <span className="text-meta bg-wash text-ink-muted px-1.5 py-0.5 rounded-tag font-mono truncate max-w-[130px]" data-tooltip={`${label}${pinNote}`}>
                {label.split('/').pop()}
              </span>
            );
          })()}
        </div>
        <div className="nodrag nopan flex shrink-0 items-center gap-0.5">
          <NodeDetailsButton nodeId={id} />
          {data.isLoading && (
            <button
              onClick={(e) => { e.stopPropagation(); stopGeneration(id); }}
              aria-label={t('actions.stop')}
              className="text-white bg-red-500 hover:bg-red-600 rounded-control w-7 h-7 flex items-center justify-center transition-colors"
            >
              <Square size={10} strokeWidth={1.75} fill="currentColor" />
            </button>
          )}
          {!(isParadigmNode && runLocked) && !isViewerMode && (
            <button onClick={() => deleteNode(id)} className="rounded-control w-7 h-7 flex items-center justify-center transition-colors object-action-danger" data-icon-only aria-label={t('actions.deleteNode')}>
              <Trash2 size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      <NodeMetadataEditor id={id} data={data} name={nodeNameSource}
        preview={versionSummary ?? (data.importSource ? conclusionOf(data.response) : data.response)}
        overview={zoomedOut || isCollapsed} open={metadataEditing} onOpenChange={setMetadataEditing} />

      {!isCollapsed && !zoomedOut && (data.response || data.highlights.length > 0) && (
        <NodeHighlightsSection nodeId={id} highlights={data.highlights} highlightMode={data.highlightMode}
          highlighter={highlighter} canHighlight={!!data.response && !data.isLoading && !data.isEditingResponse} />
      )}

      {!isCollapsed && !zoomedOut && (
        <div className={`p-surface-inset min-h-0 ${splitEnabled ? 'conversation-node-split-body' : fixedHeight != null ? 'flex-1 overflow-y-auto nowheel' : ''} nodrag nopan`} data-thought-body data-conversation-split-body={splitEnabled || undefined}>
          <ConversationSplit nodeId={id} surface="node" enabled={splitEnabled} question={<>
          {data.anchor && anchorMaterialId && (
            <button onClick={openReaderAtAnchor}
              data-tooltip={fmt(t('node.openAtPage'), { n: data.anchor.page })}
              className="mb-2 text-control font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded-tag px-1.5 py-0.5 transition-colors">
              p.{data.anchor.page}
            </button>
          )}
          {/* Question */}
          {editingQuestionHere ? (
            <div ref={questionEditorRef} onBlur={questionDismiss.onBlur}
              onFocusCapture={() => { if (awaiting && !questionEditActive) setEditing(id, true); }}
              className={isQuestionComposer ? 'node-question-composer' : undefined}>
              {isQuestionComposer && <NodeExecutionPicker nodeId={id} />}
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onInput={(e) => autoGrowTa(e.currentTarget)}
                ref={(el) => { questionTaRef.current = el; autoGrowTa(el); }}
                placeholder={data.instruction || (isQuestionComposer ? t('node.askPlaceholder') : undefined)}
                aria-label={t('panel.question')}
                data-canvas-question-editor
                className={isQuestionComposer ? 'node-ask-textarea nodrag nopan nowheel' : `w-full bg-wash border rounded-control p-3 text-body text-ink resize-none focus:outline-none focus:ring-2 ${
                  isHuman ? 'border-warm focus:ring-warm/20' : 'border-accent focus:ring-accent/20'
                }`}
                rows={2}
                autoFocus={!!questionEditActive}
              />
              {/* A fresh node is a landing page in a card: the same per-ask
                  switches (web, scholar, recall) sit under its question, so
                  the first ask can open a door without leaving the card.
                  The switches belong to this editor's interaction boundary. */}
              {isQuestionComposer && (
                <div className="node-ask-actions nodrag nopan" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <div className="flex min-w-0 flex-wrap items-center gap-1" data-ask-toggles>
                    <SearchToggles nodeId={isFailedQuestion ? id : undefined} executionNodeId={id} size={16} />
                  </div>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleEditSubmit}
                    disabled={!editValue.trim()} aria-label={t('common.send')}
                    className="node-ask-send" data-ask-submit>
                    <Send size={16} strokeWidth={1.75} />
                  </button>
                </div>
              )}
              {/* Revision confirms explicitly: visible exits instead of an
                  invisible Enter contract. mousedown-preventDefault keeps the
                  textarea's blur from racing the click. */}
              {!isHuman && !isQuestionComposer && (
                <div className="flex items-center justify-end gap-2 mt-1.5">
                  {/* the node's own switches (what a re-ask runs with), editable
                      here; mousedown is defaulted away so the textarea keeps
                      focus, and stopped so the click never selects the node */}
                  <div className="mr-auto flex items-center gap-1 nodrag nopan" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={(e) => e.stopPropagation()} data-edit-toggles>
                    <SearchToggles nodeId={id} size={15} />
                  </div>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={cancelQuestionEdit}
                    className="text-control text-ink-muted hover:text-red-500 hover:bg-wash px-3 py-1.5 rounded-control transition-colors flex items-center gap-1"
                    data-edit-cancel
                  >
                    <X size={12} strokeWidth={2} /> {t('question.editCancel')}
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleEditSubmit}
                    disabled={!editValue.trim()}
                    className="text-control bg-action hover:bg-action-strong disabled:opacity-30 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded-control transition-colors flex items-center gap-1.5"
                    data-edit-submit
                  >
                    <Check size={12} strokeWidth={2.25} /> {t('question.editSubmit')}
                  </button>
                </div>
              )}
              {isHuman && (
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={handleEditSubmit}
                    disabled={!editValue.trim()}
                    className="text-control bg-warm hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-control transition-all flex items-center gap-1.5"
                  >
                    <Send size={12} strokeWidth={1.75} /> {t('paradigm.start')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            // The split pane owns question scrolling; pending turns retain
            // their original bounded reading area.
            <div className="conversation-question" data-conversation-question>
            <div
              onDoubleClick={handleDoubleClickQuestion}
              className={`conversation-user-message question-md markdown-body cursor-text ${splitEnabled ? '' : 'max-h-[180px] overflow-y-auto'} nowheel nopan`}
            >
              {/* a question is markdown like an answer (lists, code, emphasis), set compact; the plaques above keep the plain text */}
              <Markdown base={data.agentSession?.cwd ?? data.importSource?.cwd} diagrams="placeholder">{originalQuestionBeforeInstructions(data.question, activity)}</Markdown>
            </div>
            {!isViewerMode && <div className="conversation-question-tools"><button onClick={handleDoubleClickQuestion} aria-label={t(hasQuestionDraft ? 'edit.resumeDraft' : 'actions.editQuestion')} data-tooltip={hasQuestionDraft ? t('edit.resumeDraft') : undefined} disabled={data.isLoading} data-edit-question className="w-6 h-6 shrink-0 rounded-control flex items-center justify-center text-ink-faint hover:text-accent hover:bg-wash disabled:opacity-30"><Pencil size={13} /></button></div>}
            </div>
          )}

          </>} answer={<>
          {!data.isLoading && activity.length > 0 && <AgentActivityView key={`${id}:${data.responseIndex}`} entries={activity} compact base={data.agentSession?.cwd ?? data.importSource?.cwd} failed={data.generationFailed} />}
          {data.isLoading && !!data.pendingApprovals?.length && (
            <div className="flex flex-col gap-1.5">
              {data.pendingApprovals.map((req) => <ApprovalCard key={req.id} nodeId={id} request={req} compact />)}
            </div>
          )}
          {/* Response — a human turn / pending ask has none by design; a
              waiting prompt step shows its pending state instead of an empty box */}
          {isHuman || isAwaitingAsk ? null : isWaitingUpstream ? (
            <div className="border-2 border-dashed border-line rounded-content py-3 px-3 text-control text-ink-faint flex items-center gap-2">
              <Hourglass size={13} strokeWidth={1.75} /> {t('paradigm.waitingUpstream')}
            </div>
          ) : data.isLoading ? (
            activity.length > 0 ? (
              <AgentActivityView entries={activity} running compact base={data.agentSession?.cwd ?? data.importSource?.cwd} />
            ) : data.agentTrace && data.agentTrace.length > 0 && (!data.response || data.restreaming) ? (
              // An agent's steps and, between them, the model's thinking: the
              // trace alone reads as a tool log; the thinking says what it is
              // for. Live tail only — the whole text opens on the finished node.
              <div className="flex flex-col gap-1.5">
                <AgentTrace entries={data.agentTrace} compact />
                {data.reasoning && (
                  <div className="px-3 py-2 bg-wash/70 rounded-content max-h-[96px] overflow-hidden flex flex-col justify-end" data-node-reasoning-live>
                    <div className="text-control text-ink-faint mb-0.5">💭 {t('node.reasoningLive')}</div>
                    <div className="text-body text-ink-muted italic whitespace-pre-wrap break-words">
                      {data.reasoning.length > 200 ? '…' + data.reasoning.slice(-200) : data.reasoning}
                    </div>
                  </div>
                )}
              </div>
            ) : data.response && !data.restreaming ? (
              // Streaming: show the live tail of the response on the canvas.
              // While the "response" is still a tool's placeholder line
              // (the answer has not started), the thinking that led to the
              // tool stays visible beneath it.
              <div className="flex flex-col gap-1.5">
                <div data-conversation-answer className="conversation-answer text-body text-ink max-h-[180px] overflow-hidden flex flex-col justify-end whitespace-pre-wrap break-words">
                  {data.response.length > 400 ? '…' + data.response.slice(-400) : data.response}
                  <span className="inline-block w-2 h-4 bg-accent animate-pulse rounded-none" />
                </div>
                {data.reasoning && TOOL_PLACEHOLDER.test(data.response) && (
                  <div className="px-3 py-2 bg-wash/70 rounded-content max-h-[96px] overflow-hidden flex flex-col justify-end" data-node-reasoning-live>
                    <div className="text-control text-ink-faint mb-0.5">💭 {t('node.reasoningLive')}</div>
                    <div className="text-body text-ink-muted italic whitespace-pre-wrap break-words">
                      {data.reasoning.length > 200 ? '…' + data.reasoning.slice(-200) : data.reasoning}
                    </div>
                  </div>
                )}
              </div>
            ) : data.reasoning ? (
              // Reasoning models think before they answer — show the live
              // tail of the thinking, visually quieter than an answer
              <div className="px-3 py-2.5 bg-wash/70 rounded-content max-h-[140px] overflow-hidden flex flex-col justify-end" data-node-reasoning-live>
                <div className="text-control text-ink-faint mb-1">💭 {t('node.reasoningLive')}</div>
                <div className="text-body text-ink-muted italic whitespace-pre-wrap break-words">
                  {data.reasoning.length > 300 ? '…' + data.reasoning.slice(-300) : data.reasoning}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-body text-ink-muted">
                <span className="animate-pulse text-accent">●</span> {t('common.thinking')}
              </div>
            )
          ) : editingResponseHere ? (
            <div ref={responseEditorRef} onBlur={responseDismiss.onBlur}>
              <textarea
                value={editResponseValue}
                onChange={(e) => { setEditResponseValue(e.target.value); useUiStore.getState().setDraft(responseEditKey, e.target.value, true); }}
                onKeyDown={handleResponseEditKeyDown}
                aria-label={t('panel.response')}
                data-canvas-response-editor
                className="w-full bg-wash border border-accent rounded-control p-3 text-body text-ink resize-y focus:outline-none focus:ring-2 focus:ring-accent/20 min-h-[100px]"
                rows={6}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={cancelResponseEdit} className="text-control text-ink-muted hover:text-ink px-3 py-1.5 rounded-control hover:bg-wash transition-colors">{t('common.cancel')}</button>
                <button onClick={handleResponseEditSubmit} className="text-control bg-action hover:bg-action-strong text-white px-4 py-1.5 rounded-control transition-colors">{t('common.save')}</button>
              </div>
            </div>
          ) : (
            <>
            {versionReasoning && !activity.length && (
              <ReasoningDisclosure text={versionReasoning} />
            )}
            <div
              ref={responseRef}
              onClick={handleCitationClick}
              data-conversation-answer
              data-highlighter-active={highlighter.active || undefined}
              className={`conversation-answer markdown-body text-body text-ink ${!splitEnabled && fixedHeight == null ? 'max-h-[400px] overflow-y-auto' : ''} cursor-text nopan nodrag nowheel`}
            >
              {highlightedTexts.size > 0 ? (
                <HighlightedMarkdown base={data.agentSession?.cwd ?? data.importSource?.cwd} content={data.response} highlights={highlightedTexts} diagrams="placeholder" />
              ) : (
                <Markdown base={data.agentSession?.cwd ?? data.importSource?.cwd} diagrams="placeholder">{data.response}</Markdown>
              )}
            </div>
            </>
          )}

          {/* Web references consulted for this response (compact) */}
          {(data.references?.length ?? 0) > 0 && !data.isLoading && !data.isEditingResponse && (
            <div className="mt-2 px-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-control text-ink-faint">
              <Globe size={11} strokeWidth={1.75} className="shrink-0" />
              {data.references!.slice(0, 3).map((r, i) =>
                r.url ? (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-accent/80 hover:text-accent hover:underline nopan">
                    [{i + 1}] {r.title.length > 44 ? r.title.slice(0, 44) + '…' : r.title}
                  </a>
                ) : (
                  <span key={i}>[{i + 1}] {r.title.slice(0, 44)}</span>
                )
              )}
              {data.references!.length > 3 && <span>+{data.references!.length - 3}</span>}
            </div>
          )}

          {/* Response action row — LLM-chat convention: the actions that act
              on THIS answer live right under it (regenerate = new version in
              place; the sibling-branch variant lives in the panel's ⋯ menu) */}
          {data.response && !data.isLoading && !editingResponseHere && !isHuman && !isAwaitingAsk && !data.generationFailed && (
            <div className="conversation-actions mt-1.5 flex flex-wrap items-center gap-0.5 text-ink-faint">
              {!isViewerMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); void rerunNode(id); }}
                  className="rounded-control w-6 h-6 flex items-center justify-center transition-colors hover:text-accent hover:bg-wash"
                  data-tooltip={t('common.regenerate')}
                  aria-label={t('common.regenerate')}
                >
                  <RefreshCw size={14} strokeWidth={1.75} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); void copyText(data.response); }}
                className="rounded-control w-6 h-6 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
                aria-label={t('actions.copyResponse')}
                data-tooltip={t('actions.copyResponse')}
              >
                <ClipboardCopy size={13} strokeWidth={1.75} />
              </button>
              {!isViewerMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); startEditResponse(); }}
                  className="rounded-control w-6 h-6 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
                  aria-label={t(hasResponseDraft ? 'edit.resumeDraft' : 'actions.editResponse')} data-tooltip={t(hasResponseDraft ? 'edit.resumeDraft' : 'actions.editResponse')}
                  data-edit-response
                >
                  <Pencil size={13} strokeWidth={1.75} />
                </button>
              )}
              <AgentRerunButton nodeId={id} data={data} />
              {data.focusRole === 'ctx' && (
                <span className="w-[7px] h-[7px] rounded-full bg-accent inline-block ml-1 shrink-0" data-tooltip={t('focus.inContext')} data-focus-dot />
              )}
              {(data.generatedBy?.[data.responseIndex]) && (
                <span
                  className="text-meta text-ink-faint font-mono ml-1 truncate flex-1 min-w-0 max-w-[260px]"

                >
                  {describeModel(data.generatedBy[data.responseIndex], data.generatedEfforts?.[data.responseIndex], { compact: true })}
                </span>
              )}
              {data.agentSession?.continued && (
                <span className="text-meta text-ink-faint ml-1 shrink-0"  data-agent-continued>↩ {t('agent.continued')}</span>
              )}
              {data.importSource?.runner === 'pi' && window.desktopSessions && (
                <button
                  onClick={(e) => { e.stopPropagation(); void window.desktopSessions!.openInCli('pi', data.importSource!.cwd ?? '', data.importSource!.sessionId, 'terminal'); }}
                  className="rounded-control w-6 h-6 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
                  data-tooltip={t('agent.openInTerminal')} aria-label={t('agent.openInTerminal')}
                  data-open-in-terminal
                >
                  <SquareTerminal size={13} strokeWidth={1.75} />
                </button>
              )}
              {data.gatewaySearches?.[data.responseIndex] && (
                <span className="text-meta text-ink-faint ml-1 shrink-0"  data-gateway-searched>
                  🌐 {t('node.gatewaySearched')}
                </span>
              )}
              {data.generatedAts?.[data.responseIndex] && (
                <span className="text-meta text-ink-faint font-mono ml-1 shrink-0"  data-generated-at>
                  {formatStamp(data.generatedAts[data.responseIndex]!)}
                </span>
              )}
              {hasMultipleVersions && (
                <div className="flex items-center gap-1 text-control text-ink-muted ml-1">
                  <button onClick={(e) => { e.stopPropagation(); navigateVersion(id, 'prev'); }} className="hover:text-accent hover:bg-wash rounded-control w-5 h-5 flex items-center justify-center transition-colors"><ChevronLeft size={14} strokeWidth={1.75} /></button>
                  <span className="text-accent font-medium">v{data.responseIndex + 1}/{data.responses.length}</span>
                  <button onClick={(e) => { e.stopPropagation(); navigateVersion(id, 'next'); }} className="hover:text-accent hover:bg-wash rounded-control w-5 h-5 flex items-center justify-center transition-colors"><ChevronRight size={14} strokeWidth={1.75} /></button>
                  {!isViewerMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteVersion(id, data.responseIndex); }}
                      className="rounded-control w-5 h-5 flex items-center justify-center transition-colors object-action-danger" data-icon-only
                      aria-label={t('common.deleteVersion')}
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Failure status; the question composer owns sending again. */}
          {data.generationFailed && !data.isLoading && (
            <div className="mt-2 flex items-center gap-2 text-control text-red-600 bg-red-50 border border-red-100 rounded-content px-3 py-2">
              <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" />
              {t('common.generationFailed')}
              {hasMultipleVersions && (
                <span className="flex items-center gap-1 text-ink-muted shrink-0" >
                  <button onClick={(e) => { e.stopPropagation(); navigateVersion(id, 'prev'); }} className="hover:text-accent rounded-control w-5 h-5 flex items-center justify-center"><ChevronLeft size={14} strokeWidth={1.75} /></button>
                  v{data.responseIndex + 1}/{data.responses.length}
                  <button onClick={(e) => { e.stopPropagation(); navigateVersion(id, 'next'); }} className="hover:text-accent rounded-control w-5 h-5 flex items-center justify-center"><ChevronRight size={14} strokeWidth={1.75} /></button>
                </span>
              )}
            </div>
          )}

          </>} />
        </div>
      )}

      </>
      )}

    </div>
  );
}
