import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanvasExportReader } from '../components/MaterialReader';
import FocusPanel from '../components/focus-panel';
import { FrameNavigationMenu } from '../components/FrameNode';
import { useI18n } from '../i18n';
import type { ThoughtEdge, ThoughtNode } from '../types';
import { canvasHtmlAssets, mathStyles } from './canvas-html-assets';
import { escapeHtml, renderNodeReadingHtml } from './canvas-html-content';
import { captureNativeGraph } from './canvas-html-native-graph';
import { captureCanvasSurface, clonePassiveElement } from './canvas-html-surface';
import { applyReadonlyCanvas } from './canvas-html-readonly';
import { DOCK_MIN_WINDOW, READER_MIN_WIDTH, readerDockGeometry } from './reader-dock';
import { uiViewport } from './ui-scale';
import { useUiStore } from './ui-store';
import { isContentKind } from './content';
import { isFrameNode } from './frames';
import { overviewRulerMarks } from './overview-ruler';
import readerStyles from './canvas-html-viewer.css?raw';
import offlineTypography from '../design-system/typography-offline.css?raw';
import cursorStyles from '../../runtime/design-system/cursors.css?raw';
import navigation from './canvas-html-viewer.js?raw';

/** Freeze the actual application at export time. The file carries its DOM and
 * styles, plus navigation code. Application event handlers never enter the file. */
export async function buildCanvasHtml(name: string, nodes: ThoughtNode[], edges: ThoughtEdge[], kind: 'chat' | 'paradigm' = 'chat'): Promise<string> {
  const lang = useI18n.getState().lang === 'zh' ? 'zh-CN' : 'en';
  const assets = canvasHtmlAssets(document.documentElement.dataset.theme === 'dark');
  const { readerMode, readerWidth, readerNodeId, panelWidth, wheelPans } = useUiStore.getState();
  const width = uiViewport().width;
  const dock = readerDockGeometry(Math.max(DOCK_MIN_WINDOW, width), true, readerWidth, document.querySelector('[data-focus-panel]') ? panelWidth : 0);
  const overlay = readerDockGeometry(width, false, readerWidth, 0);
  const [surface, graph] = await Promise.all([captureCanvasSurface(assets), captureNativeGraph(nodes, edges, kind, assets)]);
  if (!surface) throw new Error('The canvas is not mounted');
  const flow = surface.root.querySelector<HTMLElement>('.react-flow')!;
  flow.dataset.exportCamera = JSON.stringify(surface.camera);
  flow.dataset.readerMode = readerMode;
  if (wheelPans) flow.dataset.wheelPans = '';
  if (readerNodeId) flow.dataset.openReader = readerNodeId;
  flow.dataset.dockMinWidth = String(DOCK_MIN_WINDOW);
  const readers: string[] = [];
  const readings = new Map<string, string>();
  for (const node of nodes) {
    if (node.hidden || isFrameNode(node)) continue;
    const text = await renderNodeReadingHtml(node, kind === 'paradigm' && !isContentKind(node.data.stepKind), assets);
    readings.set(node.id, text);
    const markup = renderToStaticMarkup(createElement(CanvasExportReader, { node, body: text, dock: overlay }));
    const markIds = overviewRulerMarks(node.data).map(mark => mark.id);
    readers.push(`<template data-reading-node="${escapeHtml(node.id)}" data-mark-ids="${escapeHtml(JSON.stringify(markIds))}">${markup}</template>`);
    const dockMarkup = renderToStaticMarkup(createElement(CanvasExportReader, { node, body: '', dock: { ...dock, collapsed: false, width: Math.max(READER_MIN_WIDTH, dock.width) } }));
    readers.push(`<template data-reading-dock="${escapeHtml(node.id)}">${dockMarkup}</template>`);
    if (kind === 'chat' && !isContentKind(node.data.stepKind)) {
      const holder = document.createElement('template');
      holder.innerHTML = renderToStaticMarkup(createElement(FocusPanel, { nodeId: node.id, snapshotNode: node }));
      const panel = holder.content.querySelector('[data-focus-panel]');
      const copy = panel && await clonePassiveElement(panel, assets);
      if (copy) readers.push(`<template data-reading-details="${escapeHtml(node.id)}">${copy.outerHTML}</template>`);
    }
  }
  graph.mount(surface.root, readings);
  const frames = nodes.filter(node => !node.hidden && isFrameNode(node));
  if (frames.length) readers.push(`<template data-offline-frame-menu>${renderToStaticMarkup(createElement(FrameNavigationMenu, { frames }))}</template>`);
  const windows = document.createElement('template');
  windows.innerHTML = readers.join('');
  applyReadonlyCanvas(windows.content);
  applyReadonlyCanvas(surface.root);
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html data-type-surface="offline-viewer" lang="${lang}" ${surface.htmlAttributes.replace(/\b(?:lang|data-type-surface)="[^"]*"/g, '')}><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escapeHtml(name)}</title><style>${surface.css}
${assets.hasMath ? mathStyles : ''}
${readerStyles}
${offlineTypography}
${cursorStyles}</style></head>
<body ${surface.bodyAttributes}>${surface.root.outerHTML}${windows.innerHTML}<script nonce="${nonce}">${navigation}</script></body></html>`;
}
