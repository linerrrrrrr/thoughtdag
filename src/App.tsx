import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  SelectionMode,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnNodeDrag,
  type SelectionDragHandler,
  type ReactFlowInstance,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import 'highlight.js/styles/github.css';
import { ArrowRight, BookOpen, Bot, Brain, CircleHelp, Download, FileDown, Drama, Eye, FileText, FolderSync, Frame, GitBranch, Hand, Highlighter, History as HistoryIcon, ImageDown, KeyRound, ListRestart, Loader2, MessageCircleQuestion, Minimize2, MoreHorizontal, Paperclip, Redo2, Rewind, Scissors, Search, Share2, SlidersHorizontal, SquareTerminal, Star, Stethoscope, StickyNote, Trash2, Undo2, Workflow, X } from 'lucide-react';
import './index.css';
import { ListFilter } from 'lucide-react';
import ThoughtNode from './components/ThoughtNode';
import CanvasWheelZoom from './components/CanvasWheelZoom';
import CanvasControls from './components/CanvasControls';
import CanvasDetailControl from './components/CanvasDetailControl';
import ParadigmNode from './components/ParadigmNode';
import { useAppearance, edgePalette, LEGACY_EDGE_HEX } from './lib/appearance';
import ContentNode from './components/ContentNode';
import FrameNode from './components/FrameNode';
import ThoughtEdgeView from './components/ThoughtEdgeView';
import SelectionInspector from './components/SelectionInspector';
import CanvasLayoutPanel, { type CanvasLayoutPanelHandle } from './components/CanvasLayoutPanel';
import { canvasToolViewport, useCanvasPanelPosition, useFocusPanelSpace } from './lib/use-canvas-panel-position';
import { CanvasToolbarOverflowContext, restoreCanvasToolbarFocus, useResponsiveCanvasHeader } from './lib/use-responsive-canvas-header';
import CanvasToolbarOverflowAction from './components/CanvasToolbarOverflowAction';
import { useCanvasSelectionCard, useCanvasToolCard, useCanvasToolCards } from './lib/use-canvas-tool-card';
import { useCanvasEditing } from './lib/canvas-editing';
import { useContextInspection } from './lib/context-inspection';
import { CanvasQuickLayoutContext, quickCanvasLayout } from './lib/canvas-layout-preferences';
import { createEdgeAnchorResolver, positionNodeAtConnectionEnd } from './lib/edge-anchors';
import { createEdgeRoutingContext } from './lib/edge-path';
import { CanvasEdgeRouting } from './lib/edge-routing-context';
import { useEdgeRoutingPreferences } from './lib/edge-routing-preferences';
import FocusPanel from './components/focus-panel';
import SelectionResizeControls from './components/SelectionResizeControls';
import SelectionRegion from './components/SelectionRegion';
import NodeContextMenu from './components/NodeContextMenu';
import HighlightsOverviewModal from './components/ui/HighlightsOverviewModal';
import MaterialsOverviewModal from './components/ui/MaterialsOverviewModal';
import SearchBar from './components/SearchBar';
import CanvasChat from './components/CanvasChat';
import { REPO_URL, useGithubStars, formatStars } from './lib/github-stars';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import MaterialReader from './components/MaterialReader';
import ProjectSwitcher from './components/ProjectSwitcher';
import SessionAtlas from './components/SessionAtlas';
import { useStore } from './store';
import { undoState } from './store/slices/history';
import { canvasHistoryCommand, isTextEditingTarget } from './lib/canvas-shortcuts';
import { shownStaleIds } from './lib/stale-judge';
import { isFrameNode, resolveCarriedNodeIds } from './lib/frames';
import { enclosedSelection, partitionSpatialSelection, intersectingEdgeSelection, snapshotEdgeSelectionPaths, type SelectionTarget, type EdgeSelectionPath, type SelectionRegion as SelectionRegionState } from './lib/canvas-selection';
import type { ArrangeRect } from './lib/arrange-selection';
import { nodeLayerIndices } from './lib/node-layer';
import { useProjects, adoptImportedProject, markInstantiatedFrom } from './store/projects';
import { projectStorageKey } from './store/projects';
import { set as idbSet } from 'idb-keyval';
import { instantiateParadigm } from './lib/paradigm';
import { isContentKind, spawnContentNode, ingestFiles, fetchLinkIntoNode, clipboardTextToMarkdown } from './lib/content';
import { createQuestionDraft } from './lib/question-draft';
import { generateId, isImeComposing } from './utils';
import { recapToNote, recapCamera } from './lib/recap';
import type { Attachment, ThoughtNode as ThoughtNodeType, ThoughtEdge } from './types';
import { processFile, FILE_INPUT_ACCEPT } from './lib/attachments';
import { walkUpAncestors, partitionContext } from './lib/graph';
import { buildContext } from './store/context-builder';
import { exportActiveParadigm, exportActiveProjectJson, exportEventLogCsv } from './lib/export';
import { countTokens } from './utils';
import { buildExampleGraph } from './lib/example-graph';
import { COLORS, FRAME_COLORS, PANEL_INSET, EDGE_ARROW_GEOMETRY } from './lib/constants';
import { panelShift } from './lib/panel-shift';
import { useReaderDock } from './lib/reader-dock';
import { handleDismissableLayerKeyDown, useDismissableLayer } from './lib/use-dismissable-layer';
import { migrateActiveCanvasToVault, gcVaultAtBoot } from './lib/attachment-vault-boot';
import { consumeOpenRouterCallback, handMintedKeyToModal, startOpenRouterOAuth } from './lib/openrouter-oauth';
import { bootDesktopUpdateUI } from './lib/desktop-update-ui';
import { confirmDialog, toast, useUiStore } from './lib/ui-store';
import ConfirmDialog from './components/ui/ConfirmDialog';
import Toaster from './components/ui/Toaster';
import GlobalTooltip from './components/ui/GlobalTooltip';
import RoleManagerModal from './components/ui/RoleManagerModal';
import MemoryManagerModal from './components/ui/MemoryManagerModal';
import ApiKeyModal from './components/ui/ApiKeyModal';
import ShareDialog from './components/ui/ShareDialog';
import ThoughtMapDialog from './components/ui/ThoughtMapDialog';
import BackupDialog from './components/ui/BackupDialog';
import CondenseDialog from './components/ui/CondenseDialog';
import { backupCapable } from './lib/local-backup';
import LangSwitch from './components/ui/LangSwitch';
import ModelPicker from './components/ui/ModelPicker';
import RoleTemplateChips from './components/ui/RoleTemplateChips';
import SearchToggles from './components/ui/SearchToggles';
import Tutorial from './components/Tutorial';
import WhatsNewDialog from './components/ui/WhatsNewDialog';
import LadderJobCard from './components/ui/LadderJobCard';
if (import.meta.env.DEV) void import('./lib/ladder-lab');
import ReleaseNotesDialog from './components/ui/ReleaseNotesDialog';
import AgentCwdChip from './components/ui/AgentCwdChip';
import AgentPermissionChip from './components/ui/AgentPermissionChip';
import WaitingPill from './components/ui/WaitingPill';
import { pluginUpdateCommand } from './lib/plugin-update';
import { useT, t as ti, fmt, useI18n } from './i18n';
import { isViewerMode, buildViewerLink } from './lib/viewer';
import { useModels } from './lib/use-models';
import { useZoomTier } from './lib/use-map-mode';
import { TimelineBar } from './components/ui/TimelineBar';
import TimelineOverviewModal from './components/ui/TimelineOverviewModal';
import { useStore as useRfStore, useReactFlow } from '@xyflow/react';

// One node type key, three renderers: content nodes (notes / files) render
// the same in every mode; otherwise the active project's kind decides
// whether a node is a conversation card or an orchestration step card.
// memo matters at scale: a 555-node canvas re-rendering every visible card
// on each React Flow store tick is the difference between smooth and stuck
const NodeDispatch = memo(function NodeDispatch(props: Parameters<typeof ThoughtNode>[0]) {
  const isParadigm = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.kind === 'paradigm');
  if (props.data?.stepKind === 'frame') return <FrameNode {...props} />;
  if (isContentKind(props.data?.stepKind)) return <ContentNode {...props} />;
  return isParadigm ? <ParadigmNode {...props} /> : <ThoughtNode {...props} />;
});
const nodeTypes = { thought: NodeDispatch };
// Overrides the built-in smoothstep so persisted edges need no migration
const edgeTypes = { smoothstep: memo(ThoughtEdgeView) };

// Gate on rehydration: the store loads asynchronously from IndexedDB, and
// mounting the canvas only after hydration lets ReactFlow's fitView see the
// restored graph (and avoids flashing the landing input).
export default function App() {
  const [hydrated, setHydrated] = useState(isViewerMode || useStore.persist.hasHydrated());
  useEffect(() => useStore.persist.onFinishHydration(() => setHydrated(true)), []);
  // Attachment vault: whenever the graph changes (hydration, project
  // switch, seed load, import), lighten any PDF still carrying its bytes
  // inline. The check is one cheap some() pass and the migration itself is
  // idempotent, so a debounced subscription beats racing load timings.
  useEffect(() => {
    if (!hydrated || isViewerMode) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void migrateActiveCanvasToVault(), 800);
    };
    const unsub = useStore.subscribe((s, prev) => { if (s.nodes !== prev.nodes) kick(); });
    kick();
    return () => { unsub(); clearTimeout(timer); };
  }, [hydrated]);
  // Sweep orphaned vault payloads once per boot, off the critical path.
  useEffect(() => {
    // A condense build cannot survive a page load — its runner lives in
    // module memory. A leftover 'building' here is a stale lock: clear it.
    if (useUiStore.getState().condenseRun.status === 'building') {
      useUiStore.getState().setCondenseRun({ status: 'idle', current: 0, total: 0, streaming: '' });
    }
  }, []);
  useEffect(() => {
    if (isViewerMode) return;
    const timer = setTimeout(() => void gcVaultAtBoot(), 6000);
    return () => clearTimeout(timer);
  }, []);
  // True first launch (no tutorial ever closed, an empty canvas, not a
  // shared-link viewer): open the lesson unprompted. The example-canvas
  // button keeps its own trigger for people who skip straight there.
  useEffect(() => {
    if (!hydrated || isViewerMode) return;
    if (localStorage.getItem('thoughtdag.tutorialDone')) return;
    if (useStore.getState().nodes.length > 0) return;
    const timer = setTimeout(() => useUiStore.getState().setTutorialOpen(true), 900);
    return () => clearTimeout(timer);
  }, [hydrated]);

  // Desktop shell: update prompts render as in-app toasts (no-op on web)
  useEffect(() => { bootDesktopUpdateUI(); }, []);

  // A pending Sign-in-with-OpenRouter callback (?code=) resolves here: the
  // exchange runs entirely in the browser, then the ApiKeyModal opens on
  // the model-picking view for the user to confirm what to enable.
  // /thoughtdag handoff: #import-url=<loopback> imports a runner session
  // straight onto a fresh canvas (validation + one-shot in the consumer)
  useEffect(() => {
    if (isViewerMode) return;
    void import('./lib/session-handoff').then((m) => m.consumeSessionHandoff());
    // desktop only: the live mirror — the active canvas follows its
    // session file on its own (idempotent append via the ledger)
    void import('./lib/atlas/live-mirror').then((m) => m.startLiveMirror());
    // desktop only: the canvas writes its own source record for the why
    // layer, whether or not a backup folder was ever chosen
    void import('./lib/canvas-record').then((m) => m.startCanvasRecord());
    // ledger self-heal: canvases weeded before deletion-as-unsubscription
    // existed may still carry dead subscriptions — clear them on arrival
    void import('./lib/atlas/canonical').then((m) => m.unsubscribeOrphanedSessions());
  }, []);

  useEffect(() => {
    if (isViewerMode) return;
    void consumeOpenRouterCallback().then((r) => {
      if (!r) return;
      if (r.status === 'minted') {
        toast('success', ti('provider.oauthMinted'));
        handMintedKeyToModal(r.key);
      } else {
        toast('error', fmt(ti('provider.oauthFailed'), { error: r.error }));
      }
    });
  }, []);
  return (
    <>
      {hydrated && <Canvas />}
      <Toaster />
      <LadderJobCard />
      <GlobalTooltip />
      <RoleManagerModal />
      <MemoryManagerModal />
      <ApiKeyModal />
      <ShareDialog />
      <ThoughtMapDialog />
      <BackupDialog />
      <ConfirmDialog />
      <Tutorial />
      <WhatsNewDialog />
      <ReleaseNotesDialog />
    </>
  );
}

