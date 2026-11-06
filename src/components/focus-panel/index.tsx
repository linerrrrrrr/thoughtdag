import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { partitionContext } from '../../lib/graph';
import { buildContext, resolveRoleFor } from '../../store/context-builder';
import { PANEL_WIDTH_KEY, PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH, PANEL_INSET } from '../../lib/constants';
import { activeSummary, awaitingInput } from '../../utils';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import RoleLine from './RoleLine';
import RoleEditor from './RoleEditor';
import AgentSessionLine from './AgentSessionLine';
import HandoffLine from './HandoffLine';
import AttachmentsSection from './AttachmentsSection';
import RecallSection from './RecallSection';
import RelatedSection from './RelatedSection';
import QuestionSection from './QuestionSection';
import ResponseSection from './ResponseSection';
import NodeHighlightsSection from '../NodeHighlightsSection';
import { useTextHighlighter } from '../../lib/use-text-highlighter';
import HeaderActions from './HeaderActions';
import ContextChainSection from './ContextChainSection';
import ContextOrderSection from './ContextOrderSection';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { getNodeNameSource } from '../../lib/node-display-name';
import NodeMetadataEditor from '../NodeMetadataEditor';
import './FocusPanel.css';
import { activeAgentActivity, originalQuestionBeforeInstructions } from '../../lib/agent-activity';

// The panel reads one turn and its context. Further questions belong to a
// new linked node, whose own question editor opens before any request runs.

