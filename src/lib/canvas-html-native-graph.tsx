import { renderToStaticMarkup } from 'react-dom/server';
import { Position, ReactFlow, ReactFlowProvider, type EdgeProps, type NodeProps } from '@xyflow/react';
import type { ThoughtEdge, ThoughtNode } from '../types';
import ThoughtNodeView from '../components/ThoughtNode';
import ContentNode from '../components/ContentNode';
import ParadigmNode from '../components/ParadigmNode';
import FrameNode from '../components/FrameNode';
import ThoughtEdgeView from '../components/ThoughtEdgeView';
import { currentNativeGraph } from './canvas-html-native-source';
import { clonePassiveElement } from './canvas-html-surface';
import { canvasHtmlAssets } from './canvas-html-assets';
import { isContentKind } from './content';
import { effectiveNodeGeometry } from './node-geometry';
import { resolveEdgeAnchors } from './edge-anchors';
import { createEdgeRoutingContext } from './edge-path';
import { useEdgeRoutingPreferences } from './edge-routing-preferences';
import { useConnectionLayoutPreferences, type ConnectionLayout } from './connection-layout-preferences';
import { CanvasEdgeRouting, CanvasConnectionLayout, StaticEdgeLabels } from './edge-routing-context';
import { isOverviewRulerHandle, overviewRulerMarks } from './overview-ruler';
import { getNodeNameSource } from './node-display-name';
import { activeSummary } from '../utils';
import { t } from '../i18n';

type Assets = ReturnType<typeof canvasHtmlAssets>;
type Kind = 'chat' | 'paradigm';
const nodeLayer = '.react-flow__nodes', edgeLayer = '.react-flow__edges', labelLayer = '.react-flow__edgelabel-renderer';

/** Preserve what the user actually saw. The template is only used for material
 * that has no mounted page renderer (including virtualized offscreen nodes). */
export function fillNativeGraphReading(root: HTMLElement, readings: ReadonlyMap<string, string>) {
  for (const preview of root.querySelectorAll('[data-document-edit-preview]')) preview.remove();
  for (const mark of root.querySelectorAll<HTMLElement>('[data-file-preview-original]')) mark.replaceWith(mark.dataset.filePreviewOriginal ?? '');
  // An open Word reader and its canvas card can share a dirty editing
  // session. Replace only that page viewport with the saved document's pages.
  const dirty = [...root.querySelectorAll<HTMLElement>('[data-superdoc-dirty="true"]')];
  const missingPages = [...root.querySelectorAll<HTMLImageElement>('img[data-export-missing-pdf-page]')];
  if (dirty.length || missingPages.length) {
    const pending = new Set([...dirty.map(editor => editor.dataset.superdocEditor),
      ...missingPages.map(img => img.closest<HTMLElement>('[data-pdf-document]')?.dataset.pdfDocument)]);
    const saved = new Map<string | undefined, Element>();
    for (const html of readings.values()) {
      const template = document.createElement('template');
      template.innerHTML = html;
      for (const file of template.content.querySelectorAll<HTMLElement>('[data-reading-file]')) {
        if (pending.delete(file.dataset.readingFile)) saved.set(file.dataset.readingFile, file);
      }
      if (!pending.size) break;
    }
    for (const editor of dirty) {
      const view = editor.querySelector<HTMLElement>('.docx-view-host');
      if (!view) continue;
      const file = saved.get(editor.dataset.superdocEditor);
      view.replaceChildren(...(file ? [file.cloneNode(true)] : []));
      view.style.overflow = 'auto';
      editor.dataset.superdocDirty = 'false';
    }
    for (const img of missingPages) {
      const id = img.closest<HTMLElement>('[data-pdf-document]')?.dataset.pdfDocument;
      const page = img.closest<HTMLElement>('[data-pdf-page]');
      const number = Number(page?.dataset.page);
      const original = saved.get(id)?.querySelector<HTMLImageElement>(`.pdf-sheet[data-page="${number}"] img`);
      const src = original?.getAttribute('src');
      if (src) img.setAttribute('src', src);
      if (page && original?.width && original.height && !page.hasAttribute('data-pdf-sized')) {
        // A page outside the live reading viewport still has its estimated height.
        page.style.height = `${Math.round(parseFloat(page.style.width) * original.height / original.width)}px`;
        img.style.height = '100%';
      }
    }
  }
  for (const draft of root.querySelectorAll('.pdf-document-mark-draft')) {
    const id = draft.getAttribute('data-pdf-annotation');
    if (id) draft.closest('[data-pdf-document]')?.querySelector('[data-pdf-comment-editor="' + CSS.escape(id) + '"]')?.remove();
    draft.parentElement?.remove();
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-export-node]')) {
    const cards = [...node.querySelectorAll<HTMLElement>('[data-document-card]')].filter(card =>
      !card.querySelector('.superdoc-page, [data-pdf-page] img, [data-pdf-page] canvas, .document-rich-body, [data-reading-file]'));
    const imageSlots = [...node.querySelectorAll<HTMLImageElement>('[data-file-header] + [data-content-body] img')].filter(img =>
      !img.getAttribute('src') || img.getAttribute('src')?.endsWith('base64,'));
    if (!cards.length && !imageSlots.length) continue;
    const html = readings.get(node.dataset.exportNode!);
    if (!html) continue;
    const template = document.createElement('template');
    template.innerHTML = html;
    const files = new Map([...template.content.querySelectorAll<HTMLElement>('[data-reading-file]')].map(el => [el.dataset.readingFile, el]));
    for (const card of cards) {
      const file = files.get(card.dataset.documentCard);
      if (!file) continue;
      const header = card.querySelector(':scope > [data-file-header]');
      const port = card.querySelector<HTMLElement>('[data-document-body], .pdf-page-viewport, .docx-view-host, [data-export-document-body]');
      if (port) {
        port.replaceChildren(file);
        port.style.overflow = 'auto';
        card.querySelector('.docx-load-state')?.remove();
      }
      else {
        const scroll = document.createElement('div');
        scroll.className = 'min-h-0 flex-auto overflow-auto overscroll-contain nowheel nopan';
        scroll.dataset.exportDocumentBody = '';
        scroll.append(file);
        card.replaceChildren(...(header ? [header, scroll] : [scroll]));
      }
    }
    for (const img of imageSlots) {
      const id = img.closest('[data-content-body]')?.previousElementSibling?.getAttribute('data-file-header');
      const src = id && files.get(id)?.querySelector('img')?.getAttribute('src');
      if (src) img.src = src;
    }
  }
}

