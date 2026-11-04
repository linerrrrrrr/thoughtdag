import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { describeModel } from '../lib/use-models';
import { toolFingerprint, turnComposition, footprint, conclusionOf } from '../lib/turn-insight';
import { NodeResizeControl, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Archive, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, GitBranch, Globe, Hourglass, Minimize2, MoveDiagonal2, Paperclip, RefreshCw, Send, Split, Square, Star, Trash2, UserRound, X, Pencil } from 'lucide-react';
import 'katex/dist/katex.min.css';

/** A tool's status line standing in for the answer while it runs (see
 *  store/streaming.ts onToolCall): an icon, the query, an ellipsis. */
const TOOL_PLACEHOLDER = /^(?:🔍|📚|🎓|🔧) [\s\S]*…$/;
import type { ThoughtNode as ThoughtNodeType } from '../types';
import { useStore } from '../store';
import { staleHiddenByJudge, currentStaleVerdict } from '../lib/stale-judge';
import { setNodeDetail, useNodeDetail } from '../lib/node-detail';
import { generateId, isImeComposing , activeSummary, activeTopic, awaitingInput, formatStamp } from '../utils';
import { processFile } from '../lib/attachments';
import { copyText } from '../lib/export';
import { isRunLocked } from '../lib/paradigm';
import { collectExploreMarksKey, type ExploreMark } from '../lib/explore-marks';
import { withinOneCodeBlock } from '../lib/highlight-match';
import { useUiStore, toast } from '../lib/ui-store';
import SearchToggles from './ui/SearchToggles';
import { Markdown, HighlightedMarkdown } from './Markdown';
import FanOutModal from './FanOutModal';
import ReasoningDisclosure from './ui/ReasoningDisclosure';
import NodeOverview from './NodeOverview';
import NodeDetailsButton from './NodeDetailsButton';
import NodeConnectionHandles from './NodeConnectionHandles';
import { getNodeDisplayName, getNodeNameSource } from '../lib/node-display-name';
import { useLocalLadder } from '../lib/local-ladder-cache';
import { levelText } from '../lib/ladder-core';
import { ApprovalCard } from './ui/ApprovalCard';
import { AgentTrace } from './ui/AgentTrace';
import { AgentActivityView } from './ui/AgentActivityView';
import { activeAgentActivity } from '../lib/agent-activity';
import { AgentRerunButton } from './ui/AgentRerunButton';
import { SquareTerminal } from 'lucide-react';
import { useT, fmt } from '../i18n';
import MentionSurface from './ui/NodeMention';
import { useMentions } from '../lib/mentions';
import { isViewerMode } from '../lib/viewer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';

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
  const addHighlight = useStore((s) => s.addHighlight);
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
  const [selectedText, setSelectedText] = useState('');
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number; inCode: boolean } | null>(null);
  const inlineDraftKey = `inline:${id}`;
  const [inputValue, setInputValueState] = useState(() => useUiStore.getState().drafts[inlineDraftKey] ?? '');
  const mention = useMentions(id);
  const setInputValue = (v: string) => {
    setInputValueState(v);
    useUiStore.getState().setDraft(inlineDraftKey, v);
  };
  const [branchFromText, setBranchFromText] = useState('');
  const [branchYRatio, setBranchYRatio] = useState(0.5);
  // An ask node's first question lives in the shared drafts until sent, like
  // the follow-up box: undoing the node and redoing it brings the words back.
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
  const [showFullResponse, setShowFullResponse] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const customWidth = useStore((s) => s.nodes.find((n) => n.id === id)?.width);
  const customHeight = useStore((s) => s.nodes.find((n) => n.id === id)?.height);
  const responseRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const questionTaRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLFormElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const questionEditorRef = useRef<HTMLDivElement>(null);
  const responseEditorRef = useRef<HTMLDivElement>(null);
  const hasQuestionDraft = useUiStore(s => s.drafts[questionEditKey] !== undefined && s.drafts[questionEditKey] !== data.question);
  const hasResponseDraft = useUiStore(s => s.drafts[responseEditKey] !== undefined && s.drafts[responseEditKey] !== data.response);
  const addQuestion = useStore((s) => s.addQuestion);
  const rf = useReactFlow();
  const { tier: zoomTier, fixed: fixedDetail } = useNodeDetail(data.detailLevel);
  const fullDetail = fixedDetail === 'full';
  const isCollapsed = data.isCollapsed && !fullDetail;
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
  const editingResponseHere = data.isEditingResponse && data.responseEditor !== 'panel';
  // While any paradigm step is incomplete the run is in progress: structure
  // is fixed (no follow-ups, no deletion) until the performance finishes.
  const runLocked = useStore((s) => isParadigmNode && isRunLocked(s.nodes));
  // Map labels represent completed steps (their takeaway). A node WAITING
  // for human input has nothing to summarize — its identity is the input
  // box. And while a paradigm run is in progress the canvas is a DASHBOARD
  // (waiting/running states are what the human watches), not a map. Both
  // keep their working form at every zoom.
  // a running agent waiting on the person keeps its card open at any zoom
  const hasOpenQuestion = !!data.isLoading && (data.pendingApprovals ?? []).some((p) => !p.answered);
  const zoomedOut = mapMode && !isAwaitingHuman && !isAwaitingAsk && !editingQuestionHere && !editingResponseHere && !renaming && !hasOpenQuestion && !(isParadigmNode && runLocked);
  // Glyph tier: the node collapses to one seal — the thinking's skeleton
  const glyphTier = zoomTier === 'glyph' && zoomedOut;
  // Handles move to hug the seal at glyph tier — tell React Flow to re-measure
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [glyphTier, zoomedOut, isCollapsed, customWidth, customHeight, id, updateNodeInternals]);
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
  // Re-focus a fresh ask / human slot shortly after mount instead.
  useEffect(() => {
    if (!isAwaitingAsk && !isAwaitingHuman) return;
    const timer = setTimeout(() => questionTaRef.current?.focus(), 80);
    return () => clearTimeout(timer);
    // mount-only: a node awaits input exactly once, at creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0 && responseRef.current?.contains(selection.anchorNode)) {
      const text = selection.toString().trim();
      setSelectedText(text);
      const range = selection.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      const nodeRect = nodeRef.current?.getBoundingClientRect();
      if (nodeRect) {
        setSelectionPos({
          x: rangeRect.left + rangeRect.width / 2 - nodeRect.left,
          y: rangeRect.top - nodeRect.top - 48,
          inCode: withinOneCodeBlock(range),
        });
      }
    } else {
      setSelectedText('');
      setSelectionPos(null);
    }
  }, []);

  useEffect(() => {
    if (isViewerMode) return; // no selection menu (branch/highlight are writes)
    document.addEventListener('mouseup', handleTextSelection);
    return () => document.removeEventListener('mouseup', handleTextSelection);
  }, [handleTextSelection]);

  const handleBranch = () => {
    setBranchFromText(selectedText);
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && nodeRef.current) {
      const range = selection.getRangeAt(0);
      const selRect = range.getBoundingClientRect();
      const nodeRect = nodeRef.current.getBoundingClientRect();
      const ratio = Math.max(0.1, Math.min(0.9, (selRect.top + selRect.height / 2 - nodeRect.top) / nodeRect.height));
      setBranchYRatio(ratio);
    }
    setInputValue('');
    setSelectedText('');
    setSelectionPos(null);
  };

  const handleHighlight = () => {
    if (!selectedText) return;
    addHighlight(id, { id: generateId(), text: selectedText });
    setSelectedText('');
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleSubmitBranch = () => {
    if (!inputValue.trim()) return;
    addQuestion(inputValue.trim(), {
      parentId: id,
      branchContext: branchFromText || undefined,
      branchYRatio: branchFromText ? branchYRatio : undefined,
      mentions: mention.mentions.map((x) => x.nodeId),
    });
    mention.clear();
    setInputValue('');
    setBranchFromText('');
    setSelectedText('');
    setSelectionPos(null);
  };

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

  const startRename = () => {
    if (isViewerMode || data.isLoading) return;
    setNameDraft(data.displayName ?? '');
    setRenaming(true);
  };

  const saveName = () => {
    const displayName = nameDraft.replace(/\s+/g, ' ').trim() || undefined;
    if (displayName !== data.displayName) {
      useStore.getState().pushHistory();
      useStore.setState((s) => ({ nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...n.data, displayName } } : n) }));
      useStore.getState().pushHistory();
    }
    setRenaming(false);
  };

  const cancelQuestionEdit = () => {
    useUiStore.getState().setDraft(questionEditKey, '');
    setEditing(id, false);
  };
  const cancelResponseEdit = () => {
    useUiStore.getState().setDraft(responseEditKey, '');
    setEditingResponse(id, false);
  };
  const renameDismiss = useInlineEditDismiss({ active: renaming, ref: renameRef, onOutside: saveName, onCancel: () => setRenaming(false), restoreFocusRef: renameButtonRef });
  const questionDismiss = useInlineEditDismiss({
    active: !!editingQuestionHere && !awaiting,
    ref: questionEditorRef,
    onOutside: () => setEditing(id, false),
    onCancel: cancelQuestionEdit,
    ignoreOutside: event => !!(event.target as Element).closest?.('.react-flow__resize-control'),
  });
  const responseDismiss = useInlineEditDismiss({
    active: !!editingResponseHere,
    ref: responseEditorRef,
    onOutside: () => setEditingResponse(id, false),
    onCancel: cancelResponseEdit,
    ignoreOutside: event => !!(event.target as Element).closest?.('.react-flow__resize-control'),
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

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (mention.invokeKey(e)) return; // @-picker owns the key
    if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); handleSubmitBranch(); }
    if (e.key === 'Escape' && branchFromText && !isImeComposing(e)) { e.preventDefault(); e.stopPropagation(); setBranchFromText(''); }
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
  // The self-explaining chain (imported turns): action fingerprint + token
  // split, both computed from data the import already carries — free.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the exact fields read
  const toolMarks = useMemo(() => toolFingerprint(data), [data.attachments]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the exact fields read
  const composition = useMemo(() => turnComposition(data), [data.question, data.response, data.attachments, data.excludedAttachmentIds, data.reasonings, data.reasoningTokens, data.responseIndex]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the exact fields read
  const prints = useMemo(() => footprint(data), [data.attachments]);
  const marksLine = toolMarks.map((m) => `${m.glyph}${m.count > 1 ? m.count : ''}`).join(' ');
  const marksTitle = toolMarks.map((m) => `${m.name}×${m.count}`).join(' · ');
  // solid segments are what this card hands downstream, hatched ones stay
  // on it: the tool record follows its switch, thinking never goes
  const toolState = composition && (composition.toolForwarded === 'all' ? t('insight.toolStateAll')
    : composition.toolForwarded === 'none' ? t('insight.toolStateNone')
    : fmt(t('insight.toolStateSome'), { k: composition.toolStepsForwarded, n: composition.toolSteps }));
  const compBar = composition && (
    <span
      className={`inline-flex h-1.5 ${composition.think > 0 ? 'w-20' : 'w-14'} rounded-tag overflow-hidden shrink-0 self-center gap-px`}
      title={[
        fmt(t('insight.compTitle'), { q: composition.q, a: composition.a, tool: composition.tool, state: toolState ?? '', pct: Math.round(composition.toolShare * 100) }),
        composition.think > 0 ? fmt(t('insight.compThink'), { think: composition.think }) : '',
        t('insight.barKey'),
      ].filter(Boolean).join('\n')}
      data-comp-bar
      data-tool-forwarded={composition.toolForwarded}
    >
      <span style={{ flex: Math.max(composition.q, 1) }} className="bg-accent/50" />
      <span style={{ flex: Math.max(composition.a, 1) }} className="bg-ink/25" />
      {composition.toolForwardedTokens > 0 && (
        <span style={{ flex: Math.max(composition.toolForwardedTokens, 1) }} className={composition.toolShare > 0.6 ? 'bg-amber-500' : 'bg-warm/60'} data-seg="tool" />
      )}
      {composition.tool > composition.toolForwardedTokens && (
        <span style={{ flex: Math.max(composition.tool - composition.toolForwardedTokens, 1) }} className="comp-held-tool" data-seg="tool-held" />
      )}
      {composition.think > 0 && <span style={{ flex: composition.think }} className="comp-held-think" data-seg="think" />}
    </span>
  );
  // The canvas overview leads with a name; summaries are quiet close-range previews.
  const versionSummary = activeSummary(data);
  // the zoom ladder of the ACTIVE version: the one its answering model selected, else
  // an instant local one from the takeaway and the answer's own sentences (older
  // nodes, failed builds); needed only for the manually folded reading card.
  const storedLadder = data.summaryLadders?.[data.responseIndex] ?? undefined;
  const versionTopic = activeTopic(data);
  const localLadder = useLocalLadder(isCollapsed && !storedLadder, id, data.question, data.response, versionSummary, versionTopic);
  const versionLadder = storedLadder ?? localLadder ?? undefined;
  const nodeName = getNodeDisplayName(data, t('panel.question'));
  const nodeNameSource = getNodeNameSource(data, t('panel.question'));
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
  const hasSummaryCard = !!versionSummary && data.response.length > 400 && !data.isLoading;
  const showSummaryCard = hasSummaryCard && !showFullResponse && !editingResponseHere && !fullDetail;
  const fixedHeight = (!zoomedOut || data.keepOverviewHeight) && !isCollapsed ? customHeight : undefined;
  const recordResize = () => useStore.getState().pushHistory();
  const finishResize = () => {
    recordResize();
    // A width-only resize may reflow an auto-height card. Re-measure after
    // the resizer's final update so the next drag starts at its visible edge.
    requestAnimationFrame(() => updateNodeInternals(id));
  };

  return (
    <div
      ref={nodeRef}
      style={{ width: customWidth ?? 520, height: fixedHeight }}
      data-thought-natural-height={(zoomedOut && !data.keepOverviewHeight) || isCollapsed || undefined}
      data-node-detail-level={zoomedOut ? (glyphTier ? 'compact' : 'summary') : 'full'}
      data-node-detail-locked={data.detailLevel || undefined}
      data-selection-sized={data.keepOverviewHeight || undefined}
      data-thought-resized={fixedHeight != null || undefined}
      data-awaiting-ask={isAwaitingAsk || undefined}
      className={glyphTier
        ? `animate-fade-in ${isBeacon ? 'beacon-node ' : ''}${data.archived ? 'opacity-35 saturate-50 ' : ''}${selected || selectedNodeId === id ? 'glyph-selected ' : ''}`
        : `thought-node relative flex flex-col rounded-node animate-fade-in ${isBeacon ? 'beacon-node ' : ''}${zoomedOut ? 'map-node ' : ''}${condenseLit ? 'condense-lit ' : ''}${data.archived ? 'opacity-35 saturate-50 ' : ''}${isWaitingUpstream ? 'opacity-60 ' : ''}${
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
        <>
          <NodeResizeControl key={data.lockAspectRatio ? 'right-locked' : 'right'} position="right" resizeDirection={data.lockAspectRatio ? undefined : 'horizontal'} minWidth={360} minHeight={240} keepAspectRatio={!!data.lockAspectRatio} autoScale={false}
            className="thought-resize-side" onResizeStart={recordResize} onResizeEnd={finishResize}>
            <span className="sr-only">{t('node.resizeWidth')}</span>
          </NodeResizeControl>
          <NodeResizeControl key={data.lockAspectRatio ? 'bottom-locked' : 'bottom'} position="bottom" resizeDirection={data.lockAspectRatio ? undefined : 'vertical'} minWidth={360} minHeight={240} keepAspectRatio={!!data.lockAspectRatio} autoScale={false}
            className="thought-resize-bottom" style={{ left: '75%' }} onResizeStart={recordResize} onResizeEnd={finishResize}>
            <span className="sr-only">{t('node.resizeHeight')}</span>
          </NodeResizeControl>
          <NodeResizeControl position="bottom-right" minWidth={360} minHeight={240} keepAspectRatio={!!data.lockAspectRatio} autoScale={false}
            className="thought-resize-corner" onResizeStart={recordResize} onResizeEnd={finishResize}>
            <MoveDiagonal2 size={12} strokeWidth={1.75} aria-label={t('node.resize')} />
          </NodeResizeControl>
        </>
      )}
      {data.focusRole === 'down' && !glyphTier && (
        // Context Focus: floating corner tag — the card may have no meta
        // row yet (unanswered follow-up), so it cannot live there
        <span className="absolute -top-2.5 right-4 z-10 text-2xs text-accent/80 bg-card border border-line rounded-tag px-2 py-px whitespace-nowrap" data-focus-down>
          {t('focus.downstream')}
        </span>
      )}
      <NodeConnectionHandles id={id} large={zoomedOut} />

      {/* Stale dot pins to the CARD's corner — at glyph tier the card is
          gone (one centered seal), so the seal wears an amber ring instead
          of a dot floating where the card used to be */}
      {isStale && zoomedOut && !glyphTier && (
        <span className="absolute top-2.5 right-2.5 w-3.5 h-3.5 rounded-full bg-amber-500 z-10" title={staleTitle} data-stale-dot />
      )}
      {glyphTier ? (
        <div
          className="drag-handle cursor-grab active:cursor-grabbing w-full min-h-32 flex items-center justify-center"
          title={nodeNameSource}
          data-glyph-node
          data-node-stale={isStale || undefined}
        >
          <NodeOverview
            name={nodeName}
            action={<NodeDetailsButton nodeId={id} />}
            source={nodeNameSource}
            compact
            variant={isRoot ? 'start' : 'thought'}
            icon={data.generationFailed ? <AlertTriangle className="text-red-600" /> : data.isLoading ? <Hourglass /> : data.isEvaluator ? <Eye /> : data.digestOf ? <BookOpen /> : glyphSeal ? <span title={badgeTitle} className={glyphSeal.cls}>{glyphSeal.glyph}</span> : undefined}
          />
        </div>
      ) : zoomedOut ? (
        <div
          className="drag-handle cursor-grab active:cursor-grabbing"
          onDoubleClick={(e) => {
            e.stopPropagation();
            const n = rf.getNode(id);
            if (n) rf.setCenter(n.position.x + (customWidth ?? 520) / 2, n.position.y + 120, { zoom: 1, duration: 300 });
          }}
        >
          <NodeOverview
            name={nodeName}
            action={<NodeDetailsButton nodeId={id} />}
            source={nodeNameSource}
            variant={isRoot ? 'start' : 'thought'}
            typeLabel={isRoot ? t('node.startLabel') : undefined}
            preview={versionSummary || data.response}
            previewAlways={!!fixedDetail}
            icon={data.generationFailed ? <AlertTriangle className="text-red-600" /> : data.isLoading ? <Hourglass /> : badge ? <span title={badgeTitle} className={badge.cls}>{badge.glyph}</span> : undefined}
            meta={toolMarks.length > 0 ? marksLine : undefined}
          />
        </div>
      ) : (
      <>
      {/* Header */}
      <div className="thought-node-header shrink-0 flex items-center justify-between gap-related px-surface-inset py-related border-b border-line cursor-grab active:cursor-grabbing drag-handle">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button onClick={() => fullDetail ? setNodeDetail(id, 'summary') : toggleCollapse(id)} className={`rounded-control w-7 h-7 flex items-center justify-center transition-colors text-sm font-bold ${
            data.isEvaluator ? 'text-watch bg-watch/10 hover:bg-watch/15'
              : isHuman || isBranch ? 'text-warm bg-warm/10 hover:bg-warm/15'
                : isRoot || isCollapsed ? 'text-accent bg-accent/10 hover:bg-accent/15'
                  : 'text-ink-faint hover:bg-wash'
          }`}>
            {isCollapsed ? <ChevronRight size={18} strokeWidth={1.75} /> : <ChevronDown size={18} strokeWidth={1.75} />}
          </button>
          <span className="text-[12px] text-ink-faint font-mono">{data.tokenCount} tok</span>
          {isRoot && <span className="node-start-label">{t('node.startLabel')}</span>}
          {toolMarks.length > 0 && (
            <span className="text-2xs text-ink-muted shrink-0 select-none" title={marksTitle} data-tool-marks>{marksLine}</span>
          )}
          {compBar}
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
              title={t('node.condensedFromTitle')}
              data-condensed-from
              className="text-2xs bg-accent/10 text-accent hover:bg-accent/20 px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium transition-colors"
            >
              <Minimize2 size={11} strokeWidth={1.75} /> {fmt(t('node.condensedFrom'), { n: String(data.condensedFrom.length) })}
            </button>
          )}
          {isStale && !data.isLoading && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!isViewerMode) void rerunNode(id, {}); }}
              title={staleTitle}
              data-stale-badge
              className="text-2xs bg-amber-500/10 text-amber-600 hover:bg-amber-500/25 px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium transition-colors"
            >
              <RefreshCw size={11} strokeWidth={1.75} /> {t('node.staleBadge')}
            </button>
          )}
          {data.archived && (
            <span className="text-2xs bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium" title={t('archive.badgeTitle')}>
              <Archive size={11} strokeWidth={1.75} /> {t('archive.badge')}
            </span>
          )}
          {isHuman && (
            <span className="text-2xs bg-warm/10 text-warm px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium">
              <UserRound size={11} strokeWidth={1.75} /> {isAwaitingHuman ? t('paradigm.yourTurn') : t('paradigm.kind.human')}
            </span>
          )}
          {isWaitingUpstream && (
            <span className="text-2xs bg-wash text-ink-faint px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium">
              <Hourglass size={11} strokeWidth={1.75} /> {t('paradigm.waitingUpstream')}
            </span>
          )}
          {data.isEvaluator ? (
            <span className="text-2xs bg-watch/10 text-watch px-1.5 py-0.5 rounded-tag flex items-center gap-1 font-medium">
              <Eye size={12} strokeWidth={1.75} /> {t('evaluator.badge')}
            </span>
          ) : data.appliedRole && (
            <span className="text-2xs bg-accent/10 text-accent px-1.5 py-0.5 rounded-tag truncate max-w-[120px]" title={data.appliedRole}>
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
              <span className="text-2xs bg-wash text-ink-muted px-1.5 py-0.5 rounded-tag font-mono truncate max-w-[130px]" title={`${label}${pinNote}`}>
                {label.split('/').pop()}
              </span>
            );
          })()}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <NodeDetailsButton nodeId={id} />
          {data.isLoading && (
            <button
              onClick={(e) => { e.stopPropagation(); stopGeneration(id); }}
              title={t('actions.stop')}
              className="text-white bg-red-500 hover:bg-red-600 rounded-control w-7 h-7 flex items-center justify-center transition-colors"
            >
              <Square size={10} strokeWidth={1.75} fill="currentColor" />
            </button>
          )}
          {!(isParadigmNode && runLocked) && !isViewerMode && (
            <button onClick={() => deleteNode(id)} className="text-ink-faint hover:text-red-500 hover:bg-red-50 rounded-control w-7 h-7 flex items-center justify-center transition-colors" title={t('common.delete')}>
              <X size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className={`p-surface-inset min-h-0 ${fixedHeight != null ? 'flex-1 overflow-y-auto nowheel' : ''} nodrag nopan`} data-thought-body>
          <div className="flex items-start gap-2 mb-3" data-node-name>
            {renaming ? (
              <form ref={renameRef} onBlur={renameDismiss.onBlur} className="flex flex-wrap items-center gap-1 w-full" onSubmit={(e) => { e.preventDefault(); saveName(); }} onDoubleClick={(e) => e.stopPropagation()}>
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={80}
                  placeholder={getNodeDisplayName({ ...data, displayName: undefined }, t('ctx.unnamedNode'))}
                  aria-label={t('ctx.rename')} autoFocus data-canvas-rename
                  onKeyDown={(e) => { if (e.key === 'Enter' && isImeComposing(e)) e.preventDefault(); }}
                  className="flex-1 min-w-0 rounded-control border border-accent bg-wash px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20" />
                <button type="button" onClick={() => setRenaming(false)} title={t('common.cancel')} className="w-7 h-7 flex items-center justify-center rounded-control hover:bg-wash"><X size={14} /></button>
                <button type="submit" title={t('common.save')} className="w-7 h-7 flex items-center justify-center rounded-control bg-action text-white"><Check size={14} /></button>
              </form>
            ) : <>
              <div className="flex-1 min-w-0 text-base font-medium text-ink" title={nodeNameSource} onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}>{nodeName}</div>
              {!isViewerMode && <button ref={renameButtonRef} onClick={startRename} disabled={data.isLoading} title={t('ctx.rename')} aria-label={t('ctx.rename')} data-canvas-rename-button className="w-7 h-7 shrink-0 text-ink-faint hover:text-accent hover:bg-wash disabled:opacity-30 rounded-control flex items-center justify-center"><Pencil size={14} strokeWidth={1.75} /></button>}
            </>}
          </div>
          {/* The passage this branch explores: without it the user loses
              the thread that spawned the node. Page-anchored ones carry a
              p.N chip that reopens the reader at that page, thread open —
              the same provenance grammar as the digest's page buttons. */}
          {data.branchContext && (
            <div className="mb-2.5 text-xs pl-3 py-1.5 pr-2 border border-warm/30 bg-warm/10 rounded-content text-ink-muted flex items-start gap-1.5">
              <GitBranch size={13} strokeWidth={1.75} className="text-warm shrink-0 mt-0.5" />
              <span className="italic leading-relaxed min-w-0">
                “{(data.anchor ? data.branchContext.replace(/^\(p\.\s?\d+\)\s*/, '') : data.branchContext).slice(0, 180)}{data.branchContext.length > 180 ? '…' : ''}”
              </span>
              {data.anchor && anchorMaterialId && (
                <button
                  onClick={openReaderAtAnchor}
                  title={fmt(t('node.openAtPage'), { n: data.anchor.page })}
                  className="ml-auto shrink-0 text-2xs font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded-tag px-1.5 py-0.5 transition-colors"
                >
                  p.{data.anchor.page}
                </button>
              )}
            </div>
          )}
          {/* Question */}
          {editingQuestionHere ? (
            <div ref={questionEditorRef} onBlur={questionDismiss.onBlur} className={isAwaitingAsk ? 'node-question-composer' : undefined}>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onInput={(e) => autoGrowTa(e.currentTarget)}
                ref={(el) => { questionTaRef.current = el; autoGrowTa(el); }}
                placeholder={data.instruction || (isAwaitingAsk ? t('node.askPlaceholder') : undefined)}
                aria-label={t('panel.question')}
                data-canvas-question-editor
                className={isAwaitingAsk ? 'node-ask-textarea nodrag nopan nowheel' : `w-full bg-wash border rounded-control p-3 text-sm text-ink resize-none focus:outline-none focus:ring-2 ${
                  isHuman ? 'border-warm focus:ring-warm/20' : 'border-accent focus:ring-accent/20'
                }`}
                rows={2}
                autoFocus
              />
              {/* A fresh node is a landing page in a card: the same per-ask
                  switches (web, scholar, recall) sit under its question, so
                  the first ask can open a door without leaving the card.
                  The click must not select the node (that swaps the card
                  for the panel). */}
              {isAwaitingAsk && (
                <div className="node-ask-actions nodrag nopan" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <div className="flex min-w-0 flex-wrap items-center gap-1" data-ask-toggles>
                    <SearchToggles size={16} />
                  </div>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleEditSubmit}
                    disabled={!editValue.trim()} title={t('common.send')} aria-label={t('common.send')}
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
                    className="text-xs text-ink-muted hover:text-red-500 hover:bg-wash px-3 py-1.5 rounded-control transition-colors flex items-center gap-1"
                    data-edit-cancel
                  >
                    <X size={12} strokeWidth={2} /> {t('question.editCancel')}
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleEditSubmit}
                    disabled={!editValue.trim()}
                    className="text-xs bg-action hover:bg-action-strong disabled:opacity-30 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded-control transition-colors flex items-center gap-1.5"
                    data-edit-submit
                  >
                    <Check size={12} strokeWidth={2.25} /> {t('question.editSubmit')}
                  </button>
                </div>
              )}
              {!awaiting && <p className="mt-1.5 text-2xs text-ink-faint">{t('edit.draftHint')}</p>}
              {isHuman && (
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={handleEditSubmit}
                    disabled={!editValue.trim()}
                    className="text-xs bg-warm hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-control transition-all flex items-center gap-1.5"
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
            <div className="flex items-start gap-1 mb-3">
            <div
              onDoubleClick={handleDoubleClickQuestion}
              className="question-md markdown-body flex-1 min-w-0 text-sm text-ink font-medium cursor-text hover:bg-wash rounded-content py-related transition-colors max-h-[180px] overflow-y-auto nowheel nopan"
            >
              {/* a question is markdown like an answer (lists, code, emphasis), set compact; the plaques above keep the plain text */}
              <Markdown diagrams="placeholder">{data.question}</Markdown>
            </div>
            {!isViewerMode && <button onClick={handleDoubleClickQuestion} title={t(hasQuestionDraft ? 'edit.resumeDraft' : 'actions.editQuestion')} disabled={data.isLoading} data-edit-question className="mt-1 w-6 h-6 shrink-0 rounded-control flex items-center justify-center text-ink-faint hover:text-accent hover:bg-wash disabled:opacity-30"><Pencil size={13} /></button>}
            </div>
          )}

          {/* Highlights */}
          {data.highlights.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {data.highlights.map((h) => (
                <span key={h.id} className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-tag">
                  <Star size={14} strokeWidth={1.75} />
                  {h.text.slice(0, 30)}{h.text.length > 30 ? '…' : ''}
                </span>
              ))}
            </div>
          )}

          {!data.isLoading && activity.length > 0 && <AgentActivityView key={`${id}:${data.responseIndex}`} entries={activity} compact base={data.importSource?.cwd} failed={data.generationFailed} />}
          {data.isLoading && !!data.pendingApprovals?.length && (
            <div className="flex flex-col gap-1.5">
              {data.pendingApprovals.map((req) => <ApprovalCard key={req.id} nodeId={id} request={req} compact />)}
            </div>
          )}
          {/* Response — a human turn / pending ask has none by design; a
              waiting prompt step shows its pending state instead of an empty box */}
          {isHuman || isAwaitingAsk ? null : isWaitingUpstream ? (
            <div className="border-2 border-dashed border-line rounded-content py-3 px-3 text-xs text-ink-faint flex items-center gap-2">
              <Hourglass size={13} strokeWidth={1.75} /> {t('paradigm.waitingUpstream')}
            </div>
          ) : data.isLoading ? (
            activity.length > 0 ? (
              <AgentActivityView entries={activity} running compact base={data.importSource?.cwd} />
            ) : data.agentTrace && data.agentTrace.length > 0 && (!data.response || data.restreaming) ? (
              // An agent's steps and, between them, the model's thinking: the
              // trace alone reads as a tool log; the thinking says what it is
              // for. Live tail only — the whole text opens on the finished node.
              <div className="flex flex-col gap-1.5">
                <AgentTrace entries={data.agentTrace} compact />
                {data.reasoning && (
                  <div className="px-3 py-2 bg-wash/70 rounded-content max-h-[96px] overflow-hidden flex flex-col justify-end" data-node-reasoning-live>
                    <div className="text-2xs text-ink-faint mb-0.5">💭 {t('node.reasoningLive')}</div>
                    <div className="text-xs text-ink-muted italic leading-relaxed whitespace-pre-wrap break-words">
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
                <div className="text-sm text-ink-muted leading-relaxed px-3 py-2.5 bg-surface rounded-content max-h-[180px] overflow-hidden flex flex-col justify-end whitespace-pre-wrap break-words">
                  {data.response.length > 400 ? '…' + data.response.slice(-400) : data.response}
                  <span className="inline-block w-2 h-4 bg-accent animate-pulse rounded-none" />
                </div>
                {data.reasoning && TOOL_PLACEHOLDER.test(data.response) && (
                  <div className="px-3 py-2 bg-wash/70 rounded-content max-h-[96px] overflow-hidden flex flex-col justify-end" data-node-reasoning-live>
                    <div className="text-2xs text-ink-faint mb-0.5">💭 {t('node.reasoningLive')}</div>
                    <div className="text-xs text-ink-muted italic leading-relaxed whitespace-pre-wrap break-words">
                      {data.reasoning.length > 200 ? '…' + data.reasoning.slice(-200) : data.reasoning}
                    </div>
                  </div>
                )}
              </div>
            ) : data.reasoning ? (
              // Reasoning models think before they answer — show the live
              // tail of the thinking, visually quieter than an answer
              <div className="px-3 py-2.5 bg-wash/70 rounded-content max-h-[140px] overflow-hidden flex flex-col justify-end" data-node-reasoning-live>
                <div className="text-2xs text-ink-faint mb-1">💭 {t('node.reasoningLive')}</div>
                <div className="text-xs text-ink-muted italic leading-relaxed whitespace-pre-wrap break-words">
                  {data.reasoning.length > 300 ? '…' + data.reasoning.slice(-300) : data.reasoning}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
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
                className="w-full bg-wash border border-accent rounded-control p-3 text-sm text-ink resize-y focus:outline-none focus:ring-2 focus:ring-accent/20 min-h-[100px]"
                rows={6}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={cancelResponseEdit} className="text-xs text-ink-muted hover:text-ink px-3 py-1.5 rounded-control hover:bg-wash transition-colors">{t('common.cancel')}</button>
                <button onClick={handleResponseEditSubmit} className="text-xs bg-action hover:bg-action-strong text-white px-4 py-1.5 rounded-control transition-colors">{t('common.save')}</button>
              </div>
              <p className="mt-1.5 text-2xs text-ink-faint">{t('edit.draftHint')}</p>
            </div>
          ) : (
            showSummaryCard ? (
              // A display-only summary of this version; the answer action
              // row can reveal the full text without leaving the canvas.
              <div className="px-3 py-2.5 bg-surface rounded-content nopan" title={t('node.summaryTitle')}>
                <span className="text-2xs bg-wash text-ink-faint px-1.5 py-0.5 rounded-tag">{t('node.summaryLabel')}</span>
                {badge && (
                  <span title={badgeTitle} data-takeaway-badge className={`text-2xs px-1.5 py-0.5 rounded-tag ml-1.5 font-medium ${badge.cls}`}>
                    {badge.glyph} {t(badge.key as Parameters<typeof t>[0])}
                  </span>
                )}
                <div className="text-sm text-ink-muted leading-relaxed mt-1.5">{versionSummary}</div>
              </div>
            ) : (
            <>
            {versionReasoning && !activity.length && (
              <ReasoningDisclosure text={versionReasoning} />
            )}
            <div
              ref={responseRef}
              onClick={handleResponseClick}
              className={`markdown-body text-sm text-ink leading-relaxed ${fixedHeight == null ? 'max-h-[400px] overflow-y-auto' : ''} cursor-text nopan nodrag nowheel px-3 py-2.5 bg-surface rounded-content`}
            >
              {highlightedTexts.size > 0 || exploreSpecs.length > 0 ? (
                <HighlightedMarkdown content={data.response} highlights={highlightedTexts} exploreMarks={exploreSpecs} diagrams="placeholder" />
              ) : (
                <Markdown base={data.importSource?.cwd} diagrams="placeholder">{data.response}</Markdown>
              )}
            </div>
            </>
            )
          )}

          {/* Fan-out placeholder: the human decides when to expand */}
          {data.stepKind === 'fanout' && !hasFanoutChildren && !data.isLoading && (
            <div className="mt-2">
              <button
                onClick={(e) => { e.stopPropagation(); setFanoutOpen(true); }}
                title={t('paradigm.expandTitle')}
                className="w-full border-2 border-dashed border-warm/50 hover:border-warm hover:bg-warm/5 text-warm rounded-control py-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors"
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
            <div className="mt-2 px-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
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
            <div className="mt-1.5 flex flex-wrap items-center gap-0.5 text-ink-faint">
              {hasSummaryCard && !fullDetail && <button onClick={(e) => { e.stopPropagation(); setShowFullResponse((v) => !v); }} data-toggle-full-response aria-expanded={showFullResponse} className="text-xs px-2 py-1 rounded-control text-accent hover:bg-wash">{t(showFullResponse ? 'node.showSummary' : 'node.showFullResponse')}</button>}
              {!isViewerMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); void rerunNode(id, {}); }}
                  className={`rounded-control w-6 h-6 flex items-center justify-center transition-colors ${data.isEvaluator ? 'hover:text-watch hover:bg-red-50' : 'hover:text-accent hover:bg-wash'}`}
                  title={data.isEvaluator ? t('evaluator.rerun') : t('common.regenerate')}
                >
                  <RefreshCw size={14} strokeWidth={1.75} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); void copyText(data.response); }}
                className="rounded-control w-6 h-6 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
                title={t('actions.copyResponse')}
              >
                <Copy size={13} strokeWidth={1.75} />
              </button>
              {!isViewerMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); startEditResponse(); }}
                  className="rounded-control w-6 h-6 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
                  title={t(hasResponseDraft ? 'edit.resumeDraft' : 'actions.editResponse')}
                  data-edit-response
                >
                  <Pencil size={13} strokeWidth={1.75} />
                </button>
              )}
              <AgentRerunButton nodeId={id} data={data} />
              {data.focusRole === 'ctx' && (
                <span className="w-[7px] h-[7px] rounded-full bg-accent inline-block ml-1 shrink-0" title={t('focus.inContext')} data-focus-dot />
              )}
              {(data.generatedBy?.[data.responseIndex]) && (
                <span
                  className="text-2xs text-ink-faint font-mono ml-1 truncate flex-1 min-w-0 max-w-[260px]"
                  title={`${t('node.generatedByTitle')} · ${describeModel(data.generatedBy[data.responseIndex], data.generatedEfforts?.[data.responseIndex])}`}
                >
                  {describeModel(data.generatedBy[data.responseIndex], data.generatedEfforts?.[data.responseIndex], { compact: true })}
                </span>
              )}
              {data.agentSession?.continued && (
                <span className="text-2xs text-ink-faint ml-1 shrink-0" title={t('agent.continuedTitle')} data-agent-continued>↩ {t('agent.continued')}</span>
              )}
              {data.importSource?.runner === 'pi' && window.desktopSessions && (
                <button
                  onClick={(e) => { e.stopPropagation(); void window.desktopSessions!.openInCli('pi', data.importSource!.cwd ?? '', data.importSource!.sessionId, 'terminal'); }}
                  className="rounded-control w-6 h-6 flex items-center justify-center hover:text-accent hover:bg-wash transition-colors"
                  title={t('agent.openInTerminal')}
                  data-open-in-terminal
                >
                  <SquareTerminal size={13} strokeWidth={1.75} />
                </button>
              )}
              {data.gatewaySearches?.[data.responseIndex] && (
                <span className="text-2xs text-ink-faint ml-1 shrink-0" title={t('node.gatewaySearchedTitle')} data-gateway-searched>
                  🌐 {t('node.gatewaySearched')}
                </span>
              )}
              {data.generatedAts?.[data.responseIndex] && (
                <span className="text-2xs text-ink-faint font-mono ml-1 shrink-0" title={t('node.generatedAtTitle')} data-generated-at>
                  {formatStamp(data.generatedAts[data.responseIndex]!)}
                </span>
              )}
              {hasMultipleVersions && (
                <div className="flex items-center gap-1 text-xs text-ink-muted ml-1">
                  <button onClick={(e) => { e.stopPropagation(); navigateVersion(id, 'prev'); }} className="hover:text-accent hover:bg-wash rounded-control w-5 h-5 flex items-center justify-center transition-colors"><ChevronLeft size={14} strokeWidth={1.75} /></button>
                  <span className="text-accent font-medium">v{data.responseIndex + 1}/{data.responses.length}</span>
                  <button onClick={(e) => { e.stopPropagation(); navigateVersion(id, 'next'); }} className="hover:text-accent hover:bg-wash rounded-control w-5 h-5 flex items-center justify-center transition-colors"><ChevronRight size={14} strokeWidth={1.75} /></button>
                  {!isViewerMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteVersion(id, data.responseIndex); }}
                      className="text-ink-faint hover:text-red-500 hover:bg-red-50 rounded-control w-5 h-5 flex items-center justify-center transition-colors"
                      title={t('common.deleteVersion')}
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
            <div className="mt-2 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-content px-3 py-2">
              <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" />
              {t('common.generationFailed')}
              {hasMultipleVersions && (
                <span className="flex items-center gap-1 text-ink-muted shrink-0" title={t('node.backToVersionTitle')}>
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

          {/* Branch context indicator when branching from selection */}
          {branchFromText && (
            <div className="mt-3 text-xs pl-3 py-2 pr-2 border border-accent/25 bg-accent/5 rounded-content">
              <span className="text-accent font-medium"><GitBranch size={14} strokeWidth={1.75} className="inline" /> {t('node.exploringFrom')}</span>
              <p className="text-ink-muted mt-1 leading-relaxed">&ldquo;{branchFromText.slice(0, 150)}{branchFromText.length > 150 ? '...' : ''}&rdquo;</p>
            </div>
          )}

          {/* Inline continue input — hidden while a paradigm run is in
              progress (the structure IS the paradigm); returns on unlock */}
          {!data.isLoading && !data.isEditingResponse && !isAwaitingAsk && !(isParadigmNode && runLocked) && !isViewerMode && selectedNodeId !== id && (
            <div className="mt-3 pt-3 border-t border-line relative">
              <MentionSurface m={mention} text={inputValue} setText={setInputValue} />
              <div className="flex items-end gap-2 bg-wash rounded-content px-4 py-2.5 transition-colors focus-within:ring-1 focus-within:ring-accent/40">
                <textarea
                  rows={1}
                  ref={mention.bindAnchor}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    mention.track(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder={t('common.followUp')}
                  className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none resize-none leading-relaxed max-h-[120px] overflow-y-auto nowheel nopan nodrag"
                />
                <SearchToggles size={15} />
                <button
                  onClick={handleSubmitBranch}
                  disabled={!inputValue.trim()}
                  className="text-ink-faint hover:text-accent disabled:opacity-30 disabled:hover:text-ink-faint transition-colors shrink-0 rounded-control w-7 h-7 flex items-center justify-center hover:bg-line"
                >
                  <Send size={18} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsed view — question + summary */}
      {isCollapsed && (
        <div className="p-surface-inset">
          <div className="text-sm text-ink font-semibold truncate flex items-center gap-1.5">
            <span title={nodeNameSource} data-node-name>{nodeName}</span>
            {(data.attachments?.length > 0) && (
              <span className="text-2xs bg-wash text-ink-muted px-1.5 py-0.5 rounded-tag shrink-0"><Paperclip size={12} strokeWidth={1.75} className="inline" />{data.attachments.length}</span>
            )}
            {(data.references?.length ?? 0) > 0 && (
              <span className="text-2xs bg-wash text-ink-muted px-1.5 py-0.5 rounded-tag shrink-0"><Globe size={12} strokeWidth={1.75} className="inline" /> {data.references!.length}</span>
            )}
            {toolMarks.length > 0 && (
              <span className="text-2xs text-ink-muted shrink-0 select-none" title={marksTitle}>{marksLine}</span>
            )}
            {compBar}
          </div>
          {prints.length > 0 && (
            <div
              className="text-2xs text-ink-faint font-mono mt-1 truncate select-none"
              title={`${t('node.footprint')}\n${prints.map((f) => `${f.op === 'read' ? '📖' : '✏️'} ${f.path}`).join('\n')}`}
              data-footprint
            >
              {prints.slice(0, 3).map((f) => `${f.op === 'read' ? '📖' : '✏️'} ${f.name}`).join('   ')}{prints.length > 3 ? `   +${prints.length - 3}` : ''}
            </div>
          )}
          {versionLadder ? (
            // the same abstract the map plaque shows, at strip size: zooming
            // in from the plaque changes the type, not the words, and the
            // strip fills the 240px the layout keeps for a folded node
            <div className="text-xs text-ink-muted mt-1.5 leading-relaxed line-clamp-6" data-folded-abstract>
              {levelText(versionLadder, 3)}
            </div>
          ) : versionSummary ? (
            <div className="text-xs text-ink-muted mt-1.5 leading-relaxed line-clamp-2">
              {versionSummary}
            </div>
          ) : data.response ? (
            <div className="text-xs text-ink-muted mt-1.5 leading-relaxed line-clamp-2 italic">
              {data.importSource ? conclusionOf(data.response) : `${data.response.replace(/[#*`>-]/g, '').slice(0, 120)}${data.response.length > 120 ? '…' : ''}`}
            </div>
          ) : null}
        </div>
      )}

      </>
      )}

      {/* Floating toolbar for text selection */}
      {selectedText && selectionPos && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(0, Math.min(selectionPos.x, 400)),
            top: Math.max(-40, selectionPos.y),
            transform: 'translateX(-50%)',
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex gap-1 bg-card border border-line rounded-overlay p-1 animate-fade-in">
            <button
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleBranch(); }}
              className="bg-action hover:bg-action-strong text-white text-xs px-3 py-1.5 rounded-control transition-all whitespace-nowrap cursor-pointer"
            >
              <GitBranch size={14} strokeWidth={1.75} className="inline" /> {t('common.explore')}
            </button>
            {!selectionPos.inCode && (
              <button
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleHighlight(); }}
                className="bg-amber-500 hover:bg-amber-400 text-white text-xs px-3 py-1.5 rounded-control transition-all whitespace-nowrap cursor-pointer"
              >
                <Star size={14} strokeWidth={1.75} className="inline" /> {t('common.highlight')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
