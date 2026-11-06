// Explicit layout application in an isolated browser profile; model/API writes are blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5189';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = process.env.OUTPUT_DIR ?? 'local-tests/elk-layout-ui';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1800, height: 1100 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(18000);
const checks = [], errors = [], blockedWrites = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.routeWebSocket('**', (socket) => socket.close());
await context.route('**/api/**', (route) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  blockedWrites.push(route.request().url());
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  // Delay delivery, not computation: every test still uses the real layout
  // worker, while races remain deterministic on both fast and slow machines.
  window.__holdLayoutReplies = false;
  window.__heldLayoutReplies = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        if (!window.__holdLayoutReplies || !event.data?.result) return;
        event.stopImmediatePropagation();
        window.__heldLayoutReplies.push(() => this.dispatchEvent(new MessageEvent('message', { data: event.data })));
      });
    }
  };
  window.__releaseLayoutReplies = () => {
    window.__holdLayoutReplies = false;
    for (const release of window.__heldLayoutReplies.splice(0)) release();
  };
});
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const graph = () => page.evaluate(() => {
  const state = window.__store.getState();
  return { nodes: state.nodes.map((n) => ({ id: n.id, position: n.position, width: n.width, height: n.height,
    group: n.data.canvasGroupId, kind: n.data.stepKind, direction: n.data.layoutDirection, route: n.data.edgeRouteDefault })),
  edges: state.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data })),
  selected: state.selectedNodeIds, historyIndex: state.historyIndex, historyLength: state.history.length };
});
const normalized = (nodes) => {
  const x = Math.min(...nodes.map((n) => n.position.x)), y = Math.min(...nodes.map((n) => n.position.y));
  return nodes.map((n) => ({ id: n.id, x: n.position.x - x, y: n.position.y - y })).sort((a, b) => a.id.localeCompare(b.id));
};
const assertClear = (nodes) => {
  const cards = nodes.filter((n) => n.kind !== 'frame');
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
      || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y, `${a.id} overlaps ${b.id}`);
  }
};
const assertOrder = ({ nodes, edges }) => {
  const get = (id) => nodes.find((n) => n.id === id);
  for (const edge of edges) {
    const a = get(edge.source), b = get(edge.target);
    assert.ok(b.position.y >= a.position.y + a.height, `${edge.source} -> ${edge.target} points backward`);
  }
};
const contains = (frame, node) => {
  assert.ok(node.position.x >= frame.position.x && node.position.y >= frame.position.y
    && node.position.x + node.width <= frame.position.x + frame.width
    && node.position.y + node.height <= frame.position.y + frame.height, `${frame.id} does not contain ${node.id}`);
};
const fixture = async (framed = false) => {
  await page.evaluate((framed) => {
    window.__canvasEditing.getState().reset();
    localStorage.setItem('thoughtdag.canvasLayout', JSON.stringify({ method: 'chains', direction: 'vertical', density: 'standard', route: 'curve' }));
    const make = (id, x, y, data = {}, width = 420, height = 320) => ({ id, type: 'thought', position: { x, y }, width, height,
      measured: { width, height }, dragHandle: '.drag-handle', data: {
        question: id, displayName: id, response: `Analysis for ${id}. `.repeat(10), responses: [`Analysis for ${id}. `.repeat(10)],
        responseIndex: 0, summaries: [id], isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 100, highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', layoutDirection: 'vertical', edgeRouteDefault: 'curve', ...data } });
    let nodes, edges;
    if (framed) {
      nodes = [make('region', -300, -300, { stepKind: 'frame', displayName: '材料与讨论', frameColor: 'blue' }, 2700, 2500),
        make('file', 1700, 1500, { stepKind: 'note' }), make('a', 700, 800), make('b', 300, 300), make('outside', 4500, 200)];
      edges = [['file', 'a'], ['a', 'b']];
    } else {
      nodes = [make('file', 1600, 1000, { stepKind: 'note' }), make('a', 500, 900, { canvasGroupId: 'g' }),
        make('b', 300, 100, { canvasGroupId: 'g' }), make('branch', 1500, -300), make('branch-next', -100, 600), make('merge', 900, -600)];
      edges = [['file', 'a'], ['a', 'b'], ['a', 'branch', true], ['branch', 'branch-next'], ['b', 'merge'], ['branch-next', 'merge']];
    }
    edges = edges.map(([source, target, branch]) => ({ id: `${source}-${target}`, source, target, type: 'smoothstep',
      sourceHandle: 'continue', targetHandle: 'top', data: branch ? { isBranchFromSelection: true } : {},
      style: { stroke: '#6B5CE7', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6B5CE7', width: 18, height: 18 } }));
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0, selectedNodeIds: [], selectedNodeId: null,
      staleIds: [], staleFps: {}, staleVerdicts: {} });
    window.__ui.setState({ drafts: {} });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setAutoRefreshPaused(true);
  }, framed);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.fitView({ duration: 0, padding: 0.18 }));
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const { nodes, edges } = window.__store.getState();
    window.__store.setState({ history: [{ nodes, edges }], historyIndex: 0 });
    document.activeElement?.blur();
  });
};
const settled = async () => {
  await page.waitForFunction(() => !window.__canvasEditing.getState().layoutBusy);
  await page.waitForTimeout(700);
};
const openSettings = async () => {
  if (await page.locator('[data-canvas-layout-panel]').isVisible()) return;
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-layout-entry]').click();
  await page.locator('[data-canvas-layout-panel]').waitFor();
};
const applyLayout = async () => { await openSettings(); await page.locator('[data-layout-apply]').click(); await settled(); };
const hold = async (selector) => {
  await page.evaluate(() => { window.__holdLayoutReplies = true; });
  if (selector === '[data-layout-apply]') await openSettings();
  await page.locator(selector).click();
  await page.waitForFunction(() => window.__heldLayoutReplies.length > 0);
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutBusy), true);
  assert.equal(await page.locator(selector).isDisabled(), true, 'busy disables repeated layout commands');
};
const release = async () => { await page.evaluate(() => window.__releaseLayoutReplies()); await settled(); };
const renderedGeometry = () => page.evaluate(() => {
    const nodes = window.__store.getState().nodes;
    const rectangles = nodes.map((n) => {
      const box = document.querySelector(`.react-flow__node[data-id="${n.id}"]`).getBoundingClientRect();
      return { id: n.id, frame: n.data.stepKind === 'frame', x: box.x, y: box.y, width: box.width, height: box.height };
    });
    const overlap = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1
      && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
    const nodeOverlaps = [], frameOverlaps = [], headerHits = [];
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      if (!overlap(a, b)) continue;
      if (a.frame && b.frame) frameOverlaps.push([a.id, b.id]);
      if (!a.frame && !b.frame) nodeOverlaps.push([a.id, b.id]);
    }
    for (const frame of rectangles.filter((n) => n.frame)) {
      const box = document.querySelector(`.react-flow__node[data-id="${frame.id}"] [data-frame-header]`).getBoundingClientRect();
      const header = { x: box.x, y: box.y, width: box.width, height: box.height };
      for (const card of rectangles.filter((n) => !n.frame)) if (overlap(header, card)) headerHits.push([frame.id, card.id]);
    }
    const edgeHits = [];
    for (const edge of window.__rf.getEdges()) {
      const path = document.querySelector(`.react-flow__edge[data-id="${edge.id}"] .react-flow__edge-path`);
      if (!path) continue;
      const length = path.getTotalLength(), transform = path.getScreenCTM();
      const hits = new Set();
      for (let i = 3; i < 98; i++) {
        const point = path.getPointAtLength(length * i / 100);
        const p = new DOMPoint(point.x, point.y).matrixTransform(transform);
        for (const card of rectangles) {
          if (card.frame || card.id === edge.source || card.id === edge.target) continue;
          if (p.x > card.x + 2 && p.x < card.x + card.width - 2 && p.y > card.y + 2 && p.y < card.y + card.height - 2) hits.add(card.id);
        }
      }
      if (hits.size) edgeHits.push({ id: edge.id, hits: [...hits] });
    }
    const formatPanel = document.querySelector('[data-selection-toolbar]')?.getBoundingClientRect();
    return { nodeOverlaps, frameOverlaps, headerHits, edgeHits, rectangles, formatPanelLeft: formatPanel?.left };
  });