function markNativeNode(element: HTMLElement, node: ThoughtNode) {
  element.dataset.exportNode = node.id;
  if (node.data.stepKind === 'frame') element.dataset.exportFrame = '';
  const marks = overviewRulerMarks(node.data);
  const indices = new Map(marks.map((mark, index) => [mark.id, index]));
  for (const tick of element.querySelectorAll<HTMLElement>('[data-overview-ruler-mark]')) {
    const index = indices.get(tick.dataset.overviewRulerMark!);
    if (index === undefined) tick.remove();
    else tick.dataset.rulerIndex = String(index);
  }
  for (const button of element.querySelectorAll('button[aria-label]')) {
    if (button.getAttribute('aria-label') === t('reader.open')) button.setAttribute('data-open-export-reader', node.id);
  }
  // While a project is exported, a field can still show a session draft.
  // Keep the same control and fill it with the committed model value.
  const { data } = node;
  const textFields: [string, string | undefined][] = [
    ['[data-node-paradigm] input,[data-frame-title-editor]', data.question],
    ['[data-node-paradigm] textarea', data.instruction],
    ['[data-note-editor] textarea,.node-question-composer textarea,.conversation-question-editor textarea', data.question],
    ['[data-canvas-response-editor]', data.response],
    ['[data-node-title-input]', getNodeNameSource(data, '')],
    ['[data-node-summary-input]', data.displaySummary ?? activeSummary(data) ?? ''],
  ];
  for (const [selector, value] of textFields) {
    for (const field of element.querySelectorAll(selector)) {
      if (field.tagName === 'INPUT') field.setAttribute('value', value ?? '');
      else field.textContent = value ?? '';
    }
  }
  const frameLabel = element.querySelector('[data-frame-label-measure]');
  if (frameLabel && element.querySelector('[data-frame-title-editor]')) frameLabel.textContent = data.question;
  for (const editor of element.querySelectorAll('[data-extraction-editor]')) {
    const attId = editor.parentElement?.querySelector('[data-file-header]')?.getAttribute('data-file-header');
    const textarea = editor.querySelector('textarea');
    if (textarea) textarea.textContent = data.attachments?.find(att => att.id === attId)?.extractedText ?? '';
  }
  for (const editor of element.querySelectorAll<HTMLElement>('[data-pdf-comment-editor]')) {
    const id = editor.closest<HTMLElement>('[data-pdf-document]')?.dataset.pdfDocument;
    const annotation = data.attachments?.find(att => att.id === id)?.pdfAnnotations?.find(mark => mark.id === editor.dataset.pdfCommentEditor);
    const textarea = editor.querySelector('textarea');
    if (textarea && annotation) textarea.textContent = annotation.comment ?? '';
  }
}