function Canvas() {
  const { nodes, edges, setNodes, setEdges, addQuestion, undo, redo, addCrossLink, setSelectedNodeId, setSelectedNodeIds, history, historyIndex } = useStore();
  const { propertiesRequest, layoutOpen, layoutPreview, selectionTarget } = useCanvasEditing();
  const selectedEdges = edges.filter(edge => edge.selected && !edge.hidden);
  const editingEdge = selectedEdges.length === 1 ? selectedEdges[0] : undefined;
  const anchorResolver = useRef(createEdgeAnchorResolver());
  const pendingConnectionDrops = useRef(new Map<string, {
    parentId: string; end: { x: number; y: number }; node: ThoughtNodeType;
  }>());
  const activeProjectId = useProjects((s) => s.activeId);
  useEffect(() => {
    anchorResolver.current.clear();
    pendingConnectionDrops.current.clear();
    useCanvasEditing.getState().reset();
    useUiStore.getState().setPanelOpen(false);
  }, [activeProjectId]);
  const openEdgeEditor = useCallback((id: string) => {
    if (isViewerMode) return;
    useCanvasEditing.getState().setSelectionRegion(null);
    useStore.getState().setSelectedNodeIds([]);
    useStore.setState((state) => ({ edges: state.edges.map((edge) => ({ ...edge, selected: edge.id === id })) }));
    useCanvasEditing.getState().requestProperties();
  }, []);
  const undoable = undoState({ nodes, edges, history, historyIndex });
  const t = useT();
  const setTutorialOpen = useUiStore((s) => s.setTutorialOpen);
  const annotationsHidden = useUiStore((s) => s.annotationsHidden);
  const setAnnotationsHidden = useUiStore((s) => s.setAnnotationsHidden);
  const wheelPans = useUiStore((s) => s.wheelPans);
  const setWheelPans = useUiStore((s) => s.setWheelPans);
  const [inputValue, setInputValue] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // the ⋯ menu's GitHub entry carries the star count: the cached number at once, a fresh one within the hour
  const githubStars = useGithubStars();
  const [rootRole, setRootRole] = useState('');
  const [showRootRole, setShowRootRole] = useState(false);
  const [landingAtlas, setLandingAtlas] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [isDraggingLanding, setIsDraggingLanding] = useState(false);
  const landingFileRef = useRef<HTMLInputElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const hasNodes = nodes.length > 0;
  const hasEvents = useStore((s) => s.events.length > 0);
  const highlightCount = useStore((s) => s.nodes.reduce((sum, n) => sum + (n.data.highlights?.length ?? 0), 0));
  const materialCount = useStore((s) => s.nodes.reduce((sum, n) =>
    sum + (n.data.attachments?.length ?? 0) + (['note', 'link'].includes(n.data.stepKind ?? '') ? 1 : 0), 0));
  const rfInstance = useRef<ReactFlowInstance<ThoughtNodeType, ThoughtEdge> | null>(null);
  const layoutPanelRef = useRef<CanvasLayoutPanelHandle>(null);
  const quickLayout = useCallback((ids?: string[]) => quickCanvasLayout(rfInstance.current, ids), []);
  const getViewportRect = useCallback((): ArrangeRect | undefined => {
    const viewport = rfInstance.current?.getViewport();
    const canvas = document.querySelector<HTMLElement>('.react-flow');
    if (!viewport || !canvas) return undefined;
    const canvasBounds = canvas.getBoundingClientRect();
    const panelBounds = document.querySelector<HTMLElement>('[data-focus-panel], [data-edge-inspector]')?.getBoundingClientRect();
    const visibleRight = panelBounds ? Math.min(canvasBounds.right, panelBounds.left) : canvasBounds.right;
    return { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: Math.max(0, visibleRight - canvasBounds.left) / viewport.zoom, height: canvas.clientHeight / viewport.zoom };
  }, []);
  // Arrival focus, runtime lane: a harvest appends to the LIVE canvas (no
  // remount, so onInit never fires) — consume the one-shot here instead.
  const arrivalFocus = useUiStore((s) => s.arrivalFocusNodeId);
  useEffect(() => {
    if (!arrivalFocus) return;
    const n = useStore.getState().nodes.find((x) => x.id === arrivalFocus);
    if (!n) return;
    useUiStore.getState().setArrivalFocusNodeId(null);
    window.setTimeout(() => {
      rfInstance.current?.setCenter(n.position.x + 260, n.position.y + 140, { zoom: 0.9, duration: 400 });
    }, 150);
  }, [arrivalFocus]);
  // Appearance: lighting swaps the token set, paper swaps the canvas texture
  // (and turns the grid's snapping on). Edge colors resolve per theme.
  const paperTexture = useAppearance((s) => s.paper);
  const lightingChoice = useAppearance((s) => s.lighting);
  const resolvedTheme = useAppearance((s) => s.resolved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const themePalette = useMemo(() => edgePalette(), [resolvedTheme]);
  // The minimap viewport uses a light tint and an explicit boundary, not a shadow-like slab.
  const minimapColors = useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const ink = (cs.getPropertyValue('--color-ink-muted').trim() || '#515E70').replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(ink.slice(i, i + 2), 16));
    return {
      mask: `rgba(${r},${g},${b},0.10)`,
      viewportBorder: cs.getPropertyValue('--color-line-strong').trim() || '#939FAF',
      archived: cs.getPropertyValue('--color-wash').trim() || '#EBEEF3',
      ordinary: resolvedTheme === 'dark' ? '#728098' : '#939FAF',
    };

  }, [resolvedTheme]);
  const prevNodeCount = useRef(nodes.length);
  // Every "center on node" goes through here: when the focus panel is open
  // the visual center sits half the panel further left, so the target shifts
  // right by panelShift/2 in world units — otherwise the node parks under
  // the panel.
  const centerNode = useCallback((n: { id: string; position: { x: number; y: number } }, opts: { zoom?: number; duration?: number; offX?: number } = {}) => {
    const rf = rfInstance.current;
    if (!rf) return;
    const zoom = opts.zoom ?? rf.getZoom();
    rf.setCenter(
      n.position.x + (opts.offX ?? 260) + panelShift(n.id) / (2 * zoom),
      n.position.y + 110,
      { zoom, duration: opts.duration ?? 350 },
    );
  }, []);
  const lang = useI18n((s) => s.lang);
  const condenseRunState = useUiStore((s) => s.condenseRun);
  const condenseBuilding = condenseRunState.status === 'building';
  const isParadigm = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.kind === 'paradigm');

  // No configured model: do NOT ambush the first open with the key dialog —
  // the example canvas needs no key and must be the first thing a newcomer
  // sees. The dialog is summoned where it has context instead: the toolbar
  // key button, the model picker, and the moment a generation actually
  // needs a model (streaming.ts opens it on the no-model error).
  const modelData = useModels();
  void modelData;

  const loadExample = useCallback(() => {
    const { nodes: exNodes, edges: exEdges } = buildExampleGraph(lang);
    const st = useStore.getState();
    st.pushHistory();
    st.setNodes([...st.nodes, ...exNodes.filter((n) => !st.nodes.some((x) => x.id === n.id))]);
    st.setEdges([...st.edges, ...exEdges.filter((e) => !st.edges.some((x) => x.id === e.id))]);
    st.pushHistory();
    setTimeout(() => {
      const inst = rfInstance.current;
      if (!inst) return;
      inst.fitView({ duration: 500, padding: 0.1 });
      // A laptop-sized window fits the whole example only at glyph zoom,
      // where every teaching card is unreadable. After the overview beat,
      // land on the oldest node (the welcome card) at takeaway zoom.
      setTimeout(() => {
        if (inst.getViewport().zoom < 0.34) {
          const first = [...useStore.getState().nodes]
            .sort((x, y) => (x.data.createdAt ?? '').localeCompare(y.data.createdAt ?? ''))[0];
          if (first) inst.setCenter(first.position.x + 300, first.position.y + 240, { zoom: 0.6, duration: 550 });
        }
      }, 680);
    }, 100);
    // the example canvas is the classroom: first visit opens the lesson
    if (!localStorage.getItem('thoughtdag.tutorialDone')) setTutorialOpen(true);
  }, [lang, setTutorialOpen]);

  // ── Orchestration (paradigm) mode helpers ──
  const addStep = useCallback((kind: 'human' | 'prompt') => {
    const st = useStore.getState();
    const last = st.nodes[st.nodes.length - 1];
    const pos = last ? { x: last.position.x, y: last.position.y + 340 } : { x: 120, y: 80 };
    const id = generateId();
    st.pushHistory();
    st.setNodes([...st.nodes, {
      id, type: 'thought', position: pos, dragHandle: '.drag-handle',
      data: {
        question: '', instruction: '', stepKind: kind,
        response: '', responses: [], responseIndex: -1,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 0, highlights: [], highlightMode: 'tag',
        attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: st.nodes.length === 0, isBranch: false,
      },
    }]);
    st.pushHistory();
  }, []);

  // After a project switch (from the switcher or the landing shortcuts):
  // reset the recenter baseline and refit the viewport.
  const afterProjectSwitch = useCallback(() => {
    anchorResolver.current.clear();
    useCanvasEditing.getState().reset();
    useUiStore.getState().setPanelOpen(false);
    prevNodeCount.current = useStore.getState().nodes.length;
    setTimeout(() => rfInstance.current?.fitView({ duration: 300, padding: 0.2 }), 50);
  }, []);
  // the memory page (rendered outside this component) switches canvases too
  useEffect(() => {
    const h = () => afterProjectSwitch();
    window.addEventListener('td:project-switched', h);
    return () => window.removeEventListener('td:project-switched', h);
  }, [afterProjectSwitch]);

  // ── Content palette + canvas paste/drop: material lands where you point ──
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  // Frame: a labeled background region for wayfinding — never in context
  const spawnFrame = useCallback((pos: { x: number; y: number }) => {
    const st = useStore.getState();
    const id = generateId();
    st.pushHistory();
    st.setNodes([...st.nodes, {
      id, type: 'thought', position: pos, width: 640, height: 420, zIndex: -1, dragHandle: '.drag-handle',
      data: {
        question: '', stepKind: 'frame',
        // spawn unlinked: the frame is adjusted over its nodes first, then linked
        frameCarry: false,
        response: '', responses: [], responseIndex: -1,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 0, highlights: [], highlightMode: 'tag',
        attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: false, isBranch: false,
      },
    }]);
    st.pushHistory();
  }, []);

  // Dropped-file gate: accept what we can actually parse (images, PDF, notebooks,
  // text/code). Word and friends would ingest as binary soup — reject with
  // an actionable hint instead.
  const filterDroppedFiles = useCallback((list: FileList | File[]): File[] => {
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (f.type.startsWith('image/') || f.type === 'application/pdf' || f.type.startsWith('text/')
        || ['pdf', 'docx', 'ipynb', 'txt', 'md', 'csv', 'json', 'yaml', 'yml', 'toml', 'js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'c', 'cpp', 'h', 'java', 'rs', 'go', 'rb', 'swift', 'css', 'html', 'xml', 'sql', 'tex', 'bib'].includes(ext)) {
        ok.push(f);
      } else {
        toast('info', fmt(ti('toast.unsupportedFile'), { name: f.name }));
      }
    }
    return ok;
  }, []);

  // Empty turns become requests only when their question is explicitly sent.
  const spawnAskNode = useCallback((pos: { x: number; y: number }) => createQuestionDraft({ position: pos }), []);
  // Material-first entry: every dropped document becomes a material node;
  // the reader opens on the first readable one (PDF/text render instantly,
  // extraction fills the model channel in the background). Attachments to
  // the root question remain an EXPLICIT action (the paperclip).
  const startFromDocuments = useCallback((list: FileList | File[]) => {
    const files = filterDroppedFiles(list);
    if (files.length === 0) return;
    let readerTarget: string | null = null;
    files.forEach((f, i) => {
      const id = spawnContentNode('file', { x: 120 + (i % 3) * 480, y: 120 + Math.floor(i / 3) * 620 });
      void ingestFiles(id, [f]);
      if (!readerTarget && !f.type.startsWith('image/')) readerTarget = id;
    });
    if (readerTarget) useUiStore.getState().setReaderNodeId(readerTarget);
    setTimeout(() => rfInstance.current?.fitView({ duration: 400, padding: 0.2 }), 120);
  }, [filterDroppedFiles]);

  // Palette click-or-drag via pointer events (native DnD's click race lost
  // us real clicks): press = arm; move past 6px = drag with a ghost badge;
  // release = create at the drop point, or at screen center for a click.
  const paletteDrag = useCallback((e: React.PointerEvent, create: (screen: { x: number; y: number } | null) => void) => {
    const startX = e.clientX, startY = e.clientY;
    const source = e.currentTarget as HTMLElement;
    let ghost: HTMLElement | null = null;
    const move = (ev: PointerEvent) => {
      if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        ghost = document.createElement('div');
        ghost.innerHTML = source.innerHTML;
        ghost.style.cssText = 'position:fixed;z-index:300;pointer-events:none;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--color-card);border:1px solid var(--color-accent);border-radius:var(--radius-control);box-shadow:var(--shadow-lg);opacity:.92;';
        document.body.appendChild(ghost);
      }
      if (ghost) { ghost.style.left = `${ev.clientX - 18}px`; ghost.style.top = `${ev.clientY - 18}px`; }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dragged = !!ghost;
      ghost?.remove();
      create(dragged ? { x: ev.clientX, y: ev.clientY } : null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const flowPosAt = useCallback((screen?: { x: number; y: number } | null) => {
    const at = rfInstance.current?.screenToFlowPosition(screen ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 140, y: 140 };
    return { x: at.x - 200, y: at.y - 60 };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { lastMouse.current = { x: e.clientX, y: e.clientY }; };
    // Canvas paste: text → note, a lone URL → link snapshot, files → file
    // node with the image/document itself. Inputs keep their own paste.
    const onPaste = (e: ClipboardEvent) => {
      if (isViewerMode) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const meta = useProjects.getState();
      const isPara = meta.projects.find((p) => p.id === meta.activeId)?.kind === 'paradigm';
      if (useStore.getState().nodes.length === 0 && !isPara) return; // the landing owns paste
      const dt = e.clipboardData;
      if (!dt) return;
      const pos = flowPosAt(lastMouse.current);
      const text = dt.getData('text/plain').trim();
      const files = Array.from(dt.files);
      // FILES WIN when a real document rides along: a Finder/Explorer copy
      // puts the file's PATH in text/plain and the file itself in files —
      // the user copied a file, not its path (regression fixed: the plain
      // text-wins rule ate these). TEXT wins only over image-only files:
      // Word/Excel selections carry text plus a bitmap rendering of it,
      // and there the user copied words, not a picture of words.
      const hasDocFile = files.some((f) => !f.type.startsWith('image/'));
      if (files.length > 0 && (hasDocFile || !text)) {
        e.preventDefault();
        const id = spawnContentNode('file', pos);
        void ingestFiles(id, files);
        return;
      }
      if (text) {
        e.preventDefault();
        if (/^https?:\/\/\S+$/.test(text)) {
          const id = spawnContentNode('link', pos, { linkUrl: text });
          void fetchLinkIntoNode(id, text);
        } else {
          spawnContentNode('note', pos, { question: clipboardTextToMarkdown(text) });
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('paste', onPaste); };
  }, [flowPosAt]);

  const instantiate = useCallback(async () => {
    const st = useStore.getState();
    if (st.nodes.length === 0) return;
    const { nodes: cNodes, edges: cEdges } = instantiateParadigm(st.nodes, st.edges);
    const meta = useProjects.getState();
    const pname = meta.projects.find((p) => p.id === meta.activeId)?.name ?? 'Paradigm';
    const id = crypto.randomUUID();
    await idbSet(projectStorageKey(id), JSON.stringify({ state: { nodes: cNodes, edges: cEdges }, version: 1 }));
    await adoptImportedProject(id, `▶ ${pname}`, 'chat');
    await markInstantiatedFrom(id, pname); // provenance rides in the backup
    prevNodeCount.current = useStore.getState().nodes.length;
    setTimeout(() => rfInstance.current?.fitView({ duration: 400, padding: 0.15 }), 150);
  }, []);

  // First visit lands on the LANDING page — the example canvas is one
  // labeled click away there, not an ambush.
  useEffect(() => {
    // The seeded flag is write-only in app code; it stays as the hook
    // scripts/smoke.mjs uses to suppress the landing flow in tests.
    if (nodes.length === 0 && !isParadigm && !localStorage.getItem('thoughtdag.seeded')) {
      localStorage.setItem('thoughtdag.seeded', 'yes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (nodes.length > prevNodeCount.current && rfInstance.current) {
      const newest = nodes[nodes.length - 1];
      if (newest) {
        setTimeout(() => centerNode(newest, { zoom: 1, duration: 400, offX: 220 }), 100);
      }
    }
    prevNodeCount.current = nodes.length;
  }, [nodes, centerNode]);

  // Apply React Flow changes against the LIVE store state, never the render
  // closure: a click that both mutates a node (e.g. submitting a human turn)
  // and emits a selection change in the same tick would otherwise clobber
  // the mutation with the stale pre-render snapshot.
  // Keep the additive baseline before React Flow clears its internal selection.
  // The rectangle selects measured node footprints independently of groups.
  const marquee = useRef<{ start: { x: number; y: number }; baseNodes: string[]; baseFrames: string[]; baseEdges: string[]; ids: string[]; active: boolean; target: SelectionTarget; paths: EdgeSelectionPath[]; region: SelectionRegionState | null } | null>(null);
  const marqueeClickPending = useRef(false);
  const isRetainedSelectionPane = useCallback((event: Pick<React.MouseEvent, 'target' | 'clientX' | 'clientY'>) => {
    if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return false;
    const region = useCanvasEditing.getState().selectionRegion;
    const point = rfInstance.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    return !!region && region.nodeIds.length + region.edgeIds.length + region.frameIds.length > 0
      && !!point && point.x >= region.rect.x && point.x <= region.rect.x + region.rect.width
      && point.y >= region.rect.y && point.y <= region.rect.y + region.rect.height;
  }, []);
  const syncMarqueeSelection = useCallback((ids: string[]) => {
    const selected = new Set(ids);
    useStore.setState(state => ({
      selectedNodeIds: marquee.current?.target === 'edges' ? [] : ids,
      selectedNodeId: marquee.current?.target !== 'edges' && ids.length === 1 ? ids[0] : null,
      // React Flow mutates its lookup before notifying onNodesChange. Fresh
      // objects force it to adopt our additive selection as well.
      nodes: state.nodes.map(node => ({ ...node, selected: marquee.current?.target !== 'edges' && selected.has(node.id) })),
      edges: state.edges.map(edge => ({ ...edge, selected: marquee.current?.target === 'edges' && selected.has(edge.id) })),
    }));
  }, []);
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const current = useStore.getState().nodes;
      // Preview dimensions belong to the rendered overlay, not to the saved
      // graph. Keep the rendered flag through dismissal until React Flow has
      // received the original geometry again; its observer may still be queued.
      const previewing = layoutPreview || useCanvasEditing.getState().layoutPreview;
      const accepted = changes.filter(change => !(marquee.current && change.type === 'select')
        && !(previewing && (change.type === 'dimensions' || change.type === 'position')));
      if (!accepted.length) return;
      let next = applyNodeChanges(accepted, current) as typeof current;
      const settled = new Map<ThoughtNodeType, ThoughtNodeType['position']>();
      for (const [id, pending] of pendingConnectionDrops.current) {
        const node = next.find(item => item.id === id);
        const parent = next.find(item => item.id === pending.parentId);
        if (!node || !parent || node.dragging || node.position.x !== pending.node.position.x || node.position.y !== pending.node.position.y) {
          pendingConnectionDrops.current.delete(id);
          continue;
        }
        const handles = rfInstance.current?.getInternalNode(id)?.internals.handleBounds?.target;
        if (!node.measured?.width || !node.measured.height || !handles?.length) continue;
        const position = positionNodeAtConnectionEnd(parent, node, pending.end, handles);
        next = next.map(item => item.id === id ? { ...item, position } : item);
        settled.set(pending.node, position);
        pendingConnectionDrops.current.delete(id);
      }
      if (settled.size) {
        // The first real measurement completes creation (not a second move).
        // Keep its undo/redo snapshot at the same final port-anchored position.
        useStore.setState(state => ({ nodes: next, history: state.history.map(snapshot => snapshot.nodes.some(node => settled.has(node)) ? {
          ...snapshot, nodes: snapshot.nodes.map(node => settled.has(node) ? { ...node, position: settled.get(node)! } : node),
        } : snapshot) }));
      } else setNodes(next);
    },
    [setNodes, layoutPreview]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // The custom marquee owns selection for the explicitly chosen type.
      const accepted = marquee.current ? changes.filter(change => change.type !== 'select') : changes;
      if (accepted.length) setEdges(applyEdgeChanges(accepted, useStore.getState().edges));
    },
    [setEdges]
  );

  // Freeze frame membership at drag start. React Flow moves the
  // directly dragged nodes; only the extra carried members are moved here.
  const carriedDrag = useRef<{ anchorId: string; start: { x: number; y: number }; members: { id: string; start: { x: number; y: number } }[] } | null>(null);
  const startCarry = useCallback((anchor: ThoughtNodeType, dragged: ThoughtNodeType[]) => {
    useCanvasEditing.getState().setSelectionRegion(null);
    useStore.getState().pushHistory();
    const st = useStore.getState();
    const direct = new Set(dragged.length ? dragged.map((n) => n.id) : [anchor.id]);
    // Dragging and alignment share the same complete spatial objects.
    const carried = new Set(resolveCarriedNodeIds(st.nodes, [...direct]));
    const members = st.nodes.filter((n) => carried.has(n.id) && !direct.has(n.id))
      .map((n) => ({ id: n.id, start: n.position }));
    carriedDrag.current = members.length ? { anchorId: anchor.id, start: anchor.position, members } : null;
  }, []);
  const moveCarry = useCallback((node: ThoughtNodeType) => {
    const drag = carriedDrag.current;
    if (!drag || node.id !== drag.anchorId) return;
    const dx = node.position.x - drag.start.x;
    const dy = node.position.y - drag.start.y;
    const moved = new Map(drag.members.map((m) => [m.id, { x: m.start.x + dx, y: m.start.y + dy }]));
    useStore.setState((st) => ({
      nodes: st.nodes.map((n) => {
        const pos = moved.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
    }));
  }, []);
  const onNodeDragStart: OnNodeDrag<ThoughtNodeType> = useCallback((_e, node, dragged) => startCarry(node, dragged), [startCarry]);
  const onNodeDrag: OnNodeDrag<ThoughtNodeType> = useCallback((_e, node) => moveCarry(node), [moveCarry]);
  const onNodeDragStop: OnNodeDrag<ThoughtNodeType> = useCallback(() => {
    carriedDrag.current = null;
    useStore.getState().pushHistory();
  }, []);
  const onSelectionDragStart: SelectionDragHandler<ThoughtNodeType> = useCallback((_e, dragged) => {
    if (dragged[0]) startCarry(dragged[0], dragged);
  }, [startCarry]);
  const onSelectionDrag: SelectionDragHandler<ThoughtNodeType> = useCallback((_e, dragged) => {
    const anchor = dragged.find((n) => n.id === carriedDrag.current?.anchorId);
    if (anchor) moveCarry(anchor);
  }, [moveCarry]);
  const onSelectionDragStop: SelectionDragHandler<ThoughtNodeType> = useCallback(() => {
    carriedDrag.current = null;
    useStore.getState().pushHistory();
  }, []);

  // Edge right-click context menu
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: { id: string }) => {
    if (isViewerMode) return; // read-only: keep the browser menu
    // Right-click on selected TEXT keeps the native menu (copy must work)
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    setNodeMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      if (isViewerMode) return;
      event.preventDefault();
      setEdgeMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    []
  );

  // Close menu on click anywhere
  useEffect(() => {
    if (!edgeMenu) return;
    const handler = () => setEdgeMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [edgeMenu]);

  const deleteEdges = useStore((s) => s.deleteEdges);

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdgeMenu(null);
      void confirmDialog({ title: ti('selection.deleteEdges'), message: fmt(ti('selection.deleteEdgesConfirm'), { n: 1 }),
        confirmLabel: ti('common.delete'), danger: true }).then(ok => { if (ok) deleteEdges([edgeId]); });
    },
    [deleteEdges]
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (connection.source && connection.target) {
        addCrossLink(connection.source, connection.target);
      }
    },
    [addCrossLink]
  );

  // Wire-drag must never start a text selection in the cards it crosses
  const onConnectStart = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    document.body.classList.add('tdag-connecting');
  }, []);
  // Dropping a wire on empty canvas = "continue from here": a fresh ask
  // node at the drop point, wired as a solid child (same as a follow-up).
  // Wiring to an EXISTING node stays a dashed reference — the distinction
  // is newborn vs. existing conversation, not which handle you aimed at.
  const onConnectEnd = useCallback<NonNullable<React.ComponentProps<typeof ReactFlow>['onConnectEnd']>>((event, connectionState) => {
    document.body.classList.remove('tdag-connecting');
    if (isParadigm) return;
    if (connectionState.isValid) return; // landed on a handle — onConnect owns it
    if (connectionState.fromHandle?.type !== 'source' || !connectionState.fromNode) return;
    const parentId = connectionState.fromNode.id;
    // Dropped on a card (not a handle): connect as a reference — aiming at
    // the card is enough. Materials and frames accept nothing (One Rule).
    const overNode = (event.target as HTMLElement)?.closest?.('.react-flow__node');
    if (overNode) {
      const targetId = overNode.getAttribute('data-id');
      if (targetId && targetId !== parentId) {
        const tgt = useStore.getState().nodes.find((n) => n.id === targetId);
        const kind = tgt?.data.stepKind ?? '';
        if (tgt && !['note', 'file', 'link', 'frame'].includes(kind)) {
          useStore.getState().addCrossLink(parentId, targetId);
        }
      }
      return;
    }
    const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
    const end = rfInstance.current?.screenToFlowPosition({ x: clientX, y: clientY }, { snapToGrid: false });
    if (!end) return;
    const st = useStore.getState();
    if (st.nodes.find((n) => n.id === parentId)?.data.stepKind === 'frame') return;
    const id = createQuestionDraft({ connectionEnd: end, parentId });
    const node = useStore.getState().nodes.find(item => item.id === id);
    if (node) {
      pendingConnectionDrops.current.set(node.id, { parentId, end, node });
      // The pointer already chose a visible location; keep this viewport and zoom.
      prevNodeCount.current = useStore.getState().nodes.length;
    }
  }, [isParadigm]);

  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  // Reading and formatting have independent targets. Single clicks only select.
  const panelMode = useUiStore((s) => s.panelOpen);
  const panelFits = useFocusPanelSpace();
  const panelNodeId = useUiStore((s) => s.panelNodeId);
  const viewerLoadError = useUiStore((s) => s.viewerLoadError);
  const staleCount = useStore((s) => shownStaleIds(s).length);
  const livePanelWidth = useUiStore((s) => s.panelWidth);
  // The panel exists only while its node does: a node deleted, undone or
  // switched away from under the selection must take the panel — and the
  // toolbar's shift for it — with it, not only the X button.
  const selectedNode = nodes.find((nd) => nd.id === selectedNodeId);
  const readingNode = nodes.find((node) => node.id === panelNodeId);
  const panelOpen = panelMode && panelFits && !!readingNode && !isParadigm && !isContentKind(readingNode.data.stepKind) && readingNode.data.stepKind !== 'frame';
  useEffect(() => {
    // Closing leaves session drafts intact and never reopens on a wider window.
    if (panelMode && !panelFits) useUiStore.getState().setPanelOpen(false);
  }, [panelMode, panelFits]);
  const selectionKey = selectedNodeIds.length || selectedEdges.length
    ? JSON.stringify([activeProjectId, [...selectedNodeIds].sort(), selectedEdges.map(edge => edge.id).sort()]) : '';
  const showProperties = useCanvasSelectionCard('selection-properties', isViewerMode ? '' : selectionKey,
    !layoutOpen, propertiesRequest);
  const showLayoutPanel = useCanvasToolCard('layout', layoutOpen && !isViewerMode,
    () => useCanvasEditing.getState().setLayoutOpen(false));
  const showChatPanel = useCanvasToolCard('chat', chatOpen, () => setChatOpen(false));
  const [formatPanelReady, setFormatPanelReady] = useState(false);
  useEffect(() => {
    // Let a double-click reach the card before a newly opened inspector can
    // cover it on a narrow canvas. Changing an existing selection stays live.
    const timer = window.setTimeout(() => setFormatPanelReady(showProperties), showProperties ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [showProperties]);
  const occupiedPanelWidth = panelOpen ? livePanelWidth : 0;
  const toolbarPanelPosition = useCanvasPanelPosition(true, 'right');
  const canvasHeaderRef = useResponsiveCanvasHeader();
  useEffect(() => {
    // a selection that names no node is stale; drop it so nothing else keys off it
    if (selectedNodeId && !selectedNode) useStore.getState().setSelectedNodeId(null);
  }, [selectedNodeId, selectedNode]);
  useEffect(() => {
    if (panelNodeId && !readingNode) useUiStore.getState().setPanelOpen(false);
  }, [panelNodeId, readingNode]);
  const batchDelete = useStore((s) => s.batchDelete);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      // While the confirm dialog is open it owns the keyboard
      if (useUiStore.getState().confirmRequest) return;
      // Viewer: only Cmd+F search survives; every mutating shortcut is inert
      if (isViewerMode && !((e.metaKey || e.ctrlKey) && e.key === 'f')) return;
      // Undo belongs to a text field while it has focus: the field takes back
      // its own typing, and the canvas steps once the edit is committed.
      // Redo answers to Shift+Cmd/Ctrl+Z (the key reads 'Z' with Shift held
      // on some systems) and to Ctrl+Y.
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 'a' && !inField) {
        e.preventDefault();
        const st = useStore.getState();
        const editing = useCanvasEditing.getState();
        const selectedKinds = new Set<SelectionTarget>();
        if (editing.selectionRegion) selectedKinds.add(editing.selectionTarget);
        else {
          for (const node of st.nodes) if (st.selectedNodeIds.includes(node.id)) selectedKinds.add(isFrameNode(node) ? 'frames' : 'nodes');
          if (st.edges.some(edge => edge.selected)) selectedKinds.add('edges');
        }
        if (!selectedKinds.size) selectedKinds.add('nodes');
        editing.setSelectionRegion(null);
        const shownEdges = new Set((rfInstance.current?.getEdges() ?? st.edges).filter(edge => !edge.hidden && edge.selectable !== false).map(edge => edge.id));
        st.setEdges(st.edges.map(edge => ({ ...edge, selected: selectedKinds.has('edges') && shownEdges.has(edge.id) })));
        const shown = rfInstance.current?.getNodes() ?? st.nodes;
        st.setSelectedNodeIds(shown.filter(node => !node.hidden && node.selectable !== false
          && selectedKinds.has(isFrameNode(node) ? 'frames' : 'nodes')).map(node => node.id));
        editing.requestProperties();
        return;
      }
      // Only canvas focus cycles objects. Tab within controls keeps its usual
      // form navigation, including the format inspector's edit boundary.
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey
        && (target === document.body || target.matches('.react-flow, .react-flow__pane, .react-flow__node, .react-flow__nodesselection-rect'))) {
        const st = useStore.getState();
        const selectable = (rfInstance.current?.getNodes() ?? st.nodes).filter(node => !node.hidden && node.selectable !== false);
        if (selectable.length) {
          e.preventDefault();
          const selected = new Set(st.selectedNodeIds);
          let index = selectable.findIndex(node => selected.has(node.id));
          if (!e.shiftKey) selectable.forEach((node, i) => { if (selected.has(node.id)) index = i; });
          const next = index < 0 ? (e.shiftKey ? selectable.length - 1 : 0)
            : (index + (e.shiftKey ? -1 : 1) + selectable.length) % selectable.length;
          useCanvasEditing.getState().setSelectionRegion(null);
          useCanvasEditing.getState().requestProperties();
          st.setEdges(st.edges.map(edge => edge.selected ? { ...edge, selected: false } : edge));
          st.setSelectedNodeId(selectable[next].id);
          (document.activeElement as HTMLElement | null)?.blur();
        }
        return;
      }
      const historyCommand = canvasHistoryCommand(e);
      if (historyCommand) {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        if (historyCommand === 'redo') redo(); else undo();
        return;
      }
      // Cmd+F: node search (replaces browser find on the canvas)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      {
        const target = e.target as HTMLElement;
        const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (!inField && selectedNodeId && !isParadigm && !e.metaKey && !e.ctrlKey && !e.altKey
          && useStore.getState().nodes.some(node => node.id === selectedNodeId && !isFrameNode(node))) {
          const { nodes: ns, edges: es } = useStore.getState();
          // Space: collapse/expand the selected node
          if (e.key === ' ') {
            e.preventDefault();
            useStore.getState().toggleCollapse(selectedNodeId);
            return;
          }
          // R: regenerate in place (same semantic as the UI button)
          if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            void useStore.getState().rerunNode(selectedNodeId, {});
            return;
          }
          // Arrow keys: walk the DAG (structural edges only)
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            const structural = es.filter((ed) => !ed.data?.isCrossLink);
            let nextId: string | undefined;
            if (e.key === 'ArrowUp') {
              nextId = structural.find((ed) => ed.target === selectedNodeId)?.source;
            } else if (e.key === 'ArrowDown') {
              nextId = structural.find((ed) => ed.source === selectedNodeId)?.target;
            } else {
              const parentEdge = structural.find((ed) => ed.target === selectedNodeId);
              const siblings = parentEdge
                ? structural.filter((ed) => ed.source === parentEdge.source).map((ed) => ed.target)
                : ns.filter((n) => !isFrameNode(n) && !structural.some((ed) => ed.target === n.id)).map((n) => n.id);
              const idx = siblings.indexOf(selectedNodeId);
              if (idx !== -1 && siblings.length > 1) {
                nextId = siblings[(idx + (e.key === 'ArrowRight' ? 1 : siblings.length - 1)) % siblings.length];
              }
            }
            if (nextId) {
              e.preventDefault();
              useCanvasEditing.getState().setSelectionRegion(null);
              setSelectedNodeId(nextId);
              const target2 = ns.find((n) => n.id === nextId);
              if (target2) centerNode(target2, { zoom: 1, duration: 300 });
            }
            return;
          }
        }
      }
      // Card and nested-editor layers consume Escape first; the canvas then clears selection.
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        if (selectedNodeIds.length > 1) {
          setSelectedNodeIds([]);
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
        }
        useStore.getState().setEdges(useStore.getState().edges.map(edge => edge.selected ? { ...edge, selected: false } : edge));
        return;
      }
      // Frames delete only their explicitly selected bounds, never contents.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        const selection = new Set(selectedNodeIds);
        const selected = useStore.getState().nodes.filter(node => selection.has(node.id));
        const frameCount = selected.filter(node => node.data.stepKind === 'frame').length;
        const selectedEdgeIds = edges.filter(edge => edge.selected).map(edge => edge.id);
        if (selectedNodeIds.length && selectedEdgeIds.length) {
          e.preventDefault();
          void confirmDialog({ title: ti('selection.deleteObjects'),
            message: fmt(ti('selection.deleteObjectsConfirm'), { nodes: selected.length - frameCount, frames: frameCount, edges: selectedEdgeIds.length }),
            confirmLabel: ti('common.delete'), danger: true,
          }).then(ok => { if (ok) batchDelete(selectedNodeIds, selectedEdgeIds); });
        } else if (selectedNodeIds.length > 0) {
          e.preventDefault();
          const nodeCount = selected.length - frameCount;
          void confirmDialog({
            title: ti(frameCount > 0 && nodeCount === 0 ? 'frame.deleteOnly' : 'confirm.deleteNodesTitle'),
            message: frameCount === 0 ? fmt(ti('confirm.deleteNodes'), { n: selectedNodeIds.length })
              : nodeCount === 0 ? fmt(ti('frame.deleteOnlyConfirm'), { n: frameCount })
                : fmt(ti('frame.deleteMixedConfirm'), { frames: frameCount, nodes: nodeCount }),
            confirmLabel: ti('common.delete'),
            danger: true,
          }).then((ok) => { if (ok) batchDelete(selectedNodeIds); });
        } else {
          if (selectedEdgeIds.length > 0) {
            e.preventDefault();
            void confirmDialog({ title: ti('selection.deleteEdges'), message: fmt(ti('selection.deleteEdgesConfirm'), { n: selectedEdgeIds.length }), confirmLabel: ti('common.delete'), danger: true })
              .then(ok => { if (ok) deleteEdges(selectedEdgeIds); });
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectedNodeId, selectedNodeIds, setSelectedNodeId, setSelectedNodeIds, batchDelete, edges, deleteEdges, isParadigm, centerNode]);

  const handleSubmit = () => {
    if (!inputValue.trim()) return;
    addQuestion(inputValue.trim(), {
      rolePrompt: rootRole.trim() || undefined,
      initialAttachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    });
    setInputValue('');
    setRootRole('');
    setShowRootRole(false);
    setPendingAttachments([]);
  };

  const handleFileUpload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await processFile(file, {
        add: (att) => setPendingAttachments((prev) => [...prev, att]),
        update: (attId, patch) => setPendingAttachments((prev) => prev.map((a) =>
          a.id === attId ? { ...a, ...patch } : a
        )),
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); handleSubmit(); }
  };

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: { id: string }[] }) => {
    if (marquee.current) return;
    const ids = selectedNodes.map((n) => n.id);
    if (ids.length > 1) {
      setSelectedNodeIds(ids);
    } else if (ids.length === 1) {
      setSelectedNodeId(ids[0]);
    } else if (useStore.getState().nodes.every((node) => !node.selected)) {
      // Shift-click can clear the selection without a pane click. Ignore
      // stale empty callbacks while a programmatic selection is pending.
      setSelectedNodeIds([]);
    }
  }, [setSelectedNodeId, setSelectedNodeIds]);

  // Highlight ancestor edges for selected node(s)
  // Frame navigator: named regions become a jumpable table of contents
  const frames = useMemo(() => nodes.filter((n) => n.data.stepKind === 'frame'), [nodes]);
  const [frameNavRequested, setFrameNavOpen] = useState(false);
  const frameNavOpen = useCanvasToolCard('frames', frameNavRequested, () => setFrameNavOpen(false));
  const frameNavRef = useRef<HTMLDivElement>(null);
  const frameNavPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (frameNavOpen) frameNavPanelRef.current?.focus({ preventScroll: true }); }, [frameNavOpen]);
  useDismissableLayer({ open: frameNavOpen, refs: [frameNavRef], onDismiss: reason => {
    setFrameNavOpen(false);
    if (reason === 'escape') restoreCanvasToolbarFocus(frameNavRef.current?.querySelector('[data-frame-nav-trigger]') ?? null);
  }, dismissOnFocusOutside: true, restoreFocus: false });

  // Toolbar overflow menu: low-frequency actions live behind one ⋯ button
  // so the action toolbar stays short in both languages and with the panel
  // dragged wide.
  const [moreRequested, setMoreOpen] = useState(false);
  const [overflowMenu, setOverflowMenu] = useState<HTMLDivElement | null>(null);
  const overflowContext = useMemo(() => ({ target: overflowMenu, close: () => setMoreOpen(false) }), [overflowMenu]);
  const moreOpen = useCanvasToolCard('more', moreRequested, () => setMoreOpen(false));
  const pluginUpdate = useUiStore((s) => s.pluginUpdate);
  const harnessDesktop = useUiStore((s) => !!s.harnessHost?.desktop);
  const [diagPing, setDiagPing] = useState(0);
  const [detailPing, setDetailPing] = useState(0);
  const searching = useUiStore((s2) => s2.searchHitIds !== null);
  const moreRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open: moreOpen, refs: [moreRef], onDismiss: () => setMoreOpen(false), dismissOnFocusOutside: true });

  // Annotation view mode: hide frames + UNLINKED content nodes (linked
  // material stays — it's part of the reasoning record). A filter over the
  // render, not a layer system: the semantic layering already lives in edges.
  const searchHitIds = useUiStore((s2) => s2.searchHitIds);
  const inspectedTarget = useContextInspection(state => state.targetId);
  const inspectedEdgeId = useContextInspection(state => state.activeEdgeId);
  const inspectedSource = edges.find(edge => edge.id === inspectedEdgeId && edge.target === inspectedTarget)?.source;
  // Context Focus: single-selection lights up what the node actually
  // receives (mainline + materials + reference sources, via the same
  // partitionContext the prompt builder uses) and dims the rest. Read-only.
  const focusSets = useMemo(() => {
    if (inspectedTarget || !selectedNodeId || selectedNodeIds.length > 1 || layoutOpen || edges.some((edge) => edge.selected)) return null;
    // Frames organize space; selecting one does not focus a conversation.
    if (!nodes.some((n) => n.id === selectedNodeId && n.data.stepKind !== 'frame')) return null;
    const part = partitionContext(selectedNodeId, nodes, edges);
    const ctx = new Set<string>();
    for (const n of part.mainline) if (n.id !== selectedNodeId) ctx.add(n.id);
    for (const n of part.materials) ctx.add(n.id);
    for (const r of part.references) ctx.add(r.source.id);
    const structural = edges.filter((e) => !e.data?.isCrossLink);
    const pathEdgeIds = walkUpAncestors(selectedNodeId, nodes, structural).visitedEdgeIds;
    const refEdgeIds = new Set(part.references.map((r) => r.edge.id));
    const downOut = structural.filter((e) => e.source === selectedNodeId);
    return {
      ctx,
      down: new Set(downOut.map((e) => e.target)),
      pathEdgeIds, refEdgeIds,
      downEdgeIds: new Set(downOut.map((e) => e.id)),
    };
  }, [selectedNodeId, selectedNodeIds, nodes, edges, layoutOpen, inspectedTarget]);

  // Preview overlays only geometry and visual defaults: streamed content stays live.
  const renderNodes = useMemo(() => {
    if (!layoutPreview) return nodes;
    const planned = new Map(layoutPreview.map((node) => [node.id, node]));
    return nodes.map((node) => {
      const draft = planned.get(node.id);
      return draft ? { ...node, position: draft.position, width: draft.width, height: draft.height,
        measured: draft.measured, style: { ...node.style, width: draft.style?.width, height: draft.style?.height }, data: { ...node.data,
        layoutDirection: draft.data.layoutDirection, edgeRouteDefault: draft.data.edgeRouteDefault } } : node;
    });
  }, [nodes, layoutPreview]);

  const canvasNodesDraggable = !isViewerMode && !layoutPreview && !condenseBuilding;
  const displayNodes = useMemo((): typeof nodes => {
    const layers = nodeLayerIndices(renderNodes);
    let out = renderNodes.map(node => ({ ...node, zIndex: layers.get(node.id),
      ...(node.data.stepKind === 'frame' ? { style: { ...node.style, pointerEvents: 'none' as const } } : {}) }));
    if (annotationsHidden) {
      out = out.map((n) => {
        const k = n.data.stepKind;
        const unlinkedContent = isContentKind(k) && !edges.some((e) => e.source === n.id || e.target === n.id);
        return (k === 'frame' || unlinkedContent) ? { ...n, hidden: true } : n;
      });
    }
    // The searchlight: hits stay lit, everything else dims (CSS does the
    // dimming via [data-searching]; frames stay out — they are the ground).
    if (searchHitIds !== null) {
      out = out.map((n) => (
        searchHitIds.has(n.id) || n.data.stepKind === 'frame'
          ? { ...n, className: 'search-hit' }
          : n.className === 'search-hit' ? { ...n, className: undefined } : n
      ));
    }
    if (focusSets) {
      out = out.map((n) => {
        const role = n.id === selectedNodeId ? 'target'
          : focusSets.ctx.has(n.id) ? 'ctx'
          : focusSets.down.has(n.id) ? 'down'
          : n.data.stepKind === 'frame' ? undefined : 'dim';
        if (!role) return n;
        return {
          ...n,
          className: [n.className, `focus-${role}`].filter(Boolean).join(' '),
          ...(role !== 'dim' ? { data: { ...n.data, focusRole: role as 'target' | 'ctx' | 'down' } } : {}),
        };
      });
    }
    if (editingEdge) out = out.map((node) => node.id === editingEdge.source || node.id === editingEdge.target
      ? { ...node, className: [node.className, 'edge-endpoint'].filter(Boolean).join(' ') } : node);
    if (inspectedTarget) out = out.map(node => node.id === inspectedTarget || node.id === inspectedSource
      ? { ...node, className: [node.className, node.id === inspectedTarget ? 'context-target-active' : 'context-source-active'].filter(Boolean).join(' ') }
      : node);
    // Per-node flags override React Flow's global setting. The rendered graph
    // must honor temporary locks even for an imported explicit draggable=true.
    return canvasNodesDraggable ? out : out.map(node => ({ ...node, draggable: false }));
  }, [renderNodes, edges, annotationsHidden, searchHitIds, focusSets, selectedNodeId, editingEdge, canvasNodesDraggable, inspectedTarget, inspectedSource]);

  const highlightedEdges = useMemo((): ThoughtEdge[] => {
    // Visual law: SOLID = structural (conversation, layout, cascade),
    // DASHED = bypass (references, watch). Explore branches are structural,
    // so legacy dashed-orange branch edges are normalized to solid here
    // (styles persist per edge; this fixes old canvases centrally).
    // Theme mapping happens here too: storage keeps the canonical light hex
    // as the edge's semantic identity, the render layer resolves it against
    // the active theme — old backups need no migration.
    const base = edges.map((raw) => {
      const e = raw.data?.isBranchFromSelection
        ? { ...raw, animated: false, style: { ...raw.style, strokeDasharray: undefined } }
        : raw;
      const strokeSlot = typeof e.style?.stroke === 'string' ? LEGACY_EDGE_HEX[e.style.stroke.toUpperCase()] : undefined;
      const marker = e.markerEnd && typeof e.markerEnd === 'object' ? { ...e.markerEnd, ...EDGE_ARROW_GEOMETRY } : undefined;
      const markerSlot = typeof marker?.color === 'string' ? LEGACY_EDGE_HEX[marker.color.toUpperCase()] : undefined;
      if (!strokeSlot && !marker) return e;
      return {
        ...e,
        ...(strokeSlot ? { style: { ...e.style, stroke: themePalette[strokeSlot] } } : {}),
        ...(marker ? { markerEnd: { ...marker, ...(markerSlot ? { color: themePalette[markerSlot] } : {}) } } : {}),
      };
    });
    if (focusSets) {
      return base.map((e) => {
        if (focusSets.pathEdgeIds.has(e.id)) {
          return {
            ...e,
            className: 'focus-e-path',
            style: { ...e.style, stroke: themePalette.accent, strokeWidth: 2.5, opacity: 1 },
            markerEnd: { type: 'arrowclosed' as const, ...((e.markerEnd && typeof e.markerEnd === 'object') ? e.markerEnd : {}), ...EDGE_ARROW_GEOMETRY, color: themePalette.accent },
            zIndex: 10,
            data: { ...e.data, focusRole: 'path' as const },
          };
        }
        if (focusSets.refEdgeIds.has(e.id)) {
          // reference INTO the context: it feeds the model (as a fenced
          // block), so it stays visible — dashed identity untouched
          return { ...e, style: { ...e.style, opacity: 0.9 }, zIndex: 5, data: { ...e.data, focusRole: 'ref' as const } };
        }
        if (focusSets.downEdgeIds.has(e.id)) {
          return {
            ...e,
            className: 'focus-e-down',
            style: { ...e.style, strokeWidth: 2.5, opacity: 0.85 },
            markerEnd: { type: 'arrowclosed' as const, ...((e.markerEnd && typeof e.markerEnd === 'object') ? e.markerEnd : {}), ...EDGE_ARROW_GEOMETRY },
            zIndex: 5,
            data: { ...e.data, focusRole: 'down' as const },
          };
        }
        return { ...e, style: { ...e.style, strokeWidth: 1.5, opacity: 0.2 }, zIndex: 0 };
      });
    }
    if (inspectedTarget) return base;
    const activeIds = selectedNodeIds.length > 1
      ? selectedNodeIds.filter((id) => nodes.some((node) => node.id === id && node.data.stepKind !== 'frame')) : [];
    if (activeIds.length === 0) return base;

    // Walk up from each selected node, collect all ancestor edge ids
    const { visitedEdgeIds: ancestorEdgeIds } = walkUpAncestors(activeIds, nodes, edges);

    return base.map((e) => {
      if (ancestorEdgeIds.has(e.id)) {
        return {
          ...e,
          style: { ...e.style, stroke: themePalette.trace, strokeWidth: 2.5, opacity: 1 },
          markerEnd: { type: 'arrowclosed' as const, ...((e.markerEnd && typeof e.markerEnd === 'object') ? e.markerEnd : {}), ...EDGE_ARROW_GEOMETRY, color: themePalette.trace },
          zIndex: 10,
        };
      }
      // Dim non-ancestor edges
      return {
        ...e,
        style: { ...e.style, strokeWidth: 1.5, opacity: 0.2 },
        zIndex: 0,
      };
    });
  }, [nodes, edges, selectedNodeIds, themePalette, focusSets, inspectedTarget]);

  const displayEdges = useMemo(() => {
    anchorResolver.current.prune(highlightedEdges);
    const lookup = new Map(displayNodes.map((node) => [node.id, node]));
    return highlightedEdges.map((edge) => {
      const anchors = anchorResolver.current.resolve(edge, lookup);
      return anchors ? { ...edge, sourceHandle: anchors.sourceHandle, targetHandle: anchors.targetHandle } : edge;
    });
  }, [highlightedEdges, displayNodes]);
  const edgeRoutingSettings = useEdgeRoutingPreferences(state => state.settings);
  const routingContext = useMemo(() => createEdgeRoutingContext(displayNodes, displayEdges, edgeRoutingSettings), [displayNodes, displayEdges, edgeRoutingSettings]);

  // The panel is an overlay — the canvas never resizes. When it opens (or
  // the selection moves while it is open) and the selected node would be
  // hidden underneath it, the node re-centers in the space LEFT of the
  // panel — the visible half becomes the stage, not a peek-out sliver.
  useEffect(() => {
    if (!panelOpen || !selectedNodeId) return;
    const timer = setTimeout(() => {
      const rf = rfInstance.current;
      if (!rf) return;
      const node = useStore.getState().nodes.find((n) => n.id === selectedNodeId);
      if (!node) return;
      const vp = rf.getViewport();
      const w = node.measured?.width ?? node.width ?? 480;
      const nodeRight = (node.position.x + w) * vp.zoom + vp.x;
      const visibleRight = window.innerWidth - useUiStore.getState().panelWidth - PANEL_INSET - 24;
      if (nodeRight > visibleRight) {
        const nodeCenter = (node.position.x + w / 2) * vp.zoom + vp.x;
        rf.setViewport({ ...vp, x: vp.x - (nodeCenter - visibleRight / 2) }, { duration: 300 });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [panelOpen, selectedNodeId]);

  // The docked reader: a column on the left the canvas steps aside for
  // (lib/reader-dock decides its width, or 0). While it is up, the reader
  // follows the selection: a selected material shows in it, and a question
  // anchored to a page scrolls it to that page, so the text beside the
  // canvas is always the one the selected node came from.
  const readerDock = useReaderDock();
  useEffect(() => {
    if (!readerDock.docked || !selectedNodeId) return;
    const st = useStore.getState();
    const n = st.nodes.find((x) => x.id === selectedNodeId);
    if (!n) return;
    const ui = useUiStore.getState();
    const kind = n.data.stepKind;
    if (kind === 'file' || kind === 'link') {
      if (ui.readerNodeId !== n.id) ui.setReaderNodeId(n.id);
      return;
    }
    const anchor = n.data.anchor;
    if (!anchor?.page) return;
    const grownFrom = st.edges.find((e) =>
      e.target === n.id && !e.data?.isCrossLink
      && st.nodes.some((m) => m.id === e.source && (m.data.stepKind === 'file' || m.data.stepKind === 'link' || m.data.stepKind === 'note')))?.source;
    const clippedFrom = anchor.attId ? st.nodes.find((m) => m.data.attachments?.some((a) => a.id === anchor.attId))?.id : undefined;
    const material = grownFrom ?? clippedFrom;
    if (material) ui.setReaderNodeId(material, { page: anchor.page });
  }, [readerDock.docked, selectedNodeId]);

  return (
    <div className="relative w-full h-full" data-searching={searching || undefined}>
      {/* Canvas — steps aside by the docked reader's width; the focus panel floats on top of it */}
      <div
        className="absolute inset-y-0 right-0"
        style={{ left: readerDock.width }}
        onDoubleClick={(e) => {
          // Double-click on empty canvas → drop an ask node right there
          // Node headers handle their own reading gesture.
          if ((e.target as HTMLElement).classList.contains('react-flow__pane') && !isParadigm) {
            spawnAskNode(flowPosAt({ x: e.clientX, y: e.clientY }));
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/thoughtdag-content') || e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!hasNodes && !isParadigm) setIsDraggingLanding(true);
          }
        }}
        onDrop={(e) => {
          if (isViewerMode) return;
          const el = e.target as HTMLElement;
          // Landing (empty canvas): dropping a document means "start from
          // this material" — file nodes + the reader, not attachments
          if (!hasNodes && !isParadigm && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            setIsDraggingLanding(false);
            startFromDocuments(e.dataTransfer.files);
            return;
          }
          // Drops land on the empty pane OR inside a frame region (frames
          // cover large areas; a file dropped there should still land)
          const overNode = el.closest?.('.react-flow__node');
          const overFrame = overNode && useStore.getState().nodes.find((n) => n.id === overNode.getAttribute('data-id'))?.data.stepKind === 'frame';
          if (!el.classList?.contains('react-flow__pane') && !overFrame) return;
          const pos = flowPosAt({ x: e.clientX, y: e.clientY });
          const paletteKind = e.dataTransfer.getData('application/thoughtdag-content');
          if (paletteKind === 'ask') {
            e.preventDefault();
            spawnAskNode(pos);
            return;
          }
          if (paletteKind === 'frame') {
            e.preventDefault();
            spawnFrame(pos);
            return;
          }
          if (paletteKind === 'note' || paletteKind === 'file') {
            e.preventDefault();
            spawnContentNode(paletteKind, pos);
            return;
          }
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            const files = filterDroppedFiles(e.dataTransfer.files);
            if (files.length === 0) return;
            const id = spawnContentNode('file', pos);
            void ingestFiles(id, files);
          }
        }}
      >
      <CanvasEdgeRouting.Provider value={routingContext}>
      <ReactFlow
        onKeyDownCapture={event => {
          // Resolve our active editor before the library deselects a focused node.
          if (event.key !== 'Escape' || isImeComposing(event)) return;
          handleDismissableLayerKeyDown(event.nativeEvent);
          if (event.nativeEvent.defaultPrevented) { event.preventDefault(); event.stopPropagation(); }
        }}
        onClickCapture={event => {
          // Let React Flow consume the release click and reset its gesture flag.
          if (marqueeClickPending.current) { marqueeClickPending.current = false; return; }
          if (isRetainedSelectionPane(event)) event.stopPropagation();
        }}
        onPointerDownCapture={(event) => {
          marqueeClickPending.current = false;
          const target = event.target as HTMLElement;
          if (isViewerMode || event.button !== 0 || !target.classList.contains('react-flow__pane') || !target.classList.contains('selection')) return;
          const state = useStore.getState();
          const previous = useCanvasEditing.getState().selectionRegion;
          const additive = event.ctrlKey || event.metaKey || event.shiftKey;
          const marqueeTarget = additive && previous ? selectionTarget : 'nodes';
          if (!additive && isRetainedSelectionPane(event)) {
            event.stopPropagation();
            return;
          }
          const spatial = partitionSpatialSelection(state.nodes, state.selectedNodeIds);
          marquee.current = {
            start: { x: event.clientX, y: event.clientY },
            baseNodes: additive ? previous?.nodeIds ?? spatial.nodeIds : [],
            baseFrames: additive ? previous?.frameIds ?? spatial.frameIds : [],
            baseEdges: additive ? previous?.edgeIds ?? state.edges.filter(edge => edge.selected).map(edge => edge.id) : [],
            ids: [],
            active: false,
            target: marqueeTarget,
            paths: snapshotEdgeSelectionPaths(event.currentTarget).filter(path => state.edges.some(edge => edge.id === path.id && !edge.hidden && edge.selectable !== false)),
            region: null,
          };
          useCanvasEditing.getState().setSelectionRegion(null);
          useCanvasEditing.getState().setSelectionTarget(marqueeTarget);
        }}
        onPointerMoveCapture={(event) => {
          const gesture = marquee.current;
          const flow = rfInstance.current;
          if (!gesture || !flow || !(event.buttons & 1)) return;
          if (!gesture.active && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) <= 1) return;
          gesture.active = true;
          const start = flow.screenToFlowPosition(gesture.start, { snapToGrid: false });
          const end = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
          const edgeIds = intersectingEdgeSelection(gesture.paths, {
            x: Math.min(gesture.start.x, event.clientX), y: Math.min(gesture.start.y, event.clientY),
            width: Math.abs(event.clientX - gesture.start.x), height: Math.abs(event.clientY - gesture.start.y),
          }, gesture.baseEdges);
          const rect = {
            x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
          };
          const spatialNodes = flow.getNodes();
          const { nodeIds, frameIds } = partitionSpatialSelection(spatialNodes,
            enclosedSelection(spatialNodes, rect, [...gesture.baseNodes, ...gesture.baseFrames]));
          gesture.region = { rect, nodeIds, edgeIds, frameIds };
          gesture.ids = gesture.target === 'edges' ? edgeIds : gesture.target === 'frames' ? frameIds : nodeIds;
          syncMarqueeSelection(gesture.ids);
        }}
        onPointerCancel={() => { marquee.current = null; }}
        onPointerUpCapture={() => {
          const gesture = marquee.current;
          marqueeClickPending.current = !!gesture?.active;
          queueMicrotask(() => {
            if (gesture?.active) {
              syncMarqueeSelection(gesture.ids);
              useCanvasEditing.getState().setSelectionRegion(gesture.region);
            }
            marquee.current = null;
          });
        }}
        onInit={(instance) => {
          rfInstance.current = instance;
          recapCamera.current = instance;
          // Debug: expose the flow instance for screenshot/e2e scripts (DEV only)
          if (import.meta.env.DEV) (window as unknown as { __rf?: typeof instance }).__rf = instance;
          // A freshly imported session arrives at its working tail, not a
          // bird's-eye column (one-shot, set by the importer)
          const focusId = useUiStore.getState().arrivalFocusNodeId;
          if (focusId) {
            useUiStore.getState().setArrivalFocusNodeId(null);
            const n = useStore.getState().nodes.find((x) => x.id === focusId);
            if (n) {
              window.setTimeout(() => {
                instance.setCenter(n.position.x + 260, n.position.y + 140, { zoom: 0.9, duration: 400 });
              }, 150);
            }
          }
        }}
        nodes={displayNodes}
        edges={displayEdges}
        elevateNodesOnSelect={false}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDrag={onSelectionDrag}
        onSelectionDragStop={onSelectionDragStop}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onEdgeContextMenu={onEdgeContextMenu}
        onEdgeClick={(event, edge) => {
          if (isViewerMode) return;
          useCanvasEditing.getState().requestProperties();
          useCanvasEditing.getState().setSelectionRegion(null);
          if (!(event.ctrlKey || event.metaKey || event.shiftKey)) openEdgeEditor(edge.id);
        }}
        onEdgeDoubleClick={(_event, edge) => openEdgeEditor(edge.id)}
        onNodeClick={event => {
          useCanvasEditing.getState().requestProperties();
          useCanvasEditing.getState().setSelectionRegion(null);
          if (!(event.ctrlKey || event.metaKey || event.shiftKey)) {
            useStore.setState(state => ({ edges: state.edges.map(edge => edge.selected ? { ...edge, selected: false } : edge) }));
          }
        }}
        onNodeDoubleClick={(event, node) => {
          const target = event.target as Element;
          if (isParadigm || !target.closest('[data-node-details-header]')
            || target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], .nodrag')) return;
          const ui = useUiStore.getState();
          ui.setPanelOpen(!(ui.panelOpen && ui.panelNodeId === node.id), node.id);
        }}
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={null}
        fitView
        // Cull off-viewport nodes: a content-heavy canvas keeps dozens of
        // full markdown/KaTeX card DOMs mounted otherwise, and zoom/pan
        // transforms all of them every frame.
        onlyRenderVisibleElements
        // 0.04, not 0.1: a canvas with a condensed copy beside the original
        // doubles in width — the overview must still fit in one screen for
        // whole-branch selection and cleanup.
        minZoom={0.04}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: themePalette.accent, strokeWidth: 2 },
          markerEnd: { type: 'arrowclosed' as const, color: themePalette.accent, ...EDGE_ARROW_GEOMETRY },
        }}
        snapToGrid={paperTexture === 'grid'}
        snapGrid={[22, 22]}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          'controls.zoomIn.ariaLabel': t('canvas.zoomIn'),
          'controls.zoomOut.ariaLabel': t('canvas.zoomOut'),
          'controls.fitView.ariaLabel': t('canvas.fitView'),
          'controls.interactive.ariaLabel': t('canvas.toggleInteraction'),
        }}
        nodeDragThreshold={5}
        connectionRadius={40}
        selectionMode={SelectionMode.Full}
        selectionKeyCode={null}
        multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
        selectionOnDrag={!isViewerMode}
        nodesDraggable={canvasNodesDraggable}
        nodesConnectable={!isViewerMode && !layoutPreview}
        panOnDrag={isViewerMode ? true : [1, 2]}
        // Ordinary scrolling respects node scroll regions. Modified scrolling is
        // captured by CanvasWheelZoom, including over node editors and the minimap.
        panOnScroll={wheelPans}
        zoomOnScroll={!wheelPans}
        zoomOnPinch
        zoomOnDoubleClick={false}
        connectionLineStyle={{ stroke: themePalette.accent, strokeDasharray: '8 4', strokeWidth: 2 }}
        onSelectionChange={onSelectionChange}
        onPaneClick={() => {
          marquee.current = null;
          useCanvasEditing.getState().setSelectionRegion(null);
          if (!layoutOpen) { setSelectedNodeId(null); setSelectedNodeIds([]); }
          setNodeMenu(null);
        }}
      >
        {paperTexture === 'grid' ? (
          <>
            {/* the drafting board: fine grid + a major line every 5 cells */}
            <Background id="grid-fine" variant={BackgroundVariant.Lines} gap={22} color="var(--canvas-grid-fine)" />
            <Background id="grid-major" variant={BackgroundVariant.Lines} gap={110} color="var(--canvas-grid-major)" />
          </>
        ) : (
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--canvas-dot)" />
        )}
        <ZoomTierTag />
        <CanvasWheelZoom />
        {!isViewerMode && <SelectionRegion hasNodeSurface={canvasNodesDraggable && !layoutOpen && selectedNodeIds.length > 1} />}
        {canvasNodesDraggable && !layoutOpen && <SelectionResizeControls onNodeContextMenu={onNodeContextMenu} />}
        <ThoughtMapPill panelShiftWidth={occupiedPanelWidth} />
        <TimelineBar />
        <CanvasControls>
        {nodes.length > 0 && <MiniMap
          nodeColor={(node) => {
            const data = node.data as Record<string, unknown>;
            // information density over decoration: type is color, archived
            // fades to paper, ordinary turns stay a readable mid-gray
            if (data.archived) return minimapColors.archived;
            const sk = data.stepKind as string | undefined;
            if (sk === 'note') return '#D97706';
            if (sk === 'file' || sk === 'link') return '#64748B';
            if (Array.isArray(data.condensedFrom) && data.condensedFrom.length) return '#8B7CF0';
            return data.isRoot ? themePalette.accent : data.isBranch ? themePalette.warm : minimapColors.ordinary;
          }}
          maskColor={minimapColors.mask}
          maskStrokeColor={minimapColors.viewportBorder}
          maskStrokeWidth={1}
          style={{ width: 200, height: 140 }}
          pannable
          zoomable
          position="bottom-right"
        />}
        </CanvasControls>
      </ReactFlow>
      </CanvasEdgeRouting.Provider>

      {/* Initial input */}
      {!hasNodes && isParadigm && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <p className="text-control text-ink-muted mb-1 font-medium">{t('paradigm.emptyTitle')}</p>
            <p className="text-control text-ink-faint mb-4 max-w-sm">{t('paradigm.emptyHint')}</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => addStep('human')}
                className="text-control border-2 border-dashed border-warm/60 text-warm hover:bg-warm/10 px-4 py-2.5 rounded-control transition-colors flex items-center gap-1.5"
              >
                <MessageCircleQuestion size={15} strokeWidth={1.75} /> {t('paradigm.addHuman')}
              </button>
              <button
                onClick={() => addStep('prompt')}
                className="text-control border-2 border-dashed border-accent/50 text-accent hover:bg-accent/10 px-4 py-2.5 rounded-control transition-colors flex items-center gap-1.5"
              >
                <SquareTerminal size={15} strokeWidth={1.75} /> {t('paradigm.addPrompt')}
              </button>
            </div>
          </div>
        </div>
      )}
      {isViewerMode && !hasNodes && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center max-w-[420px] px-6">
            {viewerLoadError ? (
              <>
                <div className="text-3xl mb-3">🔗</div>
                <div className="text-title font-semibold text-ink mb-1.5">{t('viewer.loadError')}</div>
                <p className="text-control text-ink-muted">{t('viewer.loadErrorHint')}</p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-control text-ink-muted justify-center">
                <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-accent" /> {t('viewer.loading')}
              </div>
            )}
          </div>
        </div>
      )}
      {!hasNodes && !isParadigm && !isViewerMode && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
          {/* Watermark: faint DAG sketches anchoring the corners */}
          <svg className="absolute -left-10 top-[8%] w-[360px] h-[300px] opacity-[0.35] pointer-events-none" viewBox="0 0 360 300" aria-hidden>
            <path d="M80 40 C80 90 80 90 80 130 M80 170 C80 210 80 210 80 250" stroke={COLORS.line} strokeWidth="2" fill="none" />
            <path d="M95 150 C150 150 150 90 205 88" stroke={COLORS.line} strokeWidth="2" strokeDasharray="6 5" fill="none" />
            <circle cx="80" cy="30" r="7" fill={COLORS.line} />
            <circle cx="80" cy="150" r="7" fill="none" stroke={COLORS.line} strokeWidth="2.5" />
            <circle cx="80" cy="262" r="7" fill={COLORS.line} />
            <circle cx="218" cy="88" r="7" fill={COLORS.line} />
          </svg>
          <svg className="absolute right-[-30px] bottom-[10%] w-[320px] h-[280px] opacity-[0.35] pointer-events-none" viewBox="0 0 320 280" aria-hidden>
            <path d="M240 30 C240 80 240 80 240 120 M240 160 C240 200 240 200 240 240" stroke={COLORS.line} strokeWidth="2" fill="none" />
            <path d="M225 140 C170 140 170 210 115 212" stroke={COLORS.line} strokeWidth="2" strokeDasharray="6 5" fill="none" />
            <circle cx="240" cy="20" r="7" fill={COLORS.line} />
            <circle cx="240" cy="140" r="7" fill="none" stroke={COLORS.line} strokeWidth="2.5" />
            <circle cx="240" cy="252" r="7" fill={COLORS.line} />
            <circle cx="102" cy="212" r="7" fill={COLORS.line} />
          </svg>

          <div className="pointer-events-auto w-[560px] animate-fade-in relative">
            <div className="text-center mb-8">
              {/* Mark: a tiny DAG lighting up — main chain in accent, explore branch in warm */}
              <svg width="52" height="52" viewBox="0 0 44 44" className="mx-auto mb-4" aria-hidden>
                <circle className="dag-pop" style={{ animationDelay: '0.05s' }} cx="22" cy="7" r="3.5" fill={COLORS.accent} />
                <line className="dag-pop" style={{ animationDelay: '0.2s' }} x1="22" y1="11" x2="22" y2="19" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" />
                <circle className="dag-pop" style={{ animationDelay: '0.35s' }} cx="22" cy="22" r="3.5" fill="none" stroke={COLORS.accent} strokeWidth="2.5" />
                <line className="dag-pop" style={{ animationDelay: '0.5s' }} x1="22" y1="25" x2="22" y2="33" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" />
                <circle className="dag-pop" style={{ animationDelay: '0.65s' }} cx="22" cy="37" r="3.5" fill={COLORS.accent} opacity="0.35" />
                <line className="dag-pop" style={{ animationDelay: '0.8s' }} x1="25.5" y1="23.5" x2="33" y2="28.5" stroke={COLORS.warm} strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3" />
                <circle className="dag-pop" style={{ animationDelay: '0.95s' }} cx="36" cy="30" r="3.5" fill={COLORS.warm} />
              </svg>
              <h1 className="text-4xl font-semibold tracking-tight text-ink mb-2.5">ThoughtDAG</h1>
              <p className="text-control text-ink-muted">{t('landing.tagline')}</p>
              <p className="text-control text-ink-muted mt-1.5 font-medium">{t('landing.mechanism')}</p>
            </div>
            <div
              className="bg-card border border-line rounded-content px-5 py-4 transition-colors focus-within:border-accent"
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={(e) => {
                  if (e.clipboardData.getData('text/plain').trim()) return; // TEXT WINS, same rule as canvas paste
                  const files = Array.from(e.clipboardData.items).filter(i => i.kind === 'file').map(i => i.getAsFile()!).filter(Boolean);
                  if (files.length) handleFileUpload(files);
                }}
                placeholder={t('landing.placeholder')}
                className="w-full bg-transparent text-ink text-body resize-none focus:outline-none placeholder-ink-faint"
                rows={3}
                autoFocus
              />
              {/* Pending attachments preview */}
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 pb-1">
                  {pendingAttachments.map((att) => (
                    <div key={att.id} className="flex items-center gap-1.5 bg-wash rounded-content px-2.5 py-1.5 group">
                      {att.thumbnailUrl ? (
                        <img src={att.thumbnailUrl} className="w-6 h-6 rounded-content object-cover" alt={att.name} />
                      ) : (
                        <span className="text-control"><FileText size={16} strokeWidth={1.75} /></span>
                      )}
                      <span className="text-control text-ink-muted max-w-[100px] truncate">{att.name}</span>
                      {att.isExtracting && <span className="text-control text-accent"><Loader2 className="animate-spin" size={12} strokeWidth={1.75} /></span>}
                      {att.numPages != null && <span className="text-control text-ink-faint">{att.numPages}p</span>}
                      <button
                        onClick={() => setPendingAttachments((p) => p.filter((a) => a.id !== att.id))}
                        className="text-ink-faint hover:text-red-500 text-control opacity-0 group-hover:opacity-100 transition-opacity"
                      ><X size={14} strokeWidth={1.75} /></button>
                    </div>
                  ))}
                </div>
              )}
              {/* Role area: opened from the tray icon — an ask-time option,
                  not a decision the landing asks you to make up front */}
              {showRootRole && (
                <div className="space-y-1 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-control text-ink-muted font-medium">{t('landing.roleLabel')}</span>
                    <button onClick={() => { setShowRootRole(false); setRootRole(''); }} className="text-control text-ink-faint hover:text-ink-muted"><X size={14} strokeWidth={1.75} /></button>
                  </div>
                  <textarea
                    value={rootRole}
                    onChange={(e) => setRootRole(e.target.value)}
                    placeholder={t('landing.rolePlaceholder')}
                    className="w-full text-body border border-line rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent bg-surface resize-none"
                    rows={2}
                    autoFocus
                  />
                  <RoleTemplateChips onPick={setRootRole} />
                </div>
              )}
              <div className="flex items-center justify-end mt-2 gap-2">
                <SearchToggles />
                <button
                  onClick={() => setShowRootRole(!showRootRole)}
                  data-tooltip={t('landing.roleTrayTitle')} aria-label={t('landing.roleTrayTitle')}
                  className={`rounded-control w-8 h-8 flex items-center justify-center transition-colors shrink-0 ${
                    showRootRole || rootRole ? 'text-accent bg-accent/10 hover:bg-accent/20' : 'text-ink-faint hover:text-ink-muted hover:bg-line'
                  }`}
                >
                  <Drama size={16} strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => landingFileRef.current?.click()}
                  className="text-ink-faint hover:text-accent hover:bg-wash rounded-control px-3 py-2 transition-colors text-control"
                  aria-label={t('landing.attach')}
                >
                  <Paperclip size={16} strokeWidth={1.75} />
                </button>
                <input
                  ref={landingFileRef}
                  type="file"
                  multiple
                  accept={FILE_INPUT_ACCEPT}
                  className="hidden"
                  onChange={(e) => { handleFileUpload(e.target.files || []); e.target.value = ''; }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!inputValue.trim() || pendingAttachments.some(a => a.isExtracting)}
                  className="bg-action hover:bg-action-strong disabled:opacity-30 disabled:cursor-not-allowed text-white text-control px-5 py-2 rounded-control transition-all"
                >
                  {pendingAttachments.some(a => a.isExtracting) ? t('landing.extracting') : t('landing.send')}
                </button>
              </div>
            </div>

            {/* Second entrance: start from a document (material-first). The
                whole landing is the drop target; this card names the gesture. */}
            <div
              onClick={() => docFileRef.current?.click()}
              className={`mt-3 border-2 border-dashed rounded-content px-5 py-3.5 cursor-pointer transition-all text-center bg-card ${
                isDraggingLanding ? 'border-accent bg-accent/5 ring-2 ring-accent/20' : 'border-line hover:border-accent/40 hover:bg-accent/5'
              }`}
            >
              <div className="flex items-center justify-center gap-2 text-control text-ink-muted font-medium">
                <BookOpen size={15} strokeWidth={1.75} className="text-accent" /> {t('landing.docStart')}
              </div>
              <p className="text-control text-ink-faint mt-1.5">{t('landing.docFormats')}</p>
              <p className="text-control text-ink-faint mt-0.5">{t('landing.docPrivacy')}</p>
            </div>
            {/* Agent conversations, desktop only — one click turns them
                into graphs, and LOOKING needs no model key: the one
                zero-config start. Dressed in the SAME uniform as the
                document card (shared ground, centered two-line layout);
                the one distinction left is the border — dashed means
                "drop here", solid means "click me". */}
            {!!window.desktopSessions && (
              <button
                onClick={() => setLandingAtlas(true)}
                className="w-full mt-3 bg-card border border-line rounded-control px-5 py-3.5 hover:border-accent/40 hover:bg-accent/5 transition-all text-center"
                data-landing-atlas
              >
                <div className="flex items-center justify-center gap-2 text-control text-ink-muted font-medium">
                  <Bot size={15} strokeWidth={1.75} className="text-accent shrink-0" />
                  <span>{t('landing.atlasStart')}</span>
                  <ArrowRight size={13} strokeWidth={1.75} className="text-accent shrink-0" />
                </div>
                <p className="text-control text-ink-faint mt-1.5">{t('landing.atlasDesc')}</p>
              </button>
            )}
            <input
              ref={docFileRef}
              type="file"
              multiple
              accept={FILE_INPUT_ACCEPT}
              className="hidden"
              onChange={(e) => { startFromDocuments(e.target.files || []); e.target.value = ''; }}
            />
            {landingAtlas && (
              <SessionAtlas onClose={() => setLandingAtlas(false)} onSwitched={() => { setLandingAtlas(false); afterProjectSwitch(); }} />
            )}

            {/* Quick connect: the no-model landing offers the two free doors
                side by side — GLM's free tier (zh only) and the one-click
                OpenRouter OAuth (free-tier models included, key minted in
                this browser) — plus one quiet line for subscription owners.
                Gone once any model exists. */}
            {(!modelData || (modelData.models?.length ?? 0) === 0) && (
              <div className="mt-3 bg-card border border-line rounded-content px-5 py-3.5 text-center" data-quick-connect>
                <div className="flex items-center justify-center gap-2 text-control text-ink-muted font-medium">
                  <KeyRound size={15} strokeWidth={1.75} className="text-accent shrink-0" /> {t('landing.quickTitle')}
                </div>
                <p className="text-control text-ink-faint mt-1.5">{t('landing.quickDesc')}</p>
                <div className="mt-2.5 flex items-center justify-center flex-wrap gap-2">
                  {lang === 'zh' && (
                    <button
                      onClick={() => { useUiStore.getState().setApiKeyPresetHint('zhipu'); useUiStore.getState().setApiKeyModalOpen(true); }}
                      className="text-control bg-accent/10 text-accent hover:bg-accent/20 font-medium px-3 py-1.5 rounded-control transition-colors shrink-0"
                      data-quick-zhipu
                    >
                      {t('landing.quickZhipu')}
                    </button>
                  )}
                  <button
                    onClick={() => void startOpenRouterOAuth()}
                    className="text-control bg-accent/10 text-accent hover:bg-accent/20 font-medium px-3 py-1.5 rounded-control transition-colors shrink-0"
                    data-quick-primary
                  >
                    {t('landing.quickOpenRouter')}
                  </button>
                  <button
                    onClick={() => useUiStore.getState().setApiKeyModalOpen(true)}
                    className="text-control text-ink-muted hover:text-ink hover:bg-wash font-medium px-3 py-1.5 rounded-control transition-colors shrink-0"
                  >
                    {t('landing.quickOther')}
                  </button>
                </div>
                <button
                  onClick={() => useUiStore.getState().setApiKeyModalOpen(true)}
                  className="mt-2 mx-auto text-control text-ink-faint hover:text-accent transition-colors block"
                  data-quick-subs
                >
                  {t('landing.quickSubs')}
                </button>
              </div>
            )}

            {/* What makes this different — three quiet cards */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              {([
                { icon: GitBranch, title: 'landing.feature1.title', desc: 'landing.feature1.desc' },
                { icon: Workflow, title: 'landing.feature2.title', desc: 'landing.feature2.desc' },
                { icon: Scissors, title: 'landing.feature3.title', desc: 'landing.feature3.desc' },
              ] as const).map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-card border border-line rounded-content px-4 py-3.5">
                  <Icon size={16} strokeWidth={1.75} className="text-accent mb-2" />
                  <h3 className="text-title font-semibold text-ink mb-1">{t(title)}</h3>
                  <p className="text-control text-ink-faint">{t(desc)}</p>
                </div>
              ))}
            </div>

            <div className="text-center mt-6 flex items-center justify-center gap-5">
              <button
                onClick={loadExample}
                className="text-control text-accent hover:text-accent-strong font-medium transition-colors inline-flex items-center gap-1.5"
              >
                <Workflow size={14} strokeWidth={1.75} /> {t('landing.loadExample')}
              </button>
              <button
                onClick={() => setTutorialOpen(true)}
                className="text-control text-ink-muted hover:text-accent transition-colors inline-flex items-center gap-1.5"
              >
                <CircleHelp size={14} strokeWidth={1.75} /> {t('landing.howItWorks')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content palette — canvas material, both modes. Click drops at the
          viewport center; DRAG drops at the pointer. Paste works anywhere:
          text → note, a URL → link snapshot, image/files → file node. */}
      {(hasNodes || isParadigm) && !isViewerMode && (
        <div className="canvas-toolbar canvas-palette" data-content-palette>
          {!isParadigm && (
            <button
              onClick={() => spawnAskNode(flowPosAt(null))}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/thoughtdag-content', 'ask'); e.dataTransfer.effectAllowed = 'copy'; }}
              data-tooltip={t('palette.askTitle')} aria-label={t('palette.askTitle')}
              className="w-9 h-9 rounded-control flex items-center justify-center text-accent hover:bg-accent/10 transition-colors cursor-grab"
            >
              <MessageCircleQuestion size={17} strokeWidth={1.75} />
            </button>
          )}
          <button
            onPointerDown={(e) => paletteDrag(e, (screen) => spawnContentNode('note', flowPosAt(screen)))}
            data-tooltip={t('palette.noteTitle')} aria-label={t('palette.noteTitle')}
            className="w-9 h-9 rounded-control flex items-center justify-center text-amber-600 hover:bg-amber-500/10 transition-colors"
          >
            <StickyNote size={17} strokeWidth={1.75} />
          </button>
          <button
            onPointerDown={(e) => paletteDrag(e, (screen) => spawnContentNode('file', flowPosAt(screen)))}
            data-tooltip={t('palette.fileTitle')} aria-label={t('palette.fileTitle')}
            className="w-9 h-9 rounded-control flex items-center justify-center text-ink-muted hover:bg-wash transition-colors"
          >
            <Paperclip size={17} strokeWidth={1.75} />
          </button>
          <button
            onPointerDown={(e) => paletteDrag(e, (screen) => spawnFrame(flowPosAt(screen)))}
            data-tooltip={t('palette.frameTitle')} aria-label={t('palette.frameTitle')}
            className="w-9 h-9 rounded-control flex items-center justify-center text-ink-muted hover:bg-wash transition-colors"
          >
            <Frame size={17} strokeWidth={1.75} />
          </button>
        </div>
      )}

      <div ref={canvasHeaderRef} className="canvas-header" data-canvas-header
        style={{ right: occupiedPanelWidth ? `calc(min(${occupiedPanelWidth}px, 70vw) + ${PANEL_INSET * 2}px)` : undefined }}>
      <CanvasToolbarOverflowContext.Provider value={overflowContext}>
      {/* Session controls and transient status stay with the project on the left. */}
      {!isViewerMode && <ProjectSwitcher onSwitched={afterProjectSwitch}>
        {!isParadigm && <ModelPicker />}
        <div className="canvas-toolbar-group canvas-toolbar-context">
        {isParadigm && (
          <>
            <CanvasToolbarOverflowAction label={t('paradigm.addHuman')} icon={<MessageCircleQuestion size={14} />}>
            <button
              onClick={() => addStep('human')}
              className="bg-card border border-warm/40 rounded-control h-8 px-3 flex items-center gap-1.5 hover:bg-warm/10 transition-colors text-warm text-control font-medium"
            >
              <MessageCircleQuestion size={14} strokeWidth={1.75} /> {t('paradigm.addHuman')}
            </button>
            </CanvasToolbarOverflowAction>
            <CanvasToolbarOverflowAction label={t('paradigm.addPrompt')} icon={<SquareTerminal size={14} />}>
            <button
              onClick={() => addStep('prompt')}
              className="bg-card border border-accent/40 rounded-control h-8 px-3 flex items-center gap-1.5 hover:bg-accent/10 transition-colors text-accent text-control font-medium"
            >
              <SquareTerminal size={14} strokeWidth={1.75} /> {t('paradigm.addPrompt')}
            </button>
            </CanvasToolbarOverflowAction>
            <CanvasToolbarOverflowAction label={t('paradigm.instantiate')} icon={<ArrowRight size={14} />}>
            <button
              onClick={() => void instantiate()}

              className="bg-ink text-card rounded-control h-8 px-3 flex items-center gap-1.5 hover:bg-ink/85 transition-colors text-control font-medium"
            >
              ▶ {t('paradigm.instantiate')}
            </button>
            </CanvasToolbarOverflowAction>
          </>
        )}
        {!isParadigm && <WaitingPill />}
        {!isParadigm && <AgentCwdChip />}
        {!isParadigm && <AgentPermissionChip />}
        {/* Batch replay: visible only when something is stale. Price at the
            decision point — N generations is the one many-calls-per-click
            action in the app, so it confirms with a token estimate. */}
        {staleCount > 0 && !isParadigm && (
          <CanvasToolbarOverflowAction label={`${t('replay.chipTitle')} · ${staleCount}`} icon={<ListRestart size={14} />}>
          <button
            onClick={() => {
              const { nodes: ns, edges: es } = useStore.getState();
              const staleIds = shownStaleIds(useStore.getState());
              const estTok = staleIds.reduce((sum, sid) => {
                const blanked = ns.map((x) => x.id === sid ? { ...x, data: { ...x.data, question: '', response: '' } } : x);
                const { layerTokens } = buildContext(sid, blanked, es);
                const q = ns.find((x) => x.id === sid)?.data.question ?? '';
                return sum + layerTokens.material + layerTokens.reference + layerTokens.chain + countTokens(q);
              }, 0);
              void confirmDialog({
                title: t('replay.confirmTitle'),
                message: fmt(t('replay.confirmMsg'), { n: staleCount, tok: estTok.toLocaleString() }),
                confirmLabel: t('replay.confirmBtn'),
              }).then((ok) => { if (ok) void useStore.getState().replayStale(); });
            }}
            className="bg-amber-500/10 border border-amber-500/40 rounded-control h-8 px-3 flex items-center gap-1.5 hover:bg-amber-500/20 transition-colors text-amber-600 text-control font-medium"

          >
            <ListRestart size={14} strokeWidth={1.75} /> {staleCount}
          </button>
          </CanvasToolbarOverflowAction>
        )}
        {/* Keep transient status separate from the canvas view controls. */}
        {condenseBuilding && !isViewerMode && (
          <CanvasToolbarOverflowAction label={fmt(t('condense.entryBuilding'), { i: String(condenseRunState.current), n: String(condenseRunState.total) })} icon={<Loader2 size={14} className="animate-spin" />}>
          <button
            onClick={() => useUiStore.getState().setCondenseDialogOpen(true)}
            className="bg-card border border-accent/50 rounded-control h-8 px-2 flex items-center justify-center gap-1.5 hover:bg-wash transition-colors text-accent"
            data-tooltip={fmt(t('condense.entryBuilding'), { i: String(condenseRunState.current), n: String(condenseRunState.total) })}
            data-condense-entry
          >
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /><span className="text-control font-mono">{condenseRunState.current}/{condenseRunState.total}</span>
          </button>
          </CanvasToolbarOverflowAction>
        )}
        </div>
      </ProjectSwitcher>}

      <div className="canvas-header-actions">
      {/* Viewer: the toolbar collapses to a read-only badge + download + brand
          link — every mutating control lives in the author toolbar below. */}
      {isViewerMode && (
        <div
          className="canvas-toolbar relative z-10"
          data-top-toolbar
        >
          <span className="canvas-toolbar-icon bg-card border border-line rounded-control h-8 px-3 flex items-center gap-1.5 text-ink-muted text-control font-medium" data-tooltip={t('viewer.badge')} data-tooltip-icon-only aria-label={t('viewer.badge')} data-viewer-badge>
            <Eye size={14} strokeWidth={1.75} /><span className="canvas-toolbar-label">{t('viewer.badge')}</span>
          </span>
          <button
            onClick={() => setSearchOpen(true)}
            className="bg-card border border-line rounded-control w-8 h-8 flex items-center justify-center hover:bg-wash transition-colors text-ink-muted hover:text-accent"
            data-tooltip={t('search.entryTitle')} aria-label={t('search.entryTitle')}
            data-search-entry
          >
            <Search size={15} strokeWidth={1.75} />
          </button>
          <LangSwitch />
          <button
            onClick={() => exportActiveProjectJson()}
            className="bg-card border border-line rounded-control w-8 h-8 flex items-center justify-center hover:bg-wash transition-colors text-ink-muted hover:text-accent"
            data-tooltip={t('viewer.downloadJson')} aria-label={t('viewer.downloadJson')}
          >
            <FileDown size={15} strokeWidth={1.75} />
          </button>
          <a
            href="https://github.com/chenxiachan/thoughtdag"
            target="_blank"
            rel="noreferrer"
            data-tooltip={t('viewer.openApp')} data-tooltip-icon-only aria-label={t('viewer.openApp')}
            className="canvas-toolbar-icon bg-ink text-card rounded-control h-8 px-3 flex items-center gap-1.5 hover:bg-ink/85 transition-colors text-control font-medium"
          >
            <ArrowRight size={14} /><span className="canvas-toolbar-label">{t('viewer.openApp')}</span>
          </a>
        </div>
      )}

      {/* Canvas tools share the right toolbar and its panel dock. */}
      {!isViewerMode && (
        <div className="canvas-toolbar canvas-toolbar-main relative z-10" data-top-toolbar data-selection-menu>
        {hasNodes && <div className="canvas-toolbar-group">
        {hasNodes && frames.length > 0 && (
          <div ref={frameNavRef} className="contents">
            <button
              onClick={() => setFrameNavOpen((v) => !v)}
              className="canvas-toolbar-button canvas-toolbar-secondary"
              data-tooltip={t('toolbar.frames')} aria-label={t('toolbar.frames')}
              aria-expanded={frameNavOpen}
              data-frame-nav-trigger
            >
              <Frame size={16} strokeWidth={1.75} />
            </button>
            {frameNavOpen && (
              <div ref={frameNavPanelRef} tabIndex={-1} className="canvas-tool-panel canvas-tool-menu py-1" style={toolbarPanelPosition} data-frame-nav-panel>
                {frames.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setFrameNavOpen(false);
                      rfInstance.current?.fitBounds(
                        { x: f.position.x, y: f.position.y, width: f.width ?? 640, height: f.height ?? 420 },
                        { duration: 400, padding: 0.15 },
                      );
                    }}
                    className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2"
                  >
                    <span className={`w-2.5 h-2.5 rounded-tag shrink-0 ${(FRAME_COLORS[f.data.frameColor ?? 'gray'] ?? FRAME_COLORS.gray).dot}`} />
                    <span className="truncate">{f.data.question || t('frame.untitled')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {hasNodes && (
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="canvas-toolbar-button canvas-toolbar-secondary"
            aria-pressed={chatOpen}
            data-tooltip={t('chat.entryTitle')} aria-label={t('chat.entryTitle')}
            data-chat-entry
          >
            <MessageCircleQuestion size={16} strokeWidth={1.75} />
          </button>
        )}
        {hasNodes && (
          <button
            onClick={() => setSearchOpen(true)}
            className="canvas-toolbar-button"
            aria-expanded={searchOpen}
            data-tooltip={t('search.entryTitle')} aria-label={t('search.entryTitle')}
            data-search-entry
          >
            <Search size={16} strokeWidth={1.75} />
          </button>
        )}
        {hasNodes && !isParadigm && (
          <DiagnosticsPanel showTrigger={false} openPing={diagPing} onLocate={(id) => {
            const n = useStore.getState().nodes.find((x) => x.id === id);
            if (n) {
              setSelectedNodeId(id);
              centerNode(n, { zoom: 1 });
            }
          }} />
        )}
        <CanvasDetailControl openPing={detailPing} />
        <button
          onClick={() => {
            if (showLayoutPanel) layoutPanelRef.current?.close();
            else useCanvasEditing.getState().setLayoutOpen(true);
          }}
          className="canvas-toolbar-button canvas-toolbar-icon"
          data-tooltip={t('canvasLayout.title')}
          data-tooltip-icon-only
          aria-label={t('canvasLayout.title')}
          aria-expanded={showLayoutPanel}
          data-layout-entry
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} />
          <span className="canvas-toolbar-label">{t('canvasLayout.title')}</span>
        </button>
        </div>}
        <div className="canvas-toolbar-group">
        {/* ⋯ overflow: share, memory, annotations, tutorial —
            one slot regardless of language or panel width. */}
        <div ref={moreRef} className="relative" data-selection-menu>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="canvas-toolbar-button"
            aria-label={t('toolbar.more')}
            aria-expanded={moreOpen}
            data-toolbar-more
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </button>
          {moreOpen && (
            <div className="canvas-tool-panel canvas-tool-menu py-1" style={toolbarPanelPosition} data-toolbar-more-panel>
              <div className="canvas-toolbar-overflow">
                {hasNodes && <button type="button" data-menu-detail
                  onClick={() => { setMoreOpen(false); setDetailPing(value => value + 1); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash flex items-center gap-2.5">
                  <ListFilter size={14} className="text-ink-faint shrink-0" />{t('detail.title')}
                </button>}
                {hasNodes && frames.length > 0 && <button type="button" data-menu-frames
                  onClick={() => { setMoreOpen(false); setFrameNavOpen(true); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash flex items-center gap-2.5">
                  <Frame size={14} className="text-ink-faint shrink-0" />{t('toolbar.frames')}
                </button>}
                {hasNodes && <button type="button" data-menu-chat aria-pressed={chatOpen}
                  onClick={() => { setMoreOpen(false); setChatOpen(value => !value); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash flex items-center gap-2.5">
                  <MessageCircleQuestion size={14} className="text-ink-faint shrink-0" />{t('chat.entryTitle')}
                </button>}
              </div>
              {backupCapable() && <button type="button" data-menu-backup
                onClick={() => { setMoreOpen(false); useUiStore.getState().setBackupDialogOpen(true); }}
                className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash flex items-center gap-2.5">
                <FolderSync size={14} className="text-ink-faint shrink-0" />{t('backup.dialogTitle')}
              </button>}
              <div ref={setOverflowMenu} className="canvas-toolbar-minimal-menu">
                <button type="button" data-menu-undo disabled={!undoable.canUndo}
                  onClick={() => { setMoreOpen(false); undo(); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash disabled:opacity-30 flex items-center gap-2.5">
                  <Undo2 size={14} className="text-ink-faint shrink-0" />{t('canvas.undo')}
                </button>
                <button type="button" data-menu-redo disabled={!undoable.canRedo}
                  onClick={() => { setMoreOpen(false); redo(); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash disabled:opacity-30 flex items-center gap-2.5">
                  <Redo2 size={14} className="text-ink-faint shrink-0" />{t('canvas.redo')}
                </button>
              </div>
              {hasNodes && (
                <button
                  onClick={() => { setMoreOpen(false); setAnnotationsHidden(!annotationsHidden); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-tooltip={annotationsHidden ? undefined : t('toolbar.hideAnnotations')}
                >
                  <StickyNote size={14} strokeWidth={1.75} className={`shrink-0 ${annotationsHidden ? 'text-accent' : 'text-ink-faint'}`} /> {annotationsHidden ? t('toolbar.menuAnnotationsShow') : t('toolbar.menuAnnotationsHide')}
                </button>
              )}
              <button
                onClick={() => { setMoreOpen(false); setWheelPans(!wheelPans); }}
                className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"

                aria-pressed={wheelPans}
                data-wheel-pans
              >
                <Hand size={14} strokeWidth={1.75} className={`shrink-0 ${wheelPans ? 'text-accent' : 'text-ink-faint'}`} /> <span className="flex-1">{t('toolbar.menuWheelPans')}</span>{wheelPans && <span className="text-accent">✓</span>}
              </button>
              {highlightCount > 0 && (
                <button
                  onClick={() => { setMoreOpen(false); useUiStore.getState().setHighlightsOverviewOpen(true); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-hlov-entry
                >
                  <Highlighter size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {fmt(t('hlov.entry'), { n: highlightCount })}
                </button>
              )}
              {materialCount > 0 && (
                <button
                  onClick={() => { setMoreOpen(false); useUiStore.getState().setMaterialsOverviewOpen(true); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-matov-entry
                >
                  <Paperclip size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {fmt(t('matov.entry'), { n: materialCount })}
                </button>
              )}
              {hasNodes && <div className="border-t border-line/60 my-1" />}
              {hasNodes && !isParadigm && !isViewerMode && (
                <button
                  onClick={() => { setMoreOpen(false); useUiStore.getState().setCondenseDialogOpen(true); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"

                >
                  <Minimize2 size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('condense.title')}…
                </button>
              )}
              {hasNodes && !isParadigm && (
                <button
                  onClick={() => { setMoreOpen(false); setDiagPing((v) => v + 1); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-menu-diagnose
                >
                  <Stethoscope size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('toolbar.menuDiagnose')}
                </button>
              )}
              {hasNodes && !isParadigm && (
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    void (async () => {
                      const { nodes: ns, edges: es } = useStore.getState();
                      // exit gate: a mirrored canvas can carry CLI tool
                      // output — keys, tokens — and a share link IS a copy
                      const { confirmIfSensitive } = await import('./lib/sensitive-scan');
                      if (!await confirmIfSensitive(ns)) return;
                      const url = await buildViewerLink(ns, es);
                      await navigator.clipboard.writeText(url).catch(() => {});
                      useUiStore.getState().setShareDialogUrl(url);
                    })();
                  }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-share-link
                  data-tooltip={t('viewer.shareTitle')}
                >
                  <Share2 size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('toolbar.menuShare')}
                </button>
              )}
              {hasNodes && (
                <button
                  onClick={() => { setMoreOpen(false); if (isParadigm) exportActiveParadigm(); else exportActiveProjectJson(); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-menu-export
                >
                  <FileDown size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {isParadigm ? t('paradigm.exportParadigm') : t('switcher.exportBackup')}
                </button>
              )}
              {hasEvents && (
                <button
                  onClick={() => { setMoreOpen(false); exportEventLogCsv(); }}
                  className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                  data-tooltip={t('toolbar.exportEventsTitle')}
                >
                  <FileText size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('toolbar.exportEvents')}
                </button>
              )}
              {hasNodes && <div className="border-t border-line/60 my-1" />}
              <div className="px-3 pt-2 pb-1" data-menu-language>
                <div className="text-control text-ink-faint mb-1.5">{t('lang.label')}</div>
                <LangSwitch variant="menu" />
              </div>
              {/* appearance: two independent axes — lighting remaps the
                  tokens, paper retextures the canvas (and arms snapping) */}
              <div className="px-3 pt-2 pb-1" data-appearance-lighting>
                <div className="text-control text-ink-faint mb-1.5">{t('appearance.lighting')}</div>
                <div className="flex rounded-control border border-line overflow-hidden text-control">
                  {([['light', t('appearance.light')], ['dark', t('appearance.dark')], ['system', t('appearance.system')]] as const).map(([v, label], i) => (
                    <button
                      key={v}
                      onClick={() => useAppearance.getState().setLighting(v)}
                      className={`flex-1 px-1 py-1.5 transition-colors ${i > 0 ? 'border-l border-line' : ''} ${lightingChoice === v ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-3 pt-1 pb-2" data-appearance-paper>
                <div className="text-control text-ink-faint mb-1.5">{t('appearance.paper')}</div>
                <div className="flex rounded-control border border-line overflow-hidden text-control">
                  {([['plain', t('appearance.plain')], ['grid', t('appearance.grid')]] as const).map(([v, label], i) => (
                    <button
                      key={v}
                      onClick={() => useAppearance.getState().setPaper(v)}
                      className={`flex-1 px-1 py-1.5 transition-colors ${i > 0 ? 'border-l border-line' : ''} ${paperTexture === v ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-line/60 my-1" />
              <button
                onClick={() => { setMoreOpen(false); useUiStore.getState().setMemoryManagerOpen(true); }}
                className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                data-tooltip={t('memory.entryTitle')}
              >
                <Brain size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('memory.managerTitle')}
              </button>
              <button
                onClick={() => { setMoreOpen(false); setTutorialOpen(true); }}
                className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
              >
                <CircleHelp size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('landing.howItWorks')}
              </button>
              {pluginUpdate && (
                <button
                  onClick={() => { setMoreOpen(false); const text = harnessDesktop ? `dsh-thoughtdag@${pluginUpdate.latest}` : pluginUpdateCommand(pluginUpdate.latest); void navigator.clipboard.writeText(text).then(() => toast('success', t(harnessDesktop ? 'plugin.updateCopiedDesktop' : 'plugin.updateCopied'))); }}
                  className="w-full text-left px-3 py-2 text-control text-accent hover:bg-wash transition-colors flex items-center gap-2.5"

                  data-plugin-update
                >
                  <Download size={14} strokeWidth={1.75} className="shrink-0" /> {fmt(t('plugin.updateAvailable'), { v: pluginUpdate.latest })}
                </button>
              )}
              <button
                onClick={() => { setMoreOpen(false); useUiStore.getState().setReleaseNotesOpen(true); }}
                className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                data-open-release-notes
              >
                <HistoryIcon size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('releaseNotes.entry')}
              </button>
              {/* the way back to the repository, always there and never a nag; the star count is the social proof */}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setMoreOpen(false)}
                className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-2.5"
                data-open-github
              >
                <Star size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('menu.github')}
                {githubStars !== null && <span className="ml-auto text-control text-ink-faint tabular-nums" data-github-stars>★ {formatStars(githubStars)}</span>}
              </a>
            </div>
          )}
        </div>
        </div>
        <div className="canvas-toolbar-group canvas-toolbar-history" data-selection-menu>
        <button
          onClick={undo}
          disabled={!undoable.canUndo}
          className="canvas-toolbar-button"
          data-tooltip={t('canvas.undo')} aria-label={t('canvas.undo')}
        >
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button
          onClick={redo}
          disabled={!undoable.canRedo}
          className="canvas-toolbar-button"
          data-tooltip={t('canvas.redo')} aria-label={t('canvas.redo')}
        >
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
        </div>
        </div>
      )}
      </div>

      {/* Search floats below the fixed row and stays open while browsing results. */}
      <SearchBar
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onLocate={(id) => {
          const n = useStore.getState().nodes.find((x) => x.id === id);
          if (n) {
            setSelectedNodeId(id);
            centerNode(n, { zoom: 1 });
          }
        }}
      />

      </CanvasToolbarOverflowContext.Provider>
      </div>

      {/* Ask the canvas: a persistent work panel below the right toolbar. */}
      {!isViewerMode && (
        <CanvasChat
          open={showChatPanel}
          onClose={() => setChatOpen(false)}
          onLocate={(id) => {
            const n = useStore.getState().nodes.find((x) => x.id === id);
            if (n) { setSelectedNodeId(id); centerNode(n, { zoom: 1 }); }
          }}
        />
      )}

      {/* Edge context menu */}
      {nodeMenu && (
        <NodeContextMenu x={nodeMenu.x} y={nodeMenu.y} nodeId={nodeMenu.nodeId} onClose={() => setNodeMenu(null)} />
      )}
      <MaterialsOverviewModal onLocate={(nid) => {
        const n = useStore.getState().nodes.find((x) => x.id === nid);
        if (n) {
          setSelectedNodeId(nid);
          centerNode(n, { zoom: 1 });
        }
      }} />
      <TimelineOverviewModal onLocate={(nid) => {
        const n = useStore.getState().nodes.find((x) => x.id === nid);
        if (n) {
          setSelectedNodeId(nid);
          centerNode(n, { zoom: 1 });
        }
      }} />
      <HighlightsOverviewModal onLocate={(nid) => {
        const n = useStore.getState().nodes.find((x) => x.id === nid);
        if (n) {
          setSelectedNodeId(nid);
          centerNode(n, { zoom: 1 });
        }
      }} />
      {edgeMenu && (
        <div
          className="fixed z-50 bg-card border border-line rounded-overlay shadow-lg py-1 min-w-[120px]"
          style={{ left: edgeMenu.x, top: edgeMenu.y }}
        >
          <button onClick={() => { openEdgeEditor(edgeMenu.edgeId); setEdgeMenu(null); }}
            className="w-full text-left px-4 py-2 text-control text-ink hover:bg-wash transition-colors flex items-center gap-1.5">
            <Workflow size={14} strokeWidth={1.75} />{t('edgeEditor.title')}
          </button>
          <button
            onClick={() => deleteEdge(edgeMenu.edgeId)}
            className="w-full text-left px-4 py-2 text-control transition-colors flex items-center gap-1.5 object-action-danger"
          >
            <Trash2 size={14} strokeWidth={1.75} />
            {t('canvas.deleteEdge')}
          </button>
        </div>
      )}
      </div>

      {/* Focus Panel — floating overlay on the right; never for orchestration
          or content nodes, which are edited in place on the canvas */}
      <CondenseDialog onFocusSegment={(ids) => {
        const rf = rfInstance.current;
        // read fresh state: the condensed copy may have been created AFTER
        // this closure captured the render's nodes array
        const members = useStore.getState().nodes.filter((n) => ids.includes(n.id));
        if (!rf || members.length === 0) return;
        const xs = members.map((n) => n.position.x), ys = members.map((n) => n.position.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        const w = Math.max(...xs) + 520 - x, h = Math.max(...ys) + 240 - y;
        // widen rightwards: the condense panel covers the right edge
        rf.fitBounds({ x, y, width: w + 700, height: h }, { duration: 350, padding: 0.15 });
      }} />
      {panelOpen && panelNodeId && <FocusPanel nodeId={panelNodeId} onFocusNode={(id) => {
        const node = nodes.find(n => n.id === id);
        if (node) {
          if (!isContentKind(node.data.stepKind) && node.data.stepKind !== 'frame') useUiStore.getState().setPanelOpen(true, id);
          centerNode(node, { duration: 300 });
        }
      }} />}
      {showLayoutPanel && rfInstance.current && <CanvasLayoutPanel ref={layoutPanelRef} flow={rfInstance.current} />}
      {showProperties && formatPanelReady && !isViewerMode && <CanvasQuickLayoutContext.Provider value={quickLayout}>
        <SelectionInspector getViewportRect={getViewportRect} withDetails={panelOpen}
        onClose={() => { if (useCanvasToolCards.getState().active?.name === 'selection-properties') useCanvasToolCards.getState().active?.suspend(); }}
        onLocateNode={(id) => {
          const node = nodes.find((item) => item.id === id);
          if (!node) return;
          const rf = rfInstance.current;
          const canvas = document.querySelector<HTMLElement>('.react-flow');
          const inspector = document.querySelector<HTMLElement>('[data-selection-properties]');
          const width = node.measured?.width ?? node.width ?? 480;
          if (rf && canvas && inspector) {
            const region = canvasToolViewport(canvas, inspector);
            const height = node.measured?.height ?? node.height ?? 240;
            const zoom = Math.max(0.04, Math.min(1, region.width / width, region.height / height));
            void rf.setViewport({ zoom, x: region.x + region.width / 2 - (node.position.x + width / 2) * zoom,
              y: region.y + region.height / 2 - (node.position.y + height / 2) * zoom }, { duration: 300 });
          } else centerNode(node, { zoom: Math.max(0.7, rf?.getZoom() ?? 1), offX: width / 2 });
        }} /></CanvasQuickLayoutContext.Provider>}

      {/* Material reading overlay: select a passage, ask, the node lands on
          the canvas immediately (a view onto the material, not a container) */}
      <MaterialReader onLocate={(id) => {
        const n = useStore.getState().nodes.find((x) => x.id === id);
        if (n) {
          setSelectedNodeId(id);
          centerNode(n, { zoom: 1 });
        }
      }} />
    </div>
  );
}


// Stamps the current semantic-zoom tier on the canvas element so CSS can
// restyle global layers, and streams the live zoom into a CSS variable so
// glyph seals and edges can counter-scale (POI style: world position,
// fixed screen size — the icon map stays dense however far you zoom out).
// The moment of looking at the shape IS the moment of wanting to share it:
// the pill exists only in the map/glyph tiers, the working tier stays
// silent. Must live inside <ReactFlow> to reach the flow store.
// panelShiftWidth comes from the App's COMPOSITE panel-visible signal —
// reading the raw ui-store panelOpen here desyncs the dock when the panel
// closes via a pane click (which clears the selection, not the flag).
function ThoughtMapPill({ panelShiftWidth }: { panelShiftWidth: number }) {
  const tier = useZoomTier();
  const t = useT();
  const rf = useReactFlow();
  const nodeCount = useStore((s) => s.nodes.length);
  const nodes = useStore((s) => s.nodes);

  // The flight destination: the thought node touched most recently.
  // Content nodes (notes, files, links, frames) never count as "work".
  const lastActive = useMemo(() => {
    let best: (typeof nodes)[number] | null = null;
    let bestAt = '';
    for (const n of nodes) {
      if (n.data.stepKind && n.data.stepKind !== 'human' && n.data.stepKind !== 'prompt') continue;
      const at = [n.data.lastGeneratedAt, n.data.askedAt, n.data.createdAt,
        ...(n.data.editedAts ?? [])].filter(Boolean).sort().pop() as string | undefined;
      if (at && at > bestAt) { bestAt = at; best = n; }
    }
    return best ? { node: best, at: bestAt } : null;
  }, [nodes]);

  if (isViewerMode || tier === 'work' || nodeCount < 2) return null;

  const flyBack = () => {
    if (!lastActive) return;
    useUiStore.getState().setBeaconNodeId(null);
    const { node } = lastActive;
    rf.setCenter(node.position.x + 260, node.position.y + 110, { zoom: 1, duration: 1100 });
    // three beats: flight → panel opens (recentered for its width) → recap toast
    window.setTimeout(() => {
      useStore.getState().setSelectedNodeId(node.id);
      useUiStore.getState().setPanelOpen(true, node.id);
      window.setTimeout(() => {
        rf.setCenter(node.position.x + 260 + panelShift(node.id) / 2, node.position.y + 110, { zoom: 1, duration: 300 });
      }, 60);
    }, 1150);
    window.setTimeout(() => {
      toast('success', t('continue.arrived'), 12000,
        { label: t('continue.summarize'), run: () => void recapToNote(node.id) });
    }, 1550);
  };

  return (
    <div
      className="canvas-map-dock absolute z-10 flex items-center gap-related -translate-x-1/2 transition-[left] duration-300"
      style={{ left: `calc((100% - ${panelShiftWidth}px) / 2)` }}
      data-map-dock
    >
      <button
        onClick={() => useUiStore.getState().setThoughtMapOpen(true)}
        data-tmap-pill
        className="flex h-10 items-center gap-related bg-card border border-line-strong rounded-control px-surface-inset whitespace-nowrap text-control text-ink hover:border-accent/40 hover:text-accent transition-colors"
      >
        <ImageDown size={16} strokeWidth={1.75} /> {t('tmap.export')}
      </button>
      {lastActive && (
        <button
          onClick={flyBack}
          onMouseEnter={() => useUiStore.getState().setBeaconNodeId(lastActive.node.id)}
          onMouseLeave={() => useUiStore.getState().setBeaconNodeId(null)}
          data-tooltip={t('continue.buttonTitle')}
          data-continue-pill
          className="flex h-10 items-center gap-related bg-action text-white rounded-control px-surface-inset whitespace-nowrap text-control hover:bg-action-strong transition-colors"
        >
          <Rewind size={16} strokeWidth={1.75} /> {t('continue.button')}
        </button>
      )}
    </div>
  );
}

// Must live inside <ReactFlow> to reach the flow store.
function ZoomTierTag() {
  const tier = useZoomTier();
  const zoom = useRfStore((s) => s.transform[2]);
  useEffect(() => {
    document.querySelector('.react-flow')?.setAttribute('data-zoom-tier', tier);
  }, [tier]);
  useEffect(() => {
    (document.querySelector('.react-flow') as HTMLElement | null)?.style.setProperty('--tdag-zoom', String(zoom));
  }, [zoom]);
  return null;
}