export default function FocusPanel({ nodeId, onFocusNode }: { nodeId: string; onFocusNode?: (id: string) => void }) {
  const {
    nodes, edges,
    addAttachment, removeAttachment, toggleExcludeAttachment, setAttachmentRenderMode, getInheritedAttachments,
  } = useStore();
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  // This working panel can outlive its opener; restoring stale canvas focus would reselect it.
  useDismissableLayer({ open: true, refs: [panelRef], dismissOnOutside: false, restoreFocus: false,
    onDismiss: () => useUiStore.getState().setPanelOpen(false) });

  const [metadataOpen, setMetadataOpen] = useState(false);

  // Resizable width, persisted on drag end; double-click resets the default.
  // The width lives in ui-store so the canvas toolbar can offset itself.
  const panelWidth = useUiStore((s) => s.panelWidth);
  const setPanelWidth = useUiStore((s) => s.setPanelWidth);
  // the recall switch's current default, for a node asked before it existed
  const recallEnabled = useUiStore((s) => s.recallEnabled);
  const [resizing, setResizing] = useState(false);

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const maxW = Math.floor(window.innerWidth * 0.7);
    setPanelWidth(Math.min(maxW, Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_INSET - e.clientX)));
  };
  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizing) return;
    setResizing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    localStorage.setItem(PANEL_WIDTH_KEY, String(useUiStore.getState().panelWidth));
  };
  const onResizeDoubleClick = () => {
    setPanelWidth(PANEL_DEFAULT_WIDTH);
    localStorage.removeItem(PANEL_WIDTH_KEY);
  };

  // Close transient editors when switching nodes (adjust-during-render).
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  // the role editor's text while it is open (null = closed); it closes with the node
  const [roleEdit, setRoleEdit] = useState<string | null>(null);
  if (prevNodeId !== nodeId) {
    setPrevNodeId(nodeId);
    setRoleEdit(null);
    setMetadataOpen(false);
  }

  const node = nodes.find((n) => n.id === nodeId);
  const canHighlight = !!node && !isViewerMode && !!node.data.response && !node.data.isLoading && !node.data.isEditingResponse;
  const highlighter = useTextHighlighter({
    scopeKey: `${nodeId}:${node?.data.responseIndex}:${node?.data.response}`,
    enabled: canHighlight,
    surfaceRef: responseRef,
  });

  if (!node) {
    return null;
  }

  const data = node.data;
  const hasMultipleVersions = data.responses.length > 1;
  // A draft node uses its own question editor.
  const awaiting = awaitingInput(data);

  // Inherited role for the status line: the SAME resolution buildContext
  // injects (structural mainline, legacy roleMode honored) — what the panel
  // shows is by construction what the model receives.
  const inheritedRole = data.rolePrompt
    ? ''
    : resolveRoleFor(nodeId!, nodes, edges, { ignoreOwn: true }) ?? '';

  // Layered context view — same partition the prompt builder uses, so the
  // tree the user reads and the prompt the model reads never drift apart.
  const partition = partitionContext(nodeId!, nodes, edges);
  const { layerTokens } = buildContext(nodeId!, nodes, edges);
  const totalContextTokens = layerTokens.material + layerTokens.reference + layerTokens.chain;
  const highlightedTexts = new Set(data.highlights.map((h) => h.text));

  return (
    <div
      ref={panelRef} data-focus-panel data-focus-node-id={nodeId}
      role="complementary" aria-label={t('panel.reading')}
      className={`focus-panel-shell absolute right-canvas-inset top-canvas-inset bottom-canvas-inset z-20 border rounded-panel overflow-hidden flex flex-col max-w-[calc(100vw-32px)] md:max-w-[70vw] ${resizing ? 'select-none' : ''}`}
      style={{ width: panelWidth, minWidth: `min(${PANEL_MIN_WIDTH}px, calc(100vw - ${PANEL_INSET * 2}px))` }}
      onKeyDown={(event) => { if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) event.stopPropagation(); }}
    >
      {/* Resize handle on the left edge */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onDoubleClick={onResizeDoubleClick}
        className={`absolute left-0 top-0 h-full w-[8px] -ml-[3px] z-20 cursor-col-resize hover:bg-accent/20 transition-colors flex items-center justify-center ${resizing ? 'bg-accent/30' : ''}`}
        role="separator" aria-orientation="vertical" aria-label={t('panel.resizeTitle')}
        data-panel-resize
      >
        {/* a visible grip: the handle exists whether or not you hover it */}
        <div className={`w-[3px] h-9 rounded-control transition-colors ${resizing ? 'bg-accent' : 'bg-line-strong'}`} />
      </div>
      {/* Reading identity stays quiet; operational details follow the conversation. */}
      <div className="focus-panel-header flex items-center gap-related shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="focus-panel-title" data-tooltip={getNodeNameSource(data, t('ctx.unnamedNode'))} data-tooltip-overflow data-reading-node-name>{getNodeNameSource(data, t('ctx.unnamedNode'))}</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isViewerMode && <HeaderActions key={nodeId} nodeId={nodeId!} isLoading={data.isLoading} />}
          <button
            onClick={() => useUiStore.getState().setPanelOpen(false)}
            aria-label={t('panel.close')} data-node-details-close
            className="text-ink-faint hover:text-ink hover:bg-wash rounded-control transition-colors shrink-0 w-control-size h-control-size flex items-center justify-center"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {/* A continuous reading surface; section dividers provide hierarchy. */}
      <div className="focus-panel-content flex-1 min-h-0 overflow-y-auto">
        <NodeMetadataEditor key={`metadata-${nodeId}`} id={nodeId} data={data}
          name={getNodeNameSource(data, t('ctx.unnamedNode'))}
          preview={data.displaySummary ?? activeSummary(data)} overview={false}
          open={metadataOpen} onOpenChange={setMetadataOpen} variant="panel" />
        {(data.response || data.highlights.length > 0) && <NodeHighlightsSection key={`h-${nodeId}`}
          nodeId={nodeId} highlights={data.highlights} highlightMode={data.highlightMode}
          highlighter={highlighter} canHighlight={canHighlight} />}
        <AgentSessionLine data={data} />
        <HandoffLine nodeId={nodeId!} data={data} />
        <QuestionSection
          key={`q-${nodeId}-${data.isEditing ? 'edit' : 'view'}`}
          nodeId={nodeId!}
          base={data.agentSession?.cwd ?? data.importSource?.cwd}
          question={data.question}
          displayQuestion={originalQuestionBeforeInstructions(data.question, activeAgentActivity(data))}
          isEditing={data.isEditing && data.questionEditor === 'panel'}
          isHuman={data.stepKind === 'human'}
          awaiting={!!awaiting}
          placeholder={awaiting ? (data.instruction || t('node.askPlaceholder')) : undefined}
          branchContext={data.branchContext}
        />

        <ResponseSection
          key={`r-${nodeId}`}
          nodeId={nodeId!}
          data={data}
          hasMultipleVersions={hasMultipleVersions}
          highlightedTexts={highlightedTexts}
          highlighter={highlighter}
          responseRef={responseRef}
          onFocusNode={onFocusNode}
        />

        <div className="focus-panel-inspect">
          <div className="focus-panel-role">
            <RoleLine data={data} inheritedRole={inheritedRole} onEdit={(initial) => setRoleEdit(initial)} />
          </div>
          {roleEdit !== null && !isViewerMode && (
            <RoleEditor nodeId={nodeId} initial={roleEdit} inherited={!data.rolePrompt && !!inheritedRole} hasOwn={!!data.rolePrompt} onClose={() => setRoleEdit(null)} />
          )}
        <AttachmentsSection
          nodeId={nodeId!}
          attachments={data.attachments || []}
          excludedAttachmentIds={data.excludedAttachmentIds || []}
          includedAttachmentIds={data.includedAttachmentIds || []}
          addAttachment={addAttachment}
          removeAttachment={removeAttachment}
          toggleExcludeAttachment={toggleExcludeAttachment}
          setAttachmentRenderMode={setAttachmentRenderMode}
          getInheritedAttachments={getInheritedAttachments}
        />

        <RecallSection nodeId={nodeId!} items={data.recallItems} meta={data.recallMeta} recallOn={data.recall ?? recallEnabled} progress={data.recallProgress} />
        <RelatedSection key={`rel-${nodeId}`} question={data.question} answer={data.response ?? ''} />

        <ContextOrderSection nodeId={node.id} />
        <ContextChainSection
          key={`c-${nodeId}`}
          partition={partition}
          totalContextTokens={totalContextTokens}
          onFocusNode={onFocusNode}
        />
        </div>
      </div>
    </div>
  );
}