function nativeProjection(snapshot: ThoughtNode[], inputEdges: ThoughtEdge[], layout: ConnectionLayout | undefined, flow: ReturnType<typeof currentNativeGraph>) {
  const nodes = snapshot.map(node => {
    const internal = flow?.nodeLookup.get(node.id);
    const size = internal?.measured?.width && internal.measured.height ? internal.measured : effectiveNodeGeometry(node);
    const bounds = internal?.internals.handleBounds;
    const handles: NonNullable<ThoughtNode['handles']> = [...(bounds?.source ?? []), ...(bounds?.target ?? [])];
    return { ...node, initialWidth: size.width, initialHeight: size.height, measured: size, handles };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = inputEdges.flatMap(edge => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target || source.hidden || target.hidden || edge.hidden) return [];
    const anchors = resolveEdgeAnchors(edge, byId, undefined, undefined, layout);
    if (!anchors) return [];
    const { sourceAnchor, targetAnchor, sourceSide, targetSide } = anchors;
    const sourceHandle = isOverviewRulerHandle(edge.sourceHandle) ? anchors.sourceHandle : edge.sourceHandle || anchors.sourceHandle;
    const targetHandle = edge.targetHandle || anchors.targetHandle;
    for (const [node, type, id, point, side] of [[source, 'source', sourceHandle, sourceAnchor, sourceSide],
      [target, 'target', targetHandle, targetAnchor, targetSide]] as const) {
      if (!node.handles.some(handle => handle.type === type && handle.id === id)) {
        node.handles.push({ id, type, position: side as Position, width: 0, height: 0,
          x: point.x - node.position.x, y: point.y - node.position.y });
      }
    }
    return [{ ...flow?.defaultEdgeOptions, ...edge, type: edge.type || 'smoothstep', sourceHandle, targetHandle }];
  });
  return { nodes, edges };
}

/** Only missing node bodies render. React's static renderer never starts an
 * editor, subscribes to a store, changes the camera, or runs component effects. */
function missingNativeElements(nodes: ThoughtNode[], edges: ThoughtEdge[], kind: Kind, zoom: number,
  visibleNodes: Set<string>, visibleEdges: Set<string>, layout: ConnectionLayout | undefined) {
  function NativeNode(props: NodeProps<ThoughtNode>) {
    if (visibleNodes.has(props.id)) return null;
    if (props.data.stepKind === 'frame') return <FrameNode {...props} />;
    if (isContentKind(props.data.stepKind)) return <ContentNode {...props} />;
    return kind === 'paradigm' ? <ParadigmNode {...props} /> : <ThoughtNodeView {...props} />;
  }
  function NativeEdge(props: EdgeProps<ThoughtEdge>) {
    return visibleEdges.has(props.id) ? null : <ThoughtEdgeView {...props} />;
  }
  const routing = createEdgeRoutingContext(nodes, edges, useEdgeRoutingPreferences.getState().settings);
  const html = renderToStaticMarkup(<ReactFlowProvider initialNodes={nodes} initialEdges={edges}
    initialWidth={1000} initialHeight={1000} initialMinZoom={zoom} initialMaxZoom={zoom} fitView>
    <CanvasEdgeRouting.Provider value={routing}><CanvasConnectionLayout.Provider value={layout}><StaticEdgeLabels.Provider value>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ thought: NativeNode }} edgeTypes={{ smoothstep: NativeEdge }}
        elevateNodesOnSelect={false} proOptions={{ hideAttribution: true }} />
    </StaticEdgeLabels.Provider></CanvasConnectionLayout.Provider></CanvasEdgeRouting.Provider>
  </ReactFlowProvider>);
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Freeze mounted objects immediately, then fill the culled region using the
 * same node components, edge component, markers and React Flow wrappers. */
