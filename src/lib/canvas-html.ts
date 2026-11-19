import type { Position } from '@xyflow/react';
import type { Root } from 'hast';
import { t, useI18n } from '../i18n';
import type { ThoughtEdge, ThoughtNode } from '../types';
import { activeSummary } from '../utils';
import { useAppearance } from './appearance';
import { canvasReadingStyles, escapeHtml, renderNodeReadingHtml } from './canvas-html-content';
import viewerCss from './canvas-html-viewer.css?raw';
import viewerScript from './canvas-html-viewer.js?raw';
import { resolveEdgeAnchors } from './edge-anchors';
import { createEdgeRoutingContext, routeEdge } from './edge-path';
import { useEdgeRoutingPreferences } from './edge-routing-preferences';
import { isFrameNode, nodesRect } from './frames';
import { getNodeNameSource } from './node-display-name';
import { effectiveNodeGeometry } from './node-geometry';
import { nodeLayerIndices } from './node-layer';
import { rehypeUserHighlights } from './rehype-user-highlights';

// Carry the actual canvas theme into the file without copying the application
// stylesheet (which also contains font URLs, toolbars and editor styles).
function themeStyles(): string {
  const computed = getComputedStyle(document.documentElement);
  const tokens = [
    '--font-sans', '--font-mono', '--color-ink', '--color-ink-muted', '--color-surface',
    '--color-card', '--color-wash', '--color-line', '--color-accent', '--color-accent-strong',
    '--color-material-note', '--color-material-note-line', '--color-material-file-line',
    '--conversation-user-bg', '--conversation-user-ink', '--color-amber-100', '--color-amber-800',
    '--radius-control', '--radius-node', '--radius-panel', '--radius-toolbar',
  ];
  return tokens.map(key => {
    const value = computed.getPropertyValue(key).trim();
    return value && !/[<>{};]/.test(value) ? `${key}:${value};` : '';
  }).join('');
}

const controlIcons = {
  minus: 'M5 12h14',
  plus: 'M5 12h14 M12 5v14',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3',
  close: 'm18 6-12 12M6 6l12 12',
  open: 'M9 18l6-6-6-6',
};

function icon(name: keyof typeof controlIcons): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${controlIcons[name]}"/></svg>`;
}

function control(id: string, label: string, symbol: keyof typeof controlIcons): string {
  return `<button type="button" id="${id}" class="control" aria-label="${escapeHtml(label)}">${icon(symbol)}</button>`;
}

function previewText(value: string | undefined): string {
  return (value ?? '').slice(0, 1100)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*[-*+] \[([ xX])\] /gm, (_, checked: string) => checked === ' ' ? '☐ ' : '☑ ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\*\*|__|```|`/g, '').trim();
}

function markedPreview(text: string, node: ThoughtNode): string {
  const marks = node.data.highlights ?? [];
  if (!marks.length) return escapeHtml(text);
  const tree: Root = { type: 'root', children: [{ type: 'text', value: text }] };
  rehypeUserHighlights(marks.map(mark => mark.text))(tree);
  return tree.children.map(part => {
    if (part.type === 'text') return escapeHtml(part.value);
    const marked = part.type === 'element' && part.children[0];
    return marked && marked.type === 'text' ? `<mark>${escapeHtml(marked.value)}</mark>` : '';
  }).join('');
}

function card(node: ThoughtNode, title: string, index: number, style: string, isParadigmStep: boolean): string {
  const { data } = node;
  const kind = data.stepKind;
  const material = kind === 'file' || kind === 'link' || kind === 'note';
  let kindLabel = '', variant = '', source = data.response || data.instruction;
  if (material) {
    variant = kind;
    kindLabel = t(`glyph.${kind}`);
    source = kind === 'file' ? data.attachments?.map(file => file.name).join('\n') : data.question;
  } else if (isParadigmStep || kind === 'prompt' || kind === 'human') {
    kindLabel = t(kind === 'human' ? 'paradigm.kind.human' : 'paradigm.kind.prompt');
    if (isParadigmStep) { variant = 'paradigm'; source = data.instruction; }
  }
  const identity = [data.nodeNumber && Number.isSafeInteger(data.nodeNumber) ? `#${data.nodeNumber}` : '', kindLabel]
    .filter(Boolean).join(' · ');
  const summary = data.displaySummary ?? activeSummary(data);
  const question = previewText(data.question);
  const body = previewText(source);
  const questionVisible = !isParadigmStep && !material && question && question !== title;
  return `<button type="button" class="canvas-node ${variant}" style="${style}" data-reader="reading-${index}" aria-label="${escapeHtml(title)}" aria-controls="reader" aria-expanded="false">
    <span class="card-heading"><span class="card-title">${escapeHtml(title)}</span>${icon('open')}</span>
    ${identity ? `<span class="card-identity">${escapeHtml(identity)}</span>` : ''}
    ${summary ? `<span class="card-summary">${escapeHtml(previewText(summary))}</span>` : ''}
    ${questionVisible ? `<span class="card-question">${escapeHtml(question)}</span>` : ''}
    ${body && body !== title ? `<span class="card-preview">${markedPreview(body, node)}</span>` : ''}
  </button>`;
}

