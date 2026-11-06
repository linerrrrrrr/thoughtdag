import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { describeModel } from '../lib/use-models';
import { conclusionOf } from '../lib/turn-insight';
import { useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Archive, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Eye, GitBranch, Globe, Hourglass, Minimize2, RefreshCw, Send, Split, Square, Trash2, UserRound, X, Pencil } from 'lucide-react';
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
import { collectExploreMarksKey, type ExploreMark } from '../lib/explore-marks';
import { useTextHighlighter } from '../lib/use-text-highlighter';
import NodeHighlightsSection from './NodeHighlightsSection';
import { useUiStore, toast } from '../lib/ui-store';
import SearchToggles from './ui/SearchToggles';
import { Markdown, HighlightedMarkdown } from './Markdown';
import FanOutModal from './FanOutModal';
import ReasoningDisclosure from './ui/ReasoningDisclosure';
import NodeOverview from './NodeOverview';
import NodeDetailsButton from './NodeDetailsButton';
import NodeConnectionHandles from './NodeConnectionHandles';
import NodeResizeControls from './NodeResizeControls';
import { getNodeDisplayName, getNodeNameSource } from '../lib/node-display-name';
import NodeMetadataEditor from './NodeMetadataEditor';
import NodeTokenUsage from './NodeTokenUsage';
import NodeContextSources from './NodeContextSources';
import './ConversationSurface.css';
import { ApprovalCard } from './ui/ApprovalCard';
import { AgentTrace } from './ui/AgentTrace';
import { AgentActivityView } from './ui/AgentActivityView';
import { activeAgentActivity, originalQuestionBeforeInstructions } from '../lib/agent-activity';
import { AgentRerunButton } from './ui/AgentRerunButton';
import { SquareTerminal } from 'lucide-react';
import { useT, fmt } from '../i18n';
import { isViewerMode } from '../lib/viewer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';

