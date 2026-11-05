// Canvas editing integration in isolated storage, with all model/API writes blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5176';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/canvas-connections';
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
});
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const near = (a, b, name, tolerance = 1.5) => assert.ok(Math.abs(a - b) <= tolerance, `${name}: ${a} != ${b}`);
const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const storedGraph = () => page.evaluate(() => {
  const state = window.__store.getState();
  return {
    nodes: state.nodes.map((n) => ({ id: n.id, position: n.position, direction: n.data.layoutDirection, route: n.data.edgeRouteDefault })),
    edges: state.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data })),
    historyIndex: state.historyIndex, historyLength: state.history.length,
  };
});
const fixture = async (mode = 'horizontal') => {
  await page.evaluate((mode) => {
    window.__canvasEditing.getState().reset();
    const make = (id, x, y, width, height, name) => ({ id, type: 'thought', position: { x, y }, width, height,
      measured: { width, height }, dragHandle: '.drag-handle',
      data: { question: `${name} QUESTION_${id}`, displayName: name, response: `RESPONSE_${id} 节点分析。`.repeat(10),
        responses: [`RESPONSE_${id} 节点分析。`.repeat(10)], responseIndex: 0, summaries: [name],
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 100,
        highlights: [], highlightMode: 'tag', attachments: id !== 'c' ? [{ id: `att-${id}`, name: `材料-${id}.txt`, type: 'text/plain', content: `ATTACHMENT_${id}_SENTINEL` }] : [],
        excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: id === 'a', isBranch: false,
        layoutDirection: mode === 'vertical' ? 'vertical' : 'horizontal', edgeRouteDefault: 'auto' } });
    const nodes = [make('a', 60, 140, 420, 320, '来源 A'), make('b', 620, 140, 480, 500, '分析 B'), make('c', 1280, 140, 420, 380, '目标 C')];
    if (mode === 'vertical') nodes.forEach((n, i) => { n.position = { x: 300, y: [100, 600, 1300][i] }; });
    if (mode === 'mixed') {
      nodes[2].position = { x: 620, y: 840 };
      nodes[1].data.layoutDirection = 'vertical'; nodes[2].data.layoutDirection = 'vertical';
    }
    const edges = [
      { id: 'edge-a-b', source: 'a', target: 'b', type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', data: {} },
      { id: 'edge-b-c', source: 'b', target: 'c', type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', data: {} },
    ].map((e) => ({ ...e, style: { stroke: '#6B5CE7', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6B5CE7', width: 18, height: 18 } }));
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0, selectedNodeIds: [], selectedNodeId: null,
      staleIds: [], staleFps: {}, staleVerdicts: {} });
    const ui = window.__ui.getState();
    window.__ui.setState({ drafts: {} });
    ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setAutoRefreshPaused(true);
  }, mode);
  await page.waitForTimeout(650);
  if (mode === 'horizontal') await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 20, zoom: 1 }, { duration: 0 }));
  else await page.evaluate(() => window.__rf.fitView({ duration: 0, padding: 0.18 }));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const { nodes, edges } = window.__store.getState();
    window.__store.setState({ history: [{ nodes, edges }], historyIndex: 0 });
  });
};
const geometry = () => page.evaluate(() => window.__rf.getEdges().map((e) => {
  const path = document.querySelector(`.react-flow__edge[data-id="${e.id}"] .react-flow__edge-path`);
  if (!path) return { id: e.id, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, absent: true };
  const length = path.getTotalLength(), matrix = path.getScreenCTM();
  const point = (fraction) => {
    const p = path.getPointAtLength(length * fraction);
    const screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  };
  const cards = [...document.querySelectorAll('.react-flow__node')].map((node) => ({ id: node.dataset.id, rect: node.getBoundingClientRect() }));
  const samples = Array.from({ length: 301 }, (_, i) => point(i / 300));
  const hits = cards.filter(({ rect }) => samples.slice(2, -2).some((p) => p.x > rect.left + 2 && p.x < rect.right - 2
    && p.y > rect.top + 2 && p.y < rect.bottom - 2)).map((node) => node.id);
  return { id: e.id, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, d: path.getAttribute('d'),
    start: point(0), end: point(1), click: point(0.32), samples, length, hits };
}));
const openEdge = async (id, throughCanvas = true) => {
  if (throughCanvas) {
    const item = (await geometry()).find((e) => e.id === id);
    assert.ok(item?.click, `${id} must be rendered`);
    await page.mouse.click(item.click.x, item.click.y);
  } else await page.evaluate((id) => window.__canvasEditing.getState().setEdgeId(id), id);
  await page.locator('[data-edge-inspector]').waitFor();
};
const openLayout = async () => {
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-layout-entry]').click();
  await page.locator('[data-canvas-layout-panel]').waitFor();
};
const undo = async () => {
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForTimeout(350);
};
const chooseRoute = (value) => page.locator(`[data-edge-inspector] [data-edge-route="${value}"]`).click();
const assertNaturalS = (edge) => {
  const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y;
  const span = Math.hypot(dx, dy);
  const offsets = edge.samples.map((p) => ((p.x - edge.start.x) * dy - (p.y - edge.start.y) * dx) / span);
  assert.ok(Math.max(...offsets) > span * 0.025 && Math.min(...offsets) < -span * 0.025,
    `${edge.id} should curve on both sides of its chord across the full span`);
  assert.ok(edge.samples.every((p, i, all) => !i || p.x >= all[i - 1].x - 0.1), `${edge.id} must not reverse into a hook`);
  assert.deepEqual(edge.hits, [], `${edge.id} must clear visible node bodies`);
};
const labelInput = async () => {
  const input = page.locator('[data-edge-inspector] input[data-edge-label]');
  if (!await input.count()) await page.locator('[data-edge-label-add]').click();
  return input;
};
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__canvasEditing);
  await fixture();
  const horizontal = await geometry();
  assert.equal(horizontal.length, 2);
  for (const e of horizontal) {
    assert.equal(e.sourceHandle, 'out-right'); assert.equal(e.targetHandle, 'in-left'); near(e.start.y, e.end.y, 'side ports share a baseline');
    assert.deepEqual(e.hits, [], `${e.id} must not enter any card`);
  }
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect().height));
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 100, 'fixture must have visibly unequal card heights');
  await page.screenshot({ path: `${outputDir}/horizontal-baseline.png` });
  check('unequal-height horizontal cards connect through aligned side ports');

  await fixture('vertical');
  assert.ok((await geometry()).every((e) => e.sourceHandle === 'out-bottom' && e.targetHandle === 'in-top'));
  check('vertical chain uses bottom-to-top ports');
  await fixture('mixed');
  const mixed = await geometry();
  assert.equal(mixed[0].sourceHandle, 'out-right'); assert.equal(mixed[0].targetHandle, 'in-left');
  assert.equal(mixed[1].sourceHandle, 'out-bottom'); assert.equal(mixed[1].targetHandle, 'in-top');
  await page.screenshot({ path: `${outputDir}/mixed-directions.png` });
  check('mixed canvas resolves row and column connections independently');

  await fixture();
  const beforeLayout = await storedGraph();
  const beforeViewport = await page.evaluate(() => window.__rf.getViewport());
  await openLayout();
  await page.locator('[data-layout-direction]').locator('label:has(input[value="vertical"])').click();
  await page.locator('[data-layout-method]').locator('label:has(input[value="layers"])').click();
  await page.locator('[data-layout-route]').locator('label:has(input[value="orthogonal"])').click();
  await page.locator('[data-layout-preview]').click();
  await page.waitForTimeout(450);
  assert.deepEqual(await storedGraph(), beforeLayout, 'preview must not mutate persisted graph or history');
  const preview = await page.evaluate(() => ({ draft: window.__canvasEditing.getState().layoutPreview,
    visible: window.__rf.getNodes().map((n) => ({ id: n.id, position: n.position })) }));
  assert.ok(preview.draft);
  assert.equal(preview.visible[0].position.x, preview.visible[1].position.x);
  assert.ok(preview.visible[1].position.y > preview.visible[0].position.y);
  await page.screenshot({ path: `${outputDir}/layout-preview.png` });
  await page.locator('[data-canvas-layout-panel]').getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(350);
  assert.deepEqual(await storedGraph(), beforeLayout);
  const restoredViewport = await page.evaluate(() => window.__rf.getViewport());
  near(restoredViewport.x, beforeViewport.x, 'cancel restores viewport x');
  near(restoredViewport.y, beforeViewport.y, 'cancel restores viewport y');
  near(restoredViewport.zoom, beforeViewport.zoom, 'cancel restores zoom', 0.01);
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutPreview), null);
  check('layout preview changes rendered geometry only and cancel restores graph/camera');

  await openLayout();
  await page.locator('[data-layout-direction]').locator('label:has(input[value="vertical"])').click();
  await page.locator('[data-layout-method]').locator('label:has(input[value="chains"])').click();
  await page.locator('[data-layout-route]').locator('label:has(input[value="orthogonal"])').click();
  await page.locator('[data-layout-apply]').click();
  await page.waitForTimeout(450);
  const appliedLayout = await storedGraph();
  assert.ok(appliedLayout.nodes.every((n) => n.direction === 'vertical' && n.route === 'orthogonal'));
  assert.equal(appliedLayout.nodes[0].position.x, appliedLayout.nodes[1].position.x);
  await undo();
  const undoneLayout = await storedGraph();
  assert.deepEqual(undoneLayout.nodes, beforeLayout.nodes);
  assert.deepEqual(undoneLayout.edges, beforeLayout.edges);
  check('layout apply saves preferences and positions as one undoable action');

  await openLayout();
  await page.locator('[data-layout-method]').locator('label:has(input[value="layers"])').click();
  await page.locator('[data-layout-density]').locator('label:has(input[value="relaxed"])').click();
  await page.locator('[data-canvas-layout-panel]').getByRole('button', { name: '关闭', exact: true }).click();
  await openLayout();
  assert.equal(await page.locator('[data-layout-density]').locator('input:checked').inputValue(), 'relaxed');
  await page.locator('[data-layout-density]').evaluate((input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await page.locator('[data-canvas-layout-panel]').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('[data-canvas-layout-panel]').waitFor({ state: 'detached' });
  await openLayout();
  assert.equal(await page.locator('[data-layout-density]').locator('input:checked').inputValue(), 'standard');
  await page.locator('[data-layout-cancel]').click();
  check('layout close keeps session options, IME Escape is ignored and normal Escape cancels them');

  await fixture();
  await openEdge('edge-a-b');
  const inspector = page.locator('[data-edge-inspector]');
  const beforeEdge = await storedGraph();
  const oldPath = (await geometry()).find((e) => e.id === 'edge-a-b').d;
  await chooseRoute('orthogonal');
  await (await labelInput()).fill('整理后的上下文');
  await page.waitForTimeout(250);
  assert.deepEqual(await storedGraph(), beforeEdge, 'edge draft must not write to graph');
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().edgePreview.data.label), '整理后的上下文');
  assert.notEqual((await geometry()).find((e) => e.id === 'edge-a-b').d, oldPath);
  await inspector.locator('[data-edge-cancel]').click();
  await page.waitForTimeout(180);
  assert.deepEqual(await storedGraph(), beforeEdge);
  assert.equal(await (await labelInput()).inputValue(), '');
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().edgePreview), null);
  check('one click opens compact inspector; route/label drafts do not write until applied');

  await chooseRoute('orthogonal');
  await (await labelInput()).fill('分析依据');
  await inspector.locator('[data-edge-apply]').click();
  await page.waitForTimeout(200);
  const savedEdge = (await storedGraph()).edges.find((e) => e.id === 'edge-a-b');
  assert.equal(savedEdge.data.route, 'orthogonal'); assert.equal(savedEdge.data.label, '分析依据');
  assert.equal(savedEdge.data.isCrossLink, undefined);
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await undo();
  assert.deepEqual((await storedGraph()).edges, beforeEdge.edges);
  check('route and label save together without changing relation and undo restores them');

  await fixture();
  await openEdge('edge-b-c');
  await inspector.locator('[data-edge-relation="reference"]').click();
  assert.equal(await inspector.locator('[data-edge-relation]').count(), 2);
  assert.equal(await inspector.locator('[data-edge-scope], [data-edge-context-toggle], [data-edge-context-preview]').count(), 0);
  assert.equal((await storedGraph()).edges.find((e) => e.id === 'edge-b-c').data.isCrossLink, undefined);
  await inspector.locator('[data-edge-apply]').click();
  const reference = (await storedGraph()).edges.find((e) => e.id === 'edge-b-c');
  assert.equal(reference.data.isCrossLink, true); assert.equal(reference.data.contextDepth, undefined);
  const payload = await page.evaluate(async () => {
    const { buildContext } = await import('/src/store/context-builder.ts');
    const state = window.__store.getState();
    return JSON.stringify(buildContext('c', state.nodes.map((node) => node.id === 'c'
      ? { ...node, data: { ...node.data, question: '', response: '' } } : node), state.edges));
  });
  assert.ok(payload.includes('RESPONSE_b') && !payload.includes('RESPONSE_a') && !payload.includes('QUESTION_a') && !payload.includes('ATTACHMENT_'));
  await page.screenshot({ path: `${outputDir}/edge-inspector-simple.png` });
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await undo();
  assert.equal((await storedGraph()).edges.find((e) => e.id === 'edge-b-c').data.isCrossLink, undefined);
  check('only two relationship choices remain; single-node reference sends no ancestors or attachments');

  await openEdge('edge-a-b');
  await (await labelInput()).fill('临时标题');
  await page.keyboard.press('Escape');
  assert.equal(await (await labelInput()).inputValue(), '');
  assert.equal(await inspector.count(), 1);
  await (await labelInput()).focus();
  await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
  assert.equal((await storedGraph()).edges.length, 2);
  await page.keyboard.press('Escape');
  await inspector.waitFor({ state: 'detached' });
  check('Escape first cancels drafts then closes; editing keys never delete the connection');

  await openEdge('edge-a-b');
  await (await labelInput()).fill('关闭后保留');
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await openEdge('edge-a-b');
  assert.equal(await (await labelInput()).inputValue(), '关闭后保留');
  await openEdge('edge-b-c', false);
  assert.equal(await (await labelInput()).inputValue(), '');
  await openEdge('edge-a-b', false);
  assert.equal(await (await labelInput()).inputValue(), '关闭后保留');
  await inspector.locator('[data-edge-apply]').click();
  await (await labelInput()).fill('');
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await openEdge('edge-a-b');
  assert.equal(await (await labelInput()).inputValue(), '', 'explicitly empty label draft survives closing');
  await inspector.locator('[data-edge-cancel]').click();
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await openEdge('edge-a-b');
  assert.equal(await (await labelInput()).inputValue(), '关闭后保留');
  await (await labelInput()).fill('中文输入草稿');
  const beforeIme = await storedGraph();
  for (const key of ['Escape', 'Enter']) await (await labelInput()).evaluate((input, key) => input.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: key, ctrlKey: key === 'Enter', isComposing: true, bubbles: true })), key);
  assert.equal(await (await labelInput()).inputValue(), '中文输入草稿');
  assert.deepEqual(await storedGraph(), beforeIme);
  await page.evaluate(() => window.__ui.getState().setApiKeyModalOpen(true));
  await page.locator('[data-apikey-tabs]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-apikey-tabs]').waitFor({ state: 'detached' });
  assert.equal(await (await labelInput()).inputValue(), '中文输入草稿');
  await inspector.locator('[data-edge-cancel]').click();
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  check('edge drafts survive close/switch including empty labels; cancel, IME and nested Escape stay isolated');

  for (const destination of ['content', 'port']) {
    await fixture();
    await page.evaluate(() => window.__store.setState({ edges: [] }));
    await page.waitForTimeout(200);
    const source = page.locator('.react-flow__node[data-id="a"] [data-connection-role="source"][data-connection-side="right"]');
    const sourceBox = await source.boundingBox();
    const target = page.locator(destination === 'port'
      ? '.react-flow__node[data-id="b"] [data-connection-role="target"][data-connection-side="left"]'
      : '.react-flow__node[data-id="b"]');
    const targetBox = await target.boundingBox();
    assert.ok(sourceBox && targetBox);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    const targetX = targetBox.x + (destination === 'port' ? targetBox.width / 2 : targetBox.width * 0.5);
    const targetY = targetBox.y + (destination === 'port' ? targetBox.height / 2 : targetBox.height * 0.4);
    await page.mouse.move(targetX, targetY, { steps: 18 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__store.getState().edges.length === 1);
    const connected = (await storedGraph()).edges[0];
    assert.equal(connected.source, 'a'); assert.equal(connected.target, 'b'); assert.equal(connected.data.isCrossLink, true);
    const connectedGeometry = (await geometry())[0];
    assert.equal(connectedGeometry.sourceHandle, 'out-right'); assert.equal(connectedGeometry.targetHandle, 'in-left');
    assert.deepEqual(connectedGeometry.hits, []);
  }
  check('real wire drags to card content and side port both create correctly anchored references');

  await fixture();

  await page.evaluate(() => {
    window.__store.setState((s) => ({ edges: [...s.edges, { id: 'feedback', source: 'c', target: 'a', type: 'smoothstep', data: { isCrossLink: true } }] }));
    window.__canvasEditing.getState().setEdgeId('feedback');
  });
  await inspector.waitFor();
  assert.equal(await inspector.locator('[data-edge-relation="continue"]').isDisabled(), true);
  check('structural cycle conversion is disabled');
  for (const kind of ['watch', 'branch', 'material']) {
    await fixture();
    await page.evaluate((kind) => {
      window.__store.setState((s) => ({
        nodes: kind === 'material' ? s.nodes.map((n) => n.id === 'a' ? { ...n, data: { ...n.data, stepKind: 'note' } } : n) : s.nodes,
        edges: s.edges.map((e) => e.id === 'edge-a-b' ? { ...e, data: kind === 'watch' ? { isWatch: true, isCrossLink: true }
          : kind === 'branch' ? { isBranchFromSelection: true } : {} } : e),
      }));
      window.__canvasEditing.getState().setEdgeId('edge-a-b');
    }, kind);
    await inspector.waitFor();
    assert.equal(await inspector.locator('[data-edge-relation]').count(), 0);
    assert.equal(await inspector.locator('[data-edge-route="curve"]').isEnabled(), true);
    assert.equal(await (await labelInput()).isEnabled(), true);
  }
  check('watch, exploration and material connections retain fixed roles with editable appearance');
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(250);
  const box = await inspector.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 640 && box.y + box.height <= 900);
  await page.screenshot({ path: `${outputDir}/edge-inspector-narrow.png` });
  check('narrow inspector keeps its frame and action footer inside the viewport');

  await inspector.locator('[data-edge-locate="target"]').click();
  await page.waitForTimeout(400);
  const located = await page.locator('.react-flow__node[data-id="b"]').boundingBox();
  const locatedPanel = await inspector.boundingBox();
  assert.ok(located && locatedPanel && located.x >= 0 && located.y >= 0 && located.x + located.width <= 640 && located.y + located.height <= 900
    && disjoint(located, locatedPanel), 'the located card must stay fully inside the viewport and outside the actual inspector bounds');
  const canvasHeader = await page.locator('[data-canvas-header]').boundingBox();
  const locatedTitle = await page.locator('.react-flow__node[data-id="b"] [data-node-name]:visible').first().boundingBox();
  assert.ok(canvasHeader && locatedTitle && locatedTitle.y > canvasHeader.y + canvasHeader.height, 'located title must clear the global toolbar');
  const locatedPorts = await page.locator('.react-flow__node[data-id="b"] [data-connection-side="left"].tdag-port-used, .react-flow__node[data-id="b"] [data-connection-side="right"].tdag-port-used')
    .evaluateAll(ports => ports.map(port => { const rect = port.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }));
  assert.ok(locatedPorts.length > 0 && locatedPorts.every(port => port.x >= 0 && port.y > canvasHeader.y + canvasHeader.height
    && port.x + port.width <= 640 && port.y + port.height <= 900 && disjoint(port, locatedPanel)), 'located side ports must remain on canvas and outside the inspector and toolbar');
  await page.screenshot({ path: `${outputDir}/edge-inspector-narrow-locate.png` });
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await openLayout();
  await page.locator('[data-layout-direction]').locator('label:has(input[value="horizontal"])').click();
  await page.locator('[data-layout-method]').locator('label:has(input[value="chains"])').click();
  await page.locator('[data-layout-preview]').click();
  await page.waitForTimeout(400);
  const narrowLayoutBox = await page.locator('[data-canvas-layout-panel]').boundingBox();
  const titleUncovered = await page.locator('#canvas-layout-title').evaluate((title) => {
    const rect = title.getBoundingClientRect();
    return !!document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('[data-canvas-layout-panel]');
  });
  assert.equal(titleUncovered, true, 'layout panel title must not be covered by the material palette');
  const previewCards = await page.locator('.react-flow__node').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { id: element.getAttribute('data-id'), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  assert.ok(narrowLayoutBox && previewCards.length === 3 && previewCards.every(rect => rect.y >= 0 && rect.y + rect.height <= 900
    && rect.x >= 0 && rect.x + rect.width <= 640 && disjoint(rect, narrowLayoutBox)), 'all preview cards must fit the viewport outside the actual layout panel bounds');
  assert.ok(previewCards.every(rect => rect.y > canvasHeader.y + canvasHeader.height), 'preview nodes must clear the global toolbar');
  await page.screenshot({ path: `${outputDir}/layout-preview-narrow.png` });
  check('narrow locate keeps title/ports visible and layout preview fits the graph outside the actual tool panel');

  const disabledPorts = await page.locator('[data-connection-role="source"]').evaluateAll((ports) => ports.every((port) => getComputedStyle(port).pointerEvents === 'none'));
  assert.equal(disabledPorts, true, 'preview must disable wire starts');
  await page.locator('[data-layout-cancel]').click();
  await page.setViewportSize({ width: 1800, height: 1100 });
  await fixture();
  await page.evaluate(() => window.__rf.setViewport({ x: 40, y: 80, zoom: 0.15 }, { duration: 0 }));
  await page.waitForTimeout(250);
  const widths = await page.locator('.react-flow__edge-interaction').evaluateAll((paths) => paths.map((path) => {
    const matrix = path.getScreenCTM();
    return Number.parseFloat(getComputedStyle(path).strokeWidth) * Math.hypot(matrix.a, matrix.b);
  }));
  assert.ok(widths.length === 2 && widths.every((width) => width >= 14 - 0.01));
  check('layout preview disables connections and edge hit area remains at least 14 screen pixels when zoomed out');

  await fixture();
  await openEdge('edge-a-b');
  await chooseRoute('curve');
  await page.waitForTimeout(200);
  const curved = (await geometry()).find((edge) => edge.id === 'edge-a-b');
  assert.ok(Math.max(...curved.samples.map((point) => Math.abs(point.y - curved.start.y))) < 1, 'aligned facing ports remain naturally straight');
  assert.deepEqual(curved.hits, []);
  await inspector.locator('[data-edge-apply]').click();
  await page.screenshot({ path: `${outputDir}/aligned-curve.png` });
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => window.__store.setState((state) => ({
    nodes: state.nodes.filter((n) => n.id !== 'c').map((n) => n.id === 'b' ? { ...n, position: { x: 1060, y: 480 } } : n),
    edges: state.edges.filter((e) => e.id === 'edge-a-b'),
  })));
  await page.waitForTimeout(400);
  assertNaturalS((await geometry())[0]);
  await page.screenshot({ path: `${outputDir}/offset-s-curve.png` });
  check('aligned ports stay direct; offset ports use a full-span S curve with no endpoint hooks');

  await fixture();
  await page.evaluate(async () => {
    const { useAppearance } = await import('/src/lib/appearance.ts');
    useAppearance.getState().setLighting('dark');
    const state = window.__store.getState();
    const template = state.nodes[0];
    const make = (id, x, y, question, width = 360, height = 240) => ({ ...template, id, selected: false,
      position: { x, y }, width, height, measured: { width, height }, data: { ...template.data, attachments: [],
        displayName: question, question, response: '用于检查连线弧度、重叠与避障。', responses: ['用于检查连线弧度、重叠与避障。'], isRoot: id === 'source' } });
    const nodes = [make('source', 60, 160, '梳理设计规范'), make('target-1', 1260, 160, '继续深入分析'),
      make('target-2', 1260, 650, '引用这轮问答'), make('obstacle', 650, 370, '其他讨论', 420, 220)];
    const edges = [1, 2].map((number) => ({ id: `fan-${number}`, source: 'source', target: `target-${number}`, type: 'smoothstep',
      data: { route: 'curve', ...(number === 2 ? { isCrossLink: true } : {}) },
      style: { stroke: '#6B5CE7', strokeWidth: 2, ...(number === 2 ? { strokeDasharray: '8 4' } : {}) },
      markerEnd: { type: 'arrowclosed', color: '#6B5CE7' } }));
    window.__canvasEditing.getState().reset();
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges }], historyIndex: 0 });
    window.__rf.setViewport({ x: 50, y: 40, zoom: 0.75 }, { duration: 0 });
  });
  await page.waitForTimeout(700);
  const fan = await geometry();
  assert.equal(fan.length, 2);
  for (const edge of fan) assert.deepEqual(edge.hits, [], `${edge.id} must clear every node`);
  const closeSamples = fan[0].samples.slice(20, -20).filter((point) => fan[1].samples.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 3));
  assert.ok(closeSamples.length < 30, `shared edges must separate, found ${closeSamples.length} overlapping samples`);
  const beforeSelect = fan.map((edge) => edge.d);
  await openEdge('fan-2');
  await page.waitForTimeout(250);
  assert.deepEqual((await geometry()).map((edge) => edge.d), beforeSelect, 'selection must not reorder shared lanes');
  const compactPanel = await inspector.boundingBox();
  assert.ok(compactPanel && compactPanel.height < 700, 'editor should fit its content instead of occupying the whole viewport');
  assert.equal(await inspector.locator('[data-edge-scope], [data-edge-context-toggle], [data-edge-context-preview]').count(), 0);
  await page.screenshot({ path: `${outputDir}/shared-curves-dark.png` });
  check('shared curved routes separate around obstacles and keep lanes stable while selected');

  await page.evaluate(() => {
    window.__canvasEditing.getState().reset();
    const template = window.__store.getState().nodes[0];
    const make = (id, x, y, name) => ({ ...template, id, position: { x, y }, width: 420,
      height: undefined, measured: undefined, selected: false, data: { ...template.data, displayName: name,
        question: name, summaries: [], response: '用于检查长距离错位连接。', responses: ['用于检查长距离错位连接。'],
        isCollapsed: true, isRoot: id === 'source' } });
    const nodes = [make('source', -800, -80, '上游对话'), make('compact-1', 200, 400, '汇总三轮讨论'),
      make('compact-2', 1000, 500, '继续汇总讨论')];
    const edges = [1, 2].map((number) => ({ id: `compact-${number}`, source: 'source', target: `compact-${number}`,
      type: 'smoothstep', data: { route: 'curve' }, style: { stroke: '#aaa1ed', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed', color: '#aaa1ed' } }));
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges }], historyIndex: 0 });
    window.__rf.setViewport({ x: 100, y: 150, zoom: 0.6 }, { duration: 0 });
  });
  await page.waitForTimeout(900);
  const compact = await geometry();
  assert.equal(compact.length, 2);
  assertNaturalS(compact[0]);
  for (const edge of compact) assert.deepEqual(edge.hits, [], `${edge.id} must clear the nearer compact card`);
  await page.screenshot({ path: `${outputDir}/compact-offset-curves-dark.png` });
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 150, zoom: 0.8 }, { duration: 0 }));
  await page.waitForTimeout(650);
  for (const edge of await geometry()) assert.deepEqual(edge.hits, [], 'semantic zoom remeasures ports without routing through resized cards');
  check('offscreen source and staggered compact nodes retain S curves across semantic zoom');

  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light'));
  await fixture();

  const viewerHash = await page.evaluate(async () => {
    const { buildViewerLink } = await import('/src/lib/viewer.ts');
    const state = window.__store.getState();
    const edges = state.edges.map((edge) => ({ ...edge, data: { ...edge.data, label: '只读连接说明' } }));
    return new URL(await buildViewerLink(state.nodes, edges)).hash;
  });
  await page.goto(`${appUrl}/${viewerHash}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rf && window.__store?.getState().nodes.length === 3);
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    window.__store.setState((state) => ({ edges: state.edges.map((edge) => ({ ...edge, selected: true })) }));
    window.__rf.setViewport({ x: 0, y: 20, zoom: 1 }, { duration: 0 });
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-viewer-badge]').count(), 1);
  assert.equal(await page.locator('[data-edge-edit]').count(), 0);
  assert.equal(await page.locator('[data-edge-annotation]').evaluateAll((labels) => labels.length === 2 && labels.every((label) => label.tagName === 'SPAN')), true);
  assert.equal(await page.locator('[data-connection-role="source"]').evaluateAll((ports) => ports.every((port) => getComputedStyle(port).pointerEvents === 'none')), true);
  const viewerEdge = (await geometry())[0];
  await page.mouse.dblclick(viewerEdge.click.x, viewerEdge.click.y, { delay: 120 });
  assert.equal(await page.locator('[data-edge-inspector]').count(), 0);
  await page.screenshot({ path: `${outputDir}/viewer-readonly.png` });
  check('shared viewer keeps labels readable while edge editing and connection handles stay read-only');
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` }).catch(() => {});
  console.error(await page.evaluate(() => ({ editor: window.__canvasEditing?.getState().edgeId,
    layout: window.__canvasEditing?.getState().layoutOpen, alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent) })).catch(() => ({})));
  throw error;
} finally {
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, blockedWrites }, null, 2));
  await browser.close();
}