function wires(nodes: ThoughtNode[], edges: ThoughtEdge[]): string {
  const lookup = new Map(nodes.map(node => [node.id, node]));
  const routes = edges.flatMap(edge => {
    const anchors = resolveEdgeAnchors(edge, lookup);
    return anchors ? [{ edge: { ...edge, sourceHandle: anchors.sourceHandle, targetHandle: anchors.targetHandle }, anchors }] : [];
  });
  const context = createEdgeRoutingContext(nodes, routes.map(r => r.edge), useEdgeRoutingPreferences.getState().settings);
  const arrow = '<marker id="direction" viewBox="-13 -8 15 16" refX="1" refY="0" markerWidth="15" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L -11 -5 L -11 5 Z" fill="var(--color-accent)"/></marker>';
  const paths: string[] = [], labels: string[] = [];
  for (const { edge, anchors } of routes) {
    const { sourceAnchor: a, targetAnchor: b, sourceSide, targetSide } = anchors;
    const route = edge.data?.route ?? lookup.get(edge.source)?.data.edgeRouteDefault;
    const { path, labelX, labelY } = routeEdge(a.x, a.y, sourceSide as Position, b.x, b.y, targetSide as Position,
      edge.source, edge.target, nodes, route, { context, edgeId: edge.id });
    paths.push(`<path class="canvas-edge" d="${path}" marker-end="url(#direction)"${edge.data?.isCrossLink ? ' stroke-dasharray="8 4"' : ''}/>`);
    if (edge.data?.label?.trim()) {
      labels.push(`<span class="edge-label" style="left:${labelX}px;top:${labelY}px">${escapeHtml(edge.data.label)}</span>`);
    }
  }
  return `<svg class="wires" aria-hidden="true"><defs>${arrow}</defs>${paths.join('')}</svg>${labels.join('')}`;
}

/** A standalone document with pre-rendered content. Only the viewport and
 * the active reading pane have client-side state. No graph store is shipped. */
export async function buildCanvasHtml(name: string, rawNodes: ThoughtNode[], edges: ThoughtEdge[], kind: 'chat' | 'paradigm' = 'chat'): Promise<string> {
  const nodes = rawNodes.map(node => ({
    ...node, measured: effectiveNodeGeometry(node),
    position: { x: Number.isFinite(node.position.x) ? node.position.x : 0, y: Number.isFinite(node.position.y) ? node.position.y : 0 },
  }));
  const bounds = nodesRect(nodes) ?? { x: 0, y: 0, width: 1, height: 1 };
  const layers = nodeLayerIndices(nodes);
  const objects: string[] = [], templates: string[] = [];
  for (const [index, node] of nodes.entries()) {
    const style = `left:${node.position.x}px;top:${node.position.y}px;width:${node.measured.width}px;height:${node.measured.height}px;z-index:${layers.get(node.id)}`;
    if (isFrameNode(node)) {
      const tone = node.data.frameColor ?? 'gray';
      const color = ['violet', 'amber', 'green', 'sky', 'rose'].includes(tone) ? tone : 'gray';
      objects.push(`<div class="canvas-frame ${color}" style="${style}"><span>${escapeHtml(node.data.question || t('frame.untitled'))}</span></div>`);
    } else {
      const isParadigmStep = kind === 'paradigm' && !['file', 'note', 'link'].includes(node.data.stepKind ?? '');
      const title = isParadigmStep ? node.data.question || t('ctx.unnamedNode') : getNodeNameSource(node.data, t('ctx.unnamedNode'));
      objects.push(card(node, title, index, style, isParadigmStep));
      templates.push(`<template id="reading-${index}">${await renderNodeReadingHtml(node, isParadigmStep)}</template>`);
    }
  }
  const language = useI18n.getState().lang === 'zh' ? 'zh-CN' : 'en';
  const { paper, resolved } = useAppearance.getState();
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(name)}</title><style>${viewerCss}\n:root{color-scheme:${resolved};${themeStyles()}}\n${canvasReadingStyles}</style></head>
<body><main id="canvas" aria-labelledby="canvas-title">
<header class="project-name"><h1 id="canvas-title">${escapeHtml(name)}</h1></header>
<div id="viewport" tabindex="0" aria-labelledby="canvas-title" class="${paper === 'grid' ? 'grid' : ''}">
  <div id="world" data-x="${bounds.x}" data-y="${bounds.y}" data-width="${bounds.width}" data-height="${bounds.height}">${wires(nodes, edges)}${objects.join('')}</div>
  ${nodes.length ? '' : `<p class="empty">${escapeHtml(t('reader.empty'))}</p>`}
</div>
<div class="canvas-controls">${control('zoom-out', t('canvas.zoomOut'), 'minus')}<output id="zoom-value"></output>${control('zoom-in', t('canvas.zoomIn'), 'plus')}${control('fit-view', t('canvas.fitView'), 'fit')}</div>
</main><aside id="reader" aria-labelledby="reader-title" hidden>
<header><h2 id="reader-title"></h2>${control('close-reader', t('panel.close'), 'close')}</header>
<div class="reading-content" tabindex="0"></div></aside>
${templates.join('')}<script nonce="${nonce}">${viewerScript}</script></body></html>`;
}