export async function captureNativeGraph(rawNodes: ThoughtNode[], rawEdges: ThoughtEdge[], kind: Kind = 'chat',
  assets: Assets = canvasHtmlAssets(document.documentElement.dataset.theme === 'dark')) {
  const flow = currentNativeGraph();
  const projected = flow && rawNodes.length === flow.nodes.length && rawNodes.every(node => flow.nodeLookup.has(node.id)) ? flow : undefined;
  const view = !flow || projected ? document.querySelector<HTMLElement>('#root .react-flow__viewport') : null;
  const prefs = useConnectionLayoutPreferences.getState().settings;
  const layout = prefs.enabled && kind === 'chat' ? prefs.layout : undefined;
  const { nodes, edges } = nativeProjection(projected?.nodes ?? rawNodes, projected?.edges ?? rawEdges, layout, projected);
  const byId = new Map(nodes.filter(node => !node.hidden).map(node => [node.id, node]));
  const edgeIds = new Set(edges.map(edge => edge.id));
  const visibleNodes = new Set<string>(), visibleEdges = new Set<string>();
  const copy = (el: Element) => clonePassiveElement(el, assets);
  const nodeJobs = [...(view?.querySelectorAll<HTMLElement>(nodeLayer + ' > .react-flow__node[data-id]') ?? [])].flatMap(el => {
    if (!byId.has(el.dataset.id!)) return [];
    visibleNodes.add(el.dataset.id!);
    return [copy(el)];
  });
  const edgeJobs = [...(view?.querySelector(edgeLayer)?.children ?? [])].flatMap(el => {
    const id = el.querySelector('.react-flow__edge[data-id]')?.getAttribute('data-id');
    if (id && !edgeIds.has(id)) return [];
    if (id) visibleEdges.add(id);
    return [copy(el)];
  });
  const labelJobs = [...(view?.querySelector(labelLayer)?.children ?? [])].map(copy);
  if (visibleNodes.size < byId.size || visibleEdges.size < edgeIds.size) {
    const missing = missingNativeElements(nodes, edges, kind, flow?.transform[2] ?? 1, visibleNodes, visibleEdges, layout);
    for (const node of missing.querySelectorAll<HTMLElement>(nodeLayer + ' > .react-flow__node[data-id]')) {
      if (byId.has(node.dataset.id!) && !visibleNodes.has(node.dataset.id!)) nodeJobs.push(copy(node));
    }
    for (const svg of missing.querySelector(edgeLayer)?.children ?? []) {
      const id = svg.querySelector('.react-flow__edge[data-id]')?.getAttribute('data-id');
      if (!id) {
        if (svg.querySelector('marker') && !view?.querySelector(edgeLayer + ' marker')) edgeJobs.push(copy(svg));
        continue;
      }
      if (visibleEdges.has(id)) continue;
      for (const label of svg.querySelectorAll('foreignObject')) {
        for (const el of label.children) labelJobs.push(copy(el));
        label.remove();
      }
      edgeJobs.push(copy(svg));
    }
  }
  const [objects, wires, labels] = await Promise.all([Promise.all(nodeJobs), Promise.all(edgeJobs), Promise.all(labelJobs)]);
  const copies = new Map<string, HTMLElement>();
  for (const object of objects) {
    const id = object?.getAttribute('data-id');
    const node = id && byId.get(id);
    if (object && node) {
      markNativeNode(object as HTMLElement, node);
      copies.set(node.id, object as HTMLElement);
    }
  }
  return {
    mount(root: HTMLElement, readings?: ReadonlyMap<string, string>) {
      const viewport = root.querySelector('.react-flow__viewport');
      const ordered = nodes.flatMap(node => copies.has(node.id) ? [copies.get(node.id)!] : []);
      viewport?.querySelector(nodeLayer)?.replaceChildren(...ordered);
      viewport?.querySelector(edgeLayer)?.replaceChildren(...wires.filter((el): el is Element => !!el));
      viewport?.querySelector(labelLayer)?.replaceChildren(...labels.filter((el): el is Element => !!el));
      if (readings) fillNativeGraphReading(root, readings);
    },
  };
}