const assertRenderedGeometry = (geometry) => {
  assert.deepEqual(geometry.nodeOverlaps, [], 'example cards must not overlap');
  assert.deepEqual(geometry.frameOverlaps, [], 'example chapters must not overlap');
  assert.deepEqual(geometry.headerHits, [], 'zoom-compensated region titles must not overlap cards');
  assert.deepEqual(geometry.edgeHits, [], 'example arrows must not cross unrelated cards');
  assert.ok(geometry.rectangles.filter((n) => !n.frame).every((n) => n.x >= 90), 'fitted cards clear the left creation tools and timeline');
  assert.ok(geometry.rectangles.every((n) => n.x + n.width <= geometry.formatPanelLeft - 8), 'fitted graph clears the right format panel');
  assert.ok(geometry.rectangles.every((n) => n.y + n.height <= 1020), 'fitted graph clears the bottom canvas actions');
};
const frameHeaderBounds = () => page.evaluate(() => [...document.querySelectorAll('[data-frame-header]')].map((header) => {
  const title = header.querySelector('span');
  const frame = header.closest('.react-flow__node');
  const bounds = frame.getBoundingClientRect();
  const carry = header.querySelector('[data-frame-carry-toggle]').getBoundingClientRect();
  return { id: frame.dataset.id, titleWidth: title.clientWidth, titleScrollWidth: title.scrollWidth,
    worldWidth: window.__store.getState().nodes.find((node) => node.id === frame.dataset.id)?.width,
    headerScale: header.style.transform, zoom: window.__rf.getZoom(),
    frameLeft: bounds.left, frameRight: bounds.right, carryLeft: carry.left, carryRight: carry.right };
}));
const assertFrameHeaders = (headers) => {
  for (const header of headers) {
    assert.ok(header.titleScrollWidth <= header.titleWidth, `${header.id} title is truncated: ${header.titleScrollWidth} > ${header.titleWidth}`);
    assert.ok(header.carryLeft >= header.frameLeft - 1 && header.carryRight <= header.frameRight + 1, `${header.id} carry control overflows its frame`);
  }
};
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__canvasEditing);
  await fixture();
  await page.keyboard.press('Control+a');
  const selected = (await graph()).selected;
  assert.equal(selected.length, 6, 'Ctrl+A selects all graph cards');
  await applyLayout();
  const first = await graph();
  assert.deepEqual(first.selected.slice().sort(), selected.slice().sort(), 'applying layout must retain the selection');
  assert.equal(await page.locator('[data-canvas-layout-panel]').count(), 0, 'applying layout closes the design panel');
  assertClear(first.nodes); assertOrder(first);
  for (const id of ['a', 'b']) assert.equal(first.nodes.find((n) => n.id === id).group, 'g');
  for (const id of ['a', 'b', 'merge']) assert.equal(first.nodes.find((n) => n.id === id).position.x, first.nodes.find((n) => n.id === 'file').position.x);
  check('Ctrl+A and one click arrange materials and chains while ignoring obsolete group metadata');
  for (let iteration = 0; iteration < 4; iteration++) {
    await page.evaluate((iteration) => {
      window.__store.setState((s) => ({ nodes: s.nodes.map((n, i) => ({ ...n,
        position: { x: ((i * 977 + iteration * 331) % 1900) - 900, y: ((i * 613 + iteration * 719) % 1800) - 800 } })).reverse() }));
    }, iteration);
    await applyLayout();
    const current = await graph();
    assert.deepEqual(normalized(current.nodes), normalized(first.nodes));
    assertClear(current.nodes); assertOrder(current);
  }
  await page.screenshot({ path: `${outputDir}/repeated-layout.png` });
  check('repeated arbitrary dragging restores the same relative graph arrangement');
  const beforeRepeat = await graph();
  await applyLayout();
  const afterRepeat = await graph();
  assert.deepEqual(afterRepeat.nodes, beforeRepeat.nodes);
  assert.equal(afterRepeat.historyLength, beforeRepeat.historyLength, 'a repeated no-op must not add undo history');
  check('an already arranged graph stays still without a duplicate undo step');

  await page.evaluate(() => {
    window.__store.getState().setSelectedNodeIds(['a', 'b']);
    window.__store.setState((s) => ({ nodes: s.nodes.map((n) => ['a', 'b'].includes(n.id)
      ? { ...n, position: { ...n.position, x: n.position.x + 57 } } : n) }));
  });
  const partialBefore = await graph();
  await applyLayout();
  const partialAfter = await graph();
  assert.deepEqual(partialAfter.selected.slice().sort(), ['a', 'b']);
  assert.deepEqual(partialAfter.nodes.filter((n) => !['a', 'b'].includes(n.id)), partialBefore.nodes.filter((n) => !['a', 'b'].includes(n.id)));
  assert.equal(partialAfter.nodes.find((n) => n.id === 'a').position.x, partialAfter.nodes.find((n) => n.id === 'file').position.x);
  check('the menu action keeps a partial selection and leaves outside nodes fixed');

  await page.evaluate(() => {
    window.__store.getState().setSelectedNodeIds(['a']);
    window.__store.setState((s) => ({ nodes: s.nodes.map((n) => n.id === 'a'
      ? { ...n, position: { ...n.position, x: n.position.x + 83 } } : n) }));
    window.__store.getState().pushHistory();
  });
  const memberBefore = await graph();
  await applyLayout();
  const memberAfter = await graph();
  assert.deepEqual(memberAfter.selected, ['a']);
  assert.deepEqual(memberAfter.nodes.filter(n => n.id !== 'a'), memberBefore.nodes.filter(n => n.id !== 'a'));
  assert.equal(memberAfter.nodes.find(n => n.id === 'a').position.x, memberAfter.nodes.find(n => n.id === 'b').position.x);
  assert.equal(memberAfter.nodes.find(n => n.id === 'a').group, 'g');
  assert.equal(memberAfter.historyIndex, memberBefore.historyIndex + 1);
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForTimeout(150);
  assert.deepEqual((await graph()).nodes, memberBefore.nodes);
  check('a node with obsolete group metadata can be laid out and undone without moving another node');

  await fixture(true);
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['region']));
  const frameBefore = await graph();
  await applyLayout();
  const frameAfter = await graph();
  const frame = frameAfter.nodes.find((n) => n.id === 'region');
  for (const id of ['file', 'a', 'b']) contains(frame, frameAfter.nodes.find((n) => n.id === id));
  assert.notEqual(frame.width, frameBefore.nodes.find((n) => n.id === 'region').width);
  assert.equal(frame.width, 484, 'region width follows the 420px card plus two 32px insets');
  assert.equal(frame.height, 1232, 'region height follows the three cards, chain gaps and header inset');
  assert.deepEqual(frameAfter.nodes.find((n) => n.id === 'outside'), frameBefore.nodes.find((n) => n.id === 'outside'));
  assertClear(frameAfter.nodes); assertOrder(frameAfter);
  await page.screenshot({ path: `${outputDir}/frame-fitted.png` });
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForTimeout(300);
  assert.deepEqual((await graph()).nodes, frameBefore.nodes, 'one undo restores cards and the region together');
  check('selecting only a region arranges its contents, fits its bounds and undoes as one step');

  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['region']));
  const previewBefore = await graph();
  const frameDimensionsBefore = await page.evaluate(() => {
    const n = window.__store.getState().nodes.find((n) => n.id === 'region');
    return { width: n.width, height: n.height, measured: n.measured };
  });
  await openSettings();
  assert.equal(await page.locator('[data-layout-scope]').locator('input:checked').inputValue(), 'selection');
  await page.locator('[data-layout-preview]').click();
  await settled();
  assert.deepEqual(await graph(), previewBefore, 'preview does not commit geometry or history');
  assert.deepEqual(await page.evaluate(() => {
    const n = window.__store.getState().nodes.find((n) => n.id === 'region');
    return { width: n.width, height: n.height, measured: n.measured };
  }), frameDimensionsBefore, 'preview measurement does not leak into the stored frame');
  const preview = await page.evaluate(() => ({ draft: window.__canvasEditing.getState().layoutPreview.find((n) => n.id === 'region'),
    visible: window.__rf.getNode('region') }));
  assert.equal(preview.visible.width, preview.draft.width, 'preview renders the fitted region width');
  assert.equal(preview.visible.height, preview.draft.height, 'preview renders the fitted region height');
  const visibleBounds = await page.locator('.react-flow__node[data-id="region"]').boundingBox();
  const zoom = await page.evaluate(() => window.__rf.getViewport().zoom);
  assert.ok(Math.abs(visibleBounds.width / zoom - preview.draft.width) < 1, 'DOM frame width matches the plan');
  assert.ok(Math.abs(visibleBounds.height / zoom - preview.draft.height) < 1, 'DOM frame height matches the plan');
  await page.locator('[data-layout-cancel]').click();
  await page.waitForTimeout(300);
  assert.deepEqual(await graph(), previewBefore);
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutPreview), null);
  check('region preview renders fitted bounds and cancel leaves graph and history unchanged');
  await openSettings();
  await page.locator('[data-layout-preview]').click();
  await settled();
  const applyPlan = await page.evaluate(() => window.__canvasEditing.getState().layoutPreview.map((n) => ({
    id: n.id, position: n.position, width: n.width, height: n.height,
  })));
  await page.locator('[data-layout-apply]').click();
  await settled();
  const applied = await graph();
  assert.deepEqual(applied.nodes.map(({ id, position, width, height }) => ({ id, position, width, height })), applyPlan);
  check('applying the region preview commits exactly the displayed geometry');

  const longTitle = '这是一个非常长的分区标题，用于验证标题长度不会撑大分区框而是适应现有内容宽度';
  await page.evaluate((title) => window.__store.getState().setFrameProperties(['region'], { title }), longTitle);
  const beforeLongTitle = await graph();
  await applyLayout();
  const afterLongTitle = await graph();
  assert.deepEqual(afterLongTitle.nodes, beforeLongTitle.nodes, 'renaming a region must not change its layout footprint');
  const longHeader = await page.locator('.react-flow__node[data-id="region"] [data-frame-header]').evaluate((header) => {
    const title = header.querySelector('span');
    const frame = header.closest('.react-flow__node').getBoundingClientRect();
    const toggle = header.querySelector('[data-frame-carry-toggle]').getBoundingClientRect();
    return { tooltip: title.dataset.tooltip, truncated: title.scrollWidth > title.clientWidth, left: toggle.left, right: toggle.right,
      frameLeft: frame.left, frameRight: frame.right };
  });
  assert.equal(longHeader.tooltip, longTitle, 'the complete long title remains available');
  assert.equal(longHeader.truncated, true, 'extreme titles use ellipsis inside the content-sized frame');
  assert.ok(longHeader.left >= longHeader.frameLeft && longHeader.right <= longHeader.frameRight);
  check('large frames tighten to content and long titles never inflate their dimensions');

  await page.evaluate(() => {
    const state = window.__store.getState();
    const template = state.nodes.find(node => node.id === 'a');
    const make = (id, x, y, width, height, frame = false) => ({ ...template, id, position: { x, y }, width, height,
      measured: { width, height }, data: { ...template.data, question: id, stepKind: frame ? 'frame' : undefined } });
    const nodes = [make('outer', 0, 0, 3000, 2200, true), make('inner', 600, 400, 1200, 1300, true), make('card', 800, 700, 420, 320)];
    window.__canvasEditing.getState().reset();
    window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0,
      selectedNodeIds: [], selectedNodeId: null });
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['outer', 'inner']));
  await page.evaluate(() => window.__rf.fitView({ duration: 0, padding: 0.2 }));
  const nestedBefore = await graph();
  await page.locator('[data-frame-fit]').click();
  await page.waitForTimeout(450);
  const nestedAfter = await graph();
  const inner = nestedAfter.nodes.find(n => n.id === 'inner'), outer = nestedAfter.nodes.find(n => n.id === 'outer');
  assert.deepEqual([inner.width, inner.height, outer.width, outer.height], [484, 432, 548, 544]);
  contains(outer, inner); contains(inner, nestedAfter.nodes.find(n => n.id === 'card'));
  assert.deepEqual(nestedAfter.nodes.find(n => n.id === 'card'), nestedBefore.nodes.find(n => n.id === 'card'));
  assert.equal(nestedAfter.historyIndex, nestedBefore.historyIndex + 1);
  await page.locator('[data-frame-fit]').click();
  await page.waitForTimeout(150);
  assert.deepEqual(await graph(), nestedAfter, 'repeated fitting is a no-op including history');
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForTimeout(150);
  assert.deepEqual((await graph()).nodes, nestedBefore.nodes);
  check('one content-fit action tightens inner and outer frames without moving cards and undoes once');

  await fixture();
  await page.keyboard.press('Control+a');
  const cancelledBefore = await graph();
  await openSettings();
  await hold('[data-layout-preview]');
  await page.keyboard.press('Escape');
  await page.locator('[data-canvas-layout-panel]').waitFor({ state: 'detached' });
  await release();
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutPreview), null);
  assert.deepEqual(await graph(), cancelledBefore, 'late preview cannot reappear or commit after Escape');
  check('Escape cancels an in-flight worker preview without late geometry or history writes');

  await openSettings();
  await hold('[data-layout-preview]');
  await page.locator('[data-layout-scope]').locator('label:has(input[value="all"])').click();
  await release();
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutPreview), null);
  assert.deepEqual(await graph(), cancelledBefore, 'old selection preview must not be installed for the new scope');
  await page.locator('[data-layout-cancel]').click();
  check('changing scope discards the pending preview');

  await hold('[data-layout-apply]');
  await page.evaluate(() => {
    window.__store.setState((s) => ({ nodes: s.nodes.map((n) => n.id === 'file'
      ? { ...n, position: { x: n.position.x + 173, y: n.position.y + 89 } } : n) }));
  });
  const draggedWhilePending = await graph();
  await release();
  assert.deepEqual(await graph(), draggedWhilePending, 'late layout must not replace a new dragged position');
  check('moving a node while the worker computes rejects stale layout without an undo step');

  await page.evaluate(() => {
    window.__store.getState().pushHistory();
    window.__store.setState((s) => ({ nodes: s.nodes.map((n) => n.id === 'file'
      ? { ...n, position: { x: n.position.x - 200, y: n.position.y + 400 } } : n) }));
    window.__store.getState().pushHistory();
  });
  await hold('[data-layout-apply]');
  await page.evaluate(() => window.__store.getState().undo());
  const undoneWhilePending = await graph();
  await release();
  assert.deepEqual(await graph(), undoneWhilePending, 'late layout must not undo the user undo');
  check('undo during computation invalidates the pending layout');

  await openSettings();
  await hold('[data-layout-apply]');
  await page.locator('[data-layout-direction]').locator('label:has(input[value="horizontal"])').click();
  await release();
  assert.deepEqual(await graph(), undoneWhilePending, 'changing settings cancels an in-flight apply');
  await page.locator('[data-layout-cancel]').click();
  check('editing options cancels in-flight application and retains the existing graph');

  const direct = await page.evaluate(async () => {
    const state = window.__store.getState();
    const pending = state.applyCanvasLayout({ method: 'chains', direction: 'vertical', density: 'standard', route: 'curve' }, state.selectedNodeIds);
    window.__store.setState((s) => ({ nodes: s.nodes.map((n) => n.id === 'file'
      ? { ...n, position: { x: n.position.x + 31, y: n.position.y + 17 } } : n) }));
    const expected = window.__store.getState().nodes.map((n) => ({ id: n.id, position: n.position }));
    const result = await pending;
    return { result, expected, actual: window.__store.getState().nodes.map((n) => ({ id: n.id, position: n.position })) };
  });
  assert.deepEqual(direct.result, { ok: false, error: 'stale-layout' });
  assert.deepEqual(direct.actual, direct.expected);
  check('direct store requests preserve the click-time snapshot across lazy imports');

  await page.evaluate(async () => {
    const { buildExampleGraph } = await import('/src/lib/example-graph.ts');
    const { nodes, edges } = buildExampleGraph('zh');
    window.__canvasEditing.getState().reset();
    localStorage.setItem('thoughtdag.canvasLayout', JSON.stringify({ method: 'chains', direction: 'vertical', density: 'standard', route: 'curve' }));
    window.__ui.getState().setCanvasDetail('full');
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0, selectedNodeIds: [], selectedNodeId: null,
      staleIds: [], staleFps: {}, staleVerdicts: {} });
    document.activeElement?.blur();
  });
  await page.waitForFunction(() => window.__store.getState().nodes.every((n) => n.measured?.width > 0 && n.measured?.height > 0));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__rf.fitView({ duration: 0, padding: 0.14 }));
  await page.keyboard.press('Control+a');
  assert.equal((await graph()).selected.length, (await graph()).nodes.length);
  await applyLayout();
  await page.waitForTimeout(650);
  const exampleFirst = await graph();
  const exampleGeometry = await renderedGeometry();
  await writeFile(`${outputDir}/example-geometry.json`, JSON.stringify(exampleGeometry, null, 2));
  await page.screenshot({ path: `${outputDir}/example-layout.png` });
  assertRenderedGeometry(exampleGeometry);
  const verticalHeaders = await frameHeaderBounds();
  await writeFile(`${outputDir}/frame-headers-vertical.json`, JSON.stringify(verticalHeaders, null, 2));
  assertFrameHeaders(verticalHeaders);
  await applyLayout();
  await page.waitForTimeout(650);
  const exampleAgain = await graph();
  assert.deepEqual(exampleAgain.nodes, exampleFirst.nodes, 'example layout must stay stable after measured DOM refresh');
  assert.equal(exampleAgain.historyLength, exampleFirst.historyLength, 'repeat example layout must not add history');
  check('the real example canvas keeps chapters clear and repeated layout stable after DOM measurement');
  await page.evaluate(() => { window.__store.getState().setSelectedNodeIds([]); window.__store.getState().setSelectedNodeId(null); });
  await page.mouse.move(1700, 800);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDir}/example-deselected.png` });

  await page.keyboard.press('Control+a');
  await openSettings();
  await page.locator('[data-layout-direction]').locator('label:has(input[value="horizontal"])').click();
  await page.locator('[data-layout-apply]').click();
  await settled();
  const horizontalGeometry = await renderedGeometry();
  await writeFile(`${outputDir}/example-horizontal-geometry.json`, JSON.stringify(horizontalGeometry, null, 2));
  assertRenderedGeometry(horizontalGeometry);
  const horizontalHeaders = await frameHeaderBounds();
  await writeFile(`${outputDir}/frame-headers-horizontal.json`, JSON.stringify(horizontalHeaders, null, 2));
  assertFrameHeaders(horizontalHeaders);
  await writeFile(`${outputDir}/frame-headers.json`, JSON.stringify({ vertical: verticalHeaders, horizontal: horizontalHeaders }, null, 2));
  await page.evaluate(() => { window.__store.getState().setSelectedNodeIds([]); window.__store.getState().setSelectedNodeId(null); });
  await page.mouse.move(1700, 800);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDir}/example-horizontal-deselected.png` });
  check('both orientations show complete region titles and contain their carry controls');

  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  assert.deepEqual(blockedWrites, [], 'layout must not issue model/API writes');
  await writeFile(`${outputDir}/report.json`, JSON.stringify({ checks, errors, blockedWrites }, null, 2));
  console.log(`\n${checks.length} layout application UI checks passed`);
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` });
  await writeFile(`${outputDir}/report.json`, JSON.stringify({ checks, errors, blockedWrites, failure: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
