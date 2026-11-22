import { appSettings } from '../../lib/disk-storage';
import { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store';
import type { ThoughtNode } from '../../types';
import { useUiStore } from '../../lib/ui-store';
import { PANEL_WIDTH_KEY, PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH, PANEL_INSET } from '../../lib/constants';
import { activeSummary, awaitingInput } from '../../utils';
import { useT } from '../../i18n';
import { isViewerMode } from '../../lib/viewer';
import NodeInfoLine from './NodeInfoLine';
import AgentSessionLine from './AgentSessionLine';
import HandoffLine from './HandoffLine';
import AttachmentsSection from './AttachmentsSection';
import RecallSection from './RecallSection';
import RelatedSection from './RelatedSection';
import QuestionSection from './QuestionSection';
import ResponseSection from './ResponseSection';
import NodeHighlightsSection from '../NodeHighlightsSection';
import { canHighlightConversation, hasConversationHighlightText, useConversationHighlights, useTextHighlighter } from '../../lib/use-text-highlighter';
import HeaderActions from './HeaderActions';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { handleCanvasPanelKeyDown } from '../../lib/canvas-shortcuts';
import { getNodeNameSource } from '../../lib/node-display-name';
import { nodeExecutionKind } from '../../lib/node-execution';
import NodeMetadataEditor from '../NodeMetadataEditor';
import ConversationSplit from '../ConversationSplit';
import './FocusPanel.css';
import { activeAgentActivity, originalQuestionBeforeInstructions } from '../../lib/agent-activity';
import { screenToUi, uiViewport } from '../../lib/ui-scale';

// The panel reads one turn. Further questions belong to a
// new linked node, whose own question editor opens before any request runs.

export default function FocusPanel({ nodeId, onFocusNode, snapshotNode }: { nodeId: string; onFocusNode?: (id: string) => void; snapshotNode?: ThoughtNode }) {
  const {
    nodes,
    removeAttachment, toggleExcludeAttachment, setAttachmentRenderMode, getInheritedAttachments,
  } = useStore();
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const preludeRef = useRef<HTMLDivElement>(null);
  const inspectRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(420);
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
    const width = uiViewport().width;
    const maxW = Math.floor(width * 0.7);
    setPanelWidth(Math.min(maxW, Math.max(PANEL_MIN_WIDTH, width - PANEL_INSET - screenToUi(e.clientX))));
  };
  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizing) return;
    setResizing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    appSettings.setItem(PANEL_WIDTH_KEY, String(useUiStore.getState().panelWidth));
  };
  const onResizeDoubleClick = () => {
    setPanelWidth(PANEL_DEFAULT_WIDTH);
    appSettings.removeItem(PANEL_WIDTH_KEY);
  };

  // Close transient editors when switching nodes (adjust-during-render).
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  if (prevNodeId !== nodeId) {
    setPrevNodeId(nodeId);
    setMetadataOpen(false);
  }

  const node = snapshotNode ?? nodes.find((n) => n.id === nodeId);
  const canHighlight = !!node && canHighlightConversation(node.data);
  const highlighter = useTextHighlighter({
    scopeKey: JSON.stringify([nodeId, node?.data.responseIndex, node?.data.question, node?.data.response]),
    enabled: canHighlight,
    surfaceRef: contentRef,
  });
  const { questionHighlights, responseHighlights: highlightedTexts } = useConversationHighlights(node?.data.highlights);
  const nodeExists = !!node;
  useLayoutEffect(() => {
    const content = contentRef.current;
    const prelude = preludeRef.current;
    const inspect = inspectRef.current;
    if (!content || !prelude || !inspect) return;
    const measure = () => {
      const style = getComputedStyle(content);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      // The outer panel never scrolls. Auxiliary sections have their own
      // bounded scrollports; the conversation uses the remaining space.
      setAvailableHeight(Math.max(0, content.clientHeight - padding
        - prelude.offsetHeight - inspect.offsetHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(prelude);
    observer.observe(inspect);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [nodeId, nodeExists]);

  if (!node) {
    return null;
  }

  const data = node.data;
  const hasMultipleVersions = data.responses.length > 1;
  // A draft node uses its own question editor.
  const awaiting = awaitingInput(data);
  const hasAnswer = !!(data.response || data.isLoading || data.isEditingResponse
    || data.generationFailed || activeAgentActivity(data).length);

  return (
    <div
      ref={panelRef} data-type-surface="reading" data-focus-panel data-focus-node-id={nodeId}
      role="complementary" aria-label={t('panel.reading')}
      className={`focus-panel-shell absolute right-canvas-inset top-0 bottom-0 z-20 border rounded-panel overflow-clip flex flex-col ${resizing ? 'select-none' : ''}`}
      style={{ width: panelWidth, maxWidth: 'calc(70 * var(--ui-vw))', minWidth: `min(${PANEL_MIN_WIDTH}px, calc(100 * var(--ui-vw) - ${PANEL_INSET * 2}px))` }}
      onKeyDown={handleCanvasPanelKeyDown}
    >
      {/* Resize handle on the left edge */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onDoubleClick={onResizeDoubleClick}
        data-cursor="resize-column" className={`absolute left-0 top-0 h-full w-[8px] -ml-[3px] z-20 hover:bg-accent/20 transition-colors flex items-center justify-center ${resizing ? 'bg-accent/30' : ''}`}
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
      {/* Only the inner regions scroll; the panel and its layout stay fixed. */}
      <div ref={contentRef} data-conversation-scroll-page
        className={`focus-panel-content min-h-0 nowheel nopan ${hasAnswer ? 'focus-panel-content--split' : ''}`}>
        <div ref={preludeRef} className="focus-panel-prelude">
          <NodeMetadataEditor key={`metadata-${nodeId}`} id={nodeId} data={data}
            name={getNodeNameSource(data, t('ctx.unnamedNode'))}
            preview={data.displaySummary ?? activeSummary(data)} overview={false}
            open={metadataOpen} onOpenChange={setMetadataOpen} variant="panel" />
          {(hasConversationHighlightText(data) || data.highlights.length > 0) && <NodeHighlightsSection key={`h-${nodeId}`}
            nodeId={nodeId} highlights={data.highlights} highlightMode={data.highlightMode}
            highlighter={highlighter} canHighlight={canHighlight} />}
          <AgentSessionLine data={data} />
          <HandoffLine nodeId={nodeId!} data={data} />
        </div>
        <div data-cursor="native" onMouseUp={event => highlighter.markConversationSelection(event, nodeId)}
          className={`focus-panel-conversation${hasAnswer ? '' : ' focus-panel-conversation--unsplit'}`}
          style={hasAnswer ? undefined : { maxHeight: availableHeight }}>
          <ConversationSplit nodeId={nodeId} surface="panel" enabled={hasAnswer} availableHeight={availableHeight}
            question={
              <QuestionSection
                key={`q-${nodeId}`}
                nodeId={nodeId!}
                base={data.agentSession?.cwd ?? data.importSource?.cwd}
                question={data.question}
                attachments={data.attachments}
                highlights={questionHighlights}
                penActive={highlighter.active}
                displayQuestion={originalQuestionBeforeInstructions(data.question, activeAgentActivity(data))}
                isEditing={data.isEditing && data.questionEditor === 'panel'}
                isHuman={data.stepKind === 'human'}
                awaiting={!!awaiting}
                needsAgentModel={!isViewerMode && awaiting === 'ask' && nodeExecutionKind(data) === 'codex'}
                generationFailed={data.generationFailed && !data.isLoading}
                placeholder={awaiting ? (data.instruction || t('node.askPlaceholder')) : undefined}
              />
            }
            answer={
              <ResponseSection
                key={`r-${nodeId}`}
                nodeId={nodeId!}
                data={data}
                hasMultipleVersions={hasMultipleVersions}
                highlightedTexts={highlightedTexts}
                highlighter={highlighter}
                questionHighlights={questionHighlights}
                onFocusNode={onFocusNode}
              />
            }
          />
        </div>
        <div ref={inspectRef} className="focus-panel-inspect">
          <div className="focus-panel-info">
            <NodeInfoLine data={data} />
          </div>
          <AttachmentsSection
            nodeId={nodeId!}
            attachments={data.attachments || []}
            excludedAttachmentIds={data.excludedAttachmentIds || []}
            includedAttachmentIds={data.includedAttachmentIds || []}
            removeAttachment={removeAttachment}
            toggleExcludeAttachment={toggleExcludeAttachment}
            setAttachmentRenderMode={setAttachmentRenderMode}
            getInheritedAttachments={getInheritedAttachments}
          />
          <RecallSection nodeId={nodeId!} items={data.recallItems} meta={data.recallMeta} recallOn={data.recall ?? recallEnabled} progress={data.recallProgress} />
          <RelatedSection key={`rel-${nodeId}`} question={data.question} answer={data.response ?? ''} />
        </div>
      </div>
    </div>
  );
}