// Camera and resize controls change presentation, not the active editing task.
const isGeometryControl = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('.react-flow__resize-control, .react-flow__controls');

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
  const [fanoutOpen, setFanoutOpen] = useState(false);
  // fan-out placeholder shows its expand button until branches exist
  const hasFanoutChildren = useStore((s) => s.edges.some((e) => e.source === id && e.data?.isBranchFromSelection));
  // An ask node's first question lives in shared drafts until sent:
  // undoing the node and redoing it brings the words back.
  const askDraftKey = `ask:${id}`;
  const questionEditKey = `question-edit:${id}`;
  const responseEditKey = `response-edit:${id}`;
  const [editValue, setEditValueState] = useState(() => useUiStore.getState().drafts[questionEditKey] ?? (data.question || useUiStore.getState().drafts[askDraftKey] || ''));
  const setEditValue = (v: string) => {
    setEditValueState(v);
    useUiStore.getState().setDraft(questionEditKey, v, true);
    if (!data.question) useUiStore.getState().setDraft(askDraftKey, v);
  };
  const [editResponseValue, setEditResponseValue] = useState(() => useUiStore.getState().drafts[responseEditKey] ?? data.response);
  const [metadataEditing, setMetadataEditing] = useState(false);
  const customWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.width);
  const customHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.height);
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
  const isCollapsed = data.isCollapsed && !fullDetail && !metadataEditing;
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
  // Only the surface that opened an editor renders its textarea. Opening
  // the panel must never steal an in-progress edit from the canvas.
  const editingQuestionHere = (data.isEditing || isAwaitingHuman || isAwaitingAsk) && data.questionEditor !== 'panel';
  const questionEditActive = data.isEditing && data.questionEditor !== 'panel';
  const editingResponseHere = data.isEditingResponse && data.responseEditor !== 'panel';
  // While any paradigm step is incomplete the run is in progress: structure
  // is fixed (no follow-ups, no deletion) until the performance finishes.
  const runLocked = useStore((s) => isParadigmNode && isRunLocked(s.nodes));
  // Detail and selection never own an editing session. Only active editors
  // pin the working card; an idle draft (including an unsent first question)
  // follows the shared zoom tier. Live workflow/approval cards stay visible.
  const hasOpenQuestion = !!data.isLoading && (data.pendingApprovals ?? []).some((p) => !p.answered);
  const zoomedOut = mapMode && !questionEditActive && !editingResponseHere
    && !metadataEditing
    && !hasOpenQuestion && !(isParadigmNode && runLocked);
  // Glyph tier: the node collapses to one seal — the thinking's skeleton
  const glyphTier = zoomTier === 'glyph' && zoomedOut;
  // Handles move to hug the seal at glyph tier — tell React Flow to re-measure
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [glyphTier, zoomedOut, isCollapsed, metadataEditing, customWidth, customHeight, id, updateNodeInternals]);
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
    const e = s.edges.find((e) =>
      e.target === id && !e.data?.isCrossLink &&
      s.nodes.some((n) => n.id === e.source && (n.data.stepKind === 'file' || n.data.stepKind === 'link' || n.data.stepKind === 'note')));
    return e?.source ?? null;
  });
  const openReaderAtAnchor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.anchor || !anchorMaterialId) return;
    useUiStore.getState().setReaderNodeId(anchorMaterialId, { page: data.anchor.page, threadId: id });
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
    const timer = setTimeout(() => questionTaRef.current?.focus({ preventScroll: true }), 80);
    return () => clearTimeout(timer);
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
    if (!editValue.trim()) return;
    useUiStore.getState().setDraft(questionEditKey, '');
    // Unchanged question = the user opened the editor to read or copy, not
    // to regenerate — closing must never cost them their answer.
    if (editValue.trim() === data.question) { setEditing(id, false); return; }
    if (isHuman) {
      // Human turn: record the question only — no generation on this node;
      // downstream prompt steps answer (and the cascade advances).
      submitHumanTurn(id, editValue.trim());
    } else {
      editQuestion(id, editValue.trim());
    }
    useUiStore.getState().setDraft(askDraftKey, '');
  };

  const handleResponseEditSubmit = () => {
    editResponse(id, editResponseValue);
    useUiStore.getState().setDraft(responseEditKey, '');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || isImeComposing(e)) return;
    // First-input surfaces (human turn, empty ask node) keep Enter-to-send.
    // REVISING an existing question confirms explicitly — a regeneration is
    // never one accidental keystroke away: Enter breaks the line; submit is
    // the submit button or ⌘/Ctrl+Enter.
    if (isHuman || isAwaitingAsk) {
      if (!e.shiftKey) { e.preventDefault(); handleEditSubmit(); }
      return;
    }
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

  const isRoot = data.isRoot;
  const isBranch = data.isBranch;
  const hasMultipleVersions = data.responses.length > 1;

  const highlightedTexts = new Set(data.highlights.map((h) => h.text));
  // Passages child branches explore from, marked in this answer (derived
  // from the children — nothing stored here). Click jumps to the branch.
  const exploreMarksKey = useStore((s) => collectExploreMarksKey(id, s.nodes, s.edges));
  const exploreMarks = useMemo(() => JSON.parse(exploreMarksKey) as ExploreMark[], [exploreMarksKey]);
  const exploreSpecs = exploreMarks.map((m) => ({
    text: m.text,
    nodeId: m.nodeId,
    title: `${t('node.exploredHere')} · ${m.question.slice(0, 80)}`,
  }));
  const handleResponseClick = (e: React.MouseEvent) => {
    if (highlighter.active) return;
    const m = (e.target as HTMLElement).closest?.('mark[data-explore-target]');
    if (!m) return;
    if (window.getSelection()?.toString()) return; // a drag-select, not a click
    e.stopPropagation();
    const childId = m.getAttribute('data-explore-target');
    const child = childId ? rf.getNode(childId) : undefined;
    if (!child || !childId) return;
    setSelectedNodeId(childId);
    rf.setCenter(child.position.x + 260, child.position.y + 110, { zoom: rf.getZoom(), duration: 300 });
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
  // The glyph seal: typed moves keep their seal; insight sparks; evaluators
  // wear their red eye; everything else is a neutral waypoint dot
  const glyphSeal = takeawayType && TYPE_BADGE[takeawayType]
    ? TYPE_BADGE[takeawayType]
    : (versionSummary ? TYPE_BADGE.insight : null);
  // Stale compact cards keep the warning on their named outline.
  // "Continue last thread" hover: this node is the flight destination
  const isBeacon = useUiStore((s) => s.beaconNodeId === id);
  const fixedHeight = (!zoomedOut || data.keepOverviewHeight) && !isCollapsed && !metadataEditing ? customHeight : undefined;

  return (
    <div
      ref={nodeRef}
      style={{ width: customWidth ?? 520, height: fixedHeight }}
      data-thought-natural-height={(zoomedOut && !data.keepOverviewHeight) || isCollapsed || metadataEditing || undefined}
      data-node-detail-level={zoomedOut ? (glyphTier ? 'compact' : 'summary') : 'full'}
      data-node-detail-locked={data.detailLevel || undefined}
      data-selection-sized={data.keepOverviewHeight || undefined}
      data-thought-resized={fixedHeight != null || undefined}
      data-awaiting-ask={isAwaitingAsk || undefined}
      className={glyphTier
        ? `animate-fade-in ${isBeacon ? 'beacon-node ' : ''}${data.archived ? 'opacity-35 saturate-50 ' : ''}${selected || selectedNodeId === id ? 'glyph-selected ' : ''}`
        : `thought-node conversation-node relative flex flex-col rounded-node animate-fade-in ${isBeacon ? 'beacon-node ' : ''}${zoomedOut ? 'map-node ' : ''}${condenseLit ? 'condense-lit ' : ''}${data.archived ? 'opacity-35 saturate-50 ' : ''}${isWaitingUpstream ? 'opacity-60 ' : ''}${
        data.isEvaluator ? 'evaluator-node' : isHuman ? 'human-node' : isBranch ? 'orange-node' : isRoot ? 'root-node' : 'branch-node'
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
        <NodeResizeControls id={id} widthOnly={metadataEditing} />
      )}
      {data.focusRole === 'down' && !glyphTier && (
        // Context Focus: floating corner tag — the card may have no meta
        // row yet (unanswered follow-up), so it cannot live there
        <span className="absolute -top-2.5 right-4 z-10 text-control text-accent/80 bg-card border border-line rounded-tag px-2 py-px whitespace-nowrap" data-focus-down>
          {t('focus.downstream')}
        </span>
      )}
      <NodeConnectionHandles id={id} large={zoomedOut} />

      {/* Stale dot pins to the CARD's corner — at glyph tier the card is
          gone (one centered seal), so the seal wears an amber ring instead
          of a dot floating where the card used to be */}
      {isStale && zoomedOut && !glyphTier && (
        <span className="absolute top-2.5 right-2.5 w-3.5 h-3.5 rounded-full bg-amber-500 z-10" role="img" aria-label={staleTitle} data-stale-dot />
      )}
      {glyphTier ? (
        <div
          className="drag-handle w-full min-h-32 flex items-center justify-center"
          data-glyph-node
          data-node-details-header
          data-node-stale={isStale || undefined}
        >
          <NodeOverview
            name={nodeName}
            action={<NodeDetailsButton nodeId={id} />}
            source={nodeNameSource}
            compact
            variant={isRoot ? 'start' : 'thought'}
            icon={data.generationFailed ? <AlertTriangle className="text-red-600" /> : data.isLoading ? <Hourglass /> : data.isEvaluator ? <Eye /> : data.digestOf ? <BookOpen /> : glyphSeal ? <span role="img" aria-label={badgeTitle} className={glyphSeal.cls}>{glyphSeal.glyph}</span> : undefined}
          />
        </div>
      ) : (
      <>
      {/* Header */}
      <div data-node-details-header className="thought-node-header shrink-0 flex items-center justify-between gap-related px-surface-inset py-related border-b border-line drag-handle">
        <div className="node-header-status flex flex-wrap items-center gap-2 min-w-0">
          <button onClick={() => zoomedOut ? setNodeDetail(id, 'full') : fullDetail ? setNodeDetail(id, 'summary') : toggleCollapse(id)}
            aria-label={t(zoomedOut || isCollapsed ? 'node.expandCard' : 'node.collapseCard')} className={`nodrag nopan rounded-control w-7 h-7 flex items-center justify-center transition-colors text-body font-bold ${
            data.isEvaluator ? 'text-watch bg-watch/10 hover:bg-watch/15'
              : isHuman || isBranch ? 'text-warm bg-warm/10 hover:bg-warm/15'
                : isRoot || isCollapsed ? 'text-accent bg-accent/10 hover:bg-accent/15'
                  : 'text-ink-faint hover:bg-wash'
          }`}>
            {zoomedOut || isCollapsed ? <ChevronRight size={18} strokeWidth={1.75} /> : <ChevronDown size={18} strokeWidth={1.75} />}
          </button>
          {isRoot && <span className="node-start-label">{t('node.startLabel')}</span>}
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
              onClick={(e) => { e.stopPropagation(); if (!isViewerMode) void rerunNode(id, {}); }}

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
          {data.isEvaluator ? (
            <span className="text-control bg-watch/10 text-watch px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium">
              <Eye size={12} strokeWidth={1.75} /> {t('evaluator.badge')}
            </span>
          ) : data.appliedRole && (
            <span className="text-control bg-accent/10 text-accent px-1.5 py-0.5 rounded-tag truncate max-w-[120px]" data-tooltip={data.appliedRole} data-tooltip-overflow={data.appliedRole.length <= 20 || undefined}>
              {data.appliedRole.slice(0, 20)}{data.appliedRole.length > 20 ? '…' : ''}
            </span>
          )}
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
        <div className={`p-surface-inset min-h-0 ${fixedHeight != null ? 'flex-1 overflow-y-auto nowheel' : ''} nodrag nopan`} data-thought-body>
          {/* The passage this branch explores: without it the user loses
              the thread that spawned the node. Page-anchored ones carry a
              p.N chip that reopens the reader at that page, thread open —
              the same provenance grammar as the digest's page buttons. */}
          {data.branchContext && (
            <div className="mb-2.5 text-control pl-3 py-1.5 pr-2 border border-warm/30 bg-warm/10 rounded-content text-ink-muted flex items-start gap-1.5">
              <GitBranch size={13} strokeWidth={1.75} className="text-warm shrink-0 mt-0.5" />
              <span className="italic leading-relaxed min-w-0">
                “{(data.anchor ? data.branchContext.replace(/^\(p\.\s?\d+\)\s*/, '') : data.branchContext).slice(0, 180)}{data.branchContext.length > 180 ? '…' : ''}”
              </span>
              {data.anchor && anchorMaterialId && (
                <button
                  onClick={openReaderAtAnchor}
                  data-tooltip={fmt(t('node.openAtPage'), { n: data.anchor.page })}
                  className="ml-auto shrink-0 text-control font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded-tag px-1.5 py-0.5 transition-colors"
                >
                  p.{data.anchor.page}
                </button>
              )}
            </div>
          )}
          {/* Question */}
          {editingQuestionHere ? (
            <div ref={questionEditorRef} onBlur={questionDismiss.onBlur}
              onFocusCapture={() => { if (awaiting && !questionEditActive) setEditing(id, true); }}
              className={isAwaitingAsk ? 'node-question-composer' : undefined}>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onInput={(e) => autoGrowTa(e.currentTarget)}
                ref={(el) => { questionTaRef.current = el; autoGrowTa(el); }}
                placeholder={data.instruction || (isAwaitingAsk ? t('node.askPlaceholder') : undefined)}
                aria-label={t('panel.question')}
                data-canvas-question-editor
                className={isAwaitingAsk ? 'node-ask-textarea nodrag nopan nowheel' : `w-full bg-wash border rounded-control p-3 text-body text-ink resize-none focus:outline-none focus:ring-2 ${
                  isHuman ? 'border-warm focus:ring-warm/20' : 'border-accent focus:ring-accent/20'
                }`}
                rows={2}
                autoFocus={!!questionEditActive}
              />
              {/* A fresh node is a landing page in a card: the same per-ask
                  switches (web, scholar, recall) sit under its question, so
                  the first ask can open a door without leaving the card.
                  The switches belong to this editor's interaction boundary. */}
              {isAwaitingAsk && (
                <div className="node-ask-actions nodrag nopan" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <div className="flex min-w-0 flex-wrap items-center gap-1" data-ask-toggles>
                    <SearchToggles size={16} />
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
              {!isHuman && !isAwaitingAsk && (
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
              {!awaiting && <p className="mt-1.5 text-control text-ink-faint">{t('edit.draftHint')}</p>}
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
            // Long pasted questions must not stretch the card: same pattern
            // as the answer block — cap the height, scroll inside (nowheel
            // keeps the wheel on the text, not the canvas zoom).
            <div className="conversation-question" data-conversation-question>
            <div
              onDoubleClick={handleDoubleClickQuestion}
              className="conversation-user-message question-md markdown-body cursor-text max-h-[180px] overflow-y-auto nowheel nopan"
            >
              {/* a question is markdown like an answer (lists, code, emphasis), set compact; the plaques above keep the plain text */}
              <Markdown base={data.agentSession?.cwd ?? data.importSource?.cwd} diagrams="placeholder">{originalQuestionBeforeInstructions(data.question, activity)}</Markdown>
            </div>
            {!isViewerMode && <div className="conversation-question-tools"><button onClick={handleDoubleClickQuestion} aria-label={t(hasQuestionDraft ? 'edit.resumeDraft' : 'actions.editQuestion')} data-tooltip={hasQuestionDraft ? t('edit.resumeDraft') : undefined} disabled={data.isLoading} data-edit-question className="w-6 h-6 shrink-0 rounded-control flex items-center justify-center text-ink-faint hover:text-accent hover:bg-wash disabled:opacity-30"><Pencil size={13} /></button></div>}
            </div>
          )}

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
              <p className="mt-1.5 text-control text-ink-faint">{t('edit.draftHint')}</p>
            </div>
          ) : (
            <>
            {versionReasoning && !activity.length && (
              <ReasoningDisclosure text={versionReasoning} />
            )}
            <div
              ref={responseRef}
              onClick={handleResponseClick}
              data-conversation-answer
              data-highlighter-active={highlighter.active || undefined}
              className={`conversation-answer markdown-body text-body text-ink ${fixedHeight == null ? 'max-h-[400px] overflow-y-auto' : ''} cursor-text nopan nodrag nowheel`}
            >
              {highlightedTexts.size > 0 || exploreSpecs.length > 0 ? (
                <HighlightedMarkdown base={data.agentSession?.cwd ?? data.importSource?.cwd} content={data.response} highlights={highlightedTexts} exploreMarks={exploreSpecs} diagrams="placeholder" />
              ) : (
                <Markdown base={data.agentSession?.cwd ?? data.importSource?.cwd} diagrams="placeholder">{data.response}</Markdown>
              )}
            </div>
            </>
          )}

          {/* Fan-out placeholder: the human decides when to expand */}
          {data.stepKind === 'fanout' && !hasFanoutChildren && !data.isLoading && (
            <div className="mt-2">
              <button
                onClick={(e) => { e.stopPropagation(); setFanoutOpen(true); }}

                className="w-full border-2 border-dashed border-warm/50 hover:border-warm hover:bg-warm/5 text-warm rounded-control py-3 flex items-center justify-center gap-2 text-control font-medium transition-colors"
              >
                <Split size={16} strokeWidth={1.75} />
                {fmt(t('paradigm.expand'), { n: data.fanoutRoles?.length ?? 0 })}
              </button>
              {fanoutOpen && (
                <FanOutModal
                  parentId={id}
                  initialQuestion={data.question}
                  initialRoles={data.fanoutRoles}
                  onClose={() => setFanoutOpen(false)}
                />
              )}
            </div>
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
                  onClick={(e) => { e.stopPropagation(); void rerunNode(id, {}); }}
                  className={`rounded-control w-6 h-6 flex items-center justify-center transition-colors ${data.isEvaluator ? 'hover:text-watch hover:bg-red-50' : 'hover:text-accent hover:bg-wash'}`}
                  data-tooltip={data.isEvaluator ? t('evaluator.rerun') : t('common.regenerate')}
                  aria-label={data.isEvaluator ? t('evaluator.rerun') : t('common.regenerate')}
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

          {/* Failed generation: retry in place */}
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
              {!isViewerMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); editQuestion(id, data.question); }}
                  className="ml-auto bg-card border border-red-200 hover:bg-red-100 text-red-600 px-2.5 py-1 rounded-control transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={12} strokeWidth={1.75} /> {t('common.retry')}
                </button>
              )}
            </div>
          )}

        </div>
      )}

      </>
      )}

    </div>
  );
}
