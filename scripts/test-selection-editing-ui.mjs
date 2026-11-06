// Isolated fixtures: grouped resize, selection types, atomic edge editing, and drafts.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
// Concurrent workspace edits must not hot-replace the store during a gesture.
await context.routeWebSocket(/.*/, socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(10000);
const output = 'local-tests/selection-editing';
await mkdir(output, { recursive: true });
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  writes.push(route.request().url()); return route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const geometry = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, width, height, position, data }) => ({ id, width, height, position, keep: data.keepOverviewHeight })));
const edges = () => page.evaluate(() => window.__store.getState().edges.map(({ selected: _selected, ...edge }) => edge));
const selectedEdges = () => page.evaluate(() => window.__store.getState().edges.filter(edge => edge.selected).map(edge => edge.id).sort());
const fixture = async (zoom = 0.6) => {
  await page.evaluate(() => {
    const nodes = ['a', 'b', 'c', 'outside'].map((id, index) => ({ id, type: 'thought', selected: index < 3,
      position: { x: index === 3 ? 1300 : 100, y: index === 3 ? 500 : 130 + index * 420 }, width: 440 + index * 20, height: 260 + index * 20,
      data: { question: `研究节点 ${id}`, displayName: `研究节点 ${id}`, response: 'A stable answer for selection tests.', responses: ['A stable answer for selection tests.'], responseIndex: 0,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, isRoot: index === 0, isBranch: false,
        highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 10, roleMode: 'inherit' } }));
    const edges = [{ id: 'ab', source: 'a', target: 'b', data: { label: 'first', route: 'curve' } }, { id: 'bc', source: 'b', target: 'c', data: { label: 'second', isCrossLink: true, route: 'orthogonal' } }, { id: 'co', source: 'c', target: 'outside', data: {} }].map(edge => ({ ...edge, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top' }));
    window.__canvasEditing.getState().reset();
    window.__store.setState({ nodes, edges, selectedNodeIds: ['a', 'b', 'c'], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    window.__ui.setState({ panelOpen: false, tutorialOpen: false, releaseNotesOpen: false, autoRefreshPaused: true, drafts: {} });
    window.__canvasEditing.getState().requestProperties();
  });
  await page.waitForTimeout(600);
  await page.evaluate(zoom => window.__rf.setViewport({ x: 80, y: 50, zoom }, { duration: 0 }), zoom);
  await page.locator('[data-selection-resize="width"]').waitFor();
  await page.waitForTimeout(250);
};
const drag = async (axis, dx, dy, cancel = false) => {
  await page.locator(`[data-selection-resize="${axis}"]`).hover();
  const box = await page.locator(`[data-selection-resize="${axis}"]`).boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(150);
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1, `${a} != ${b}`);
const undo = () => page.evaluate(() => window.__store.getState().undo());
// Batch editing fixtures establish a confirmed scope; pointer hit-testing is
// covered separately by test-selection-region-ui.mjs.
const scopeFixture = (nodeIds, edgeIds) => page.evaluate(({ nodeIds, edgeIds }) => {
  const state = window.__store.getState();
  window.__canvasEditing.getState().setSelectionRegion(null);
  state.setSelectedNodeIds(nodeIds);
  window.__store.setState({ edges: state.edges.map(edge => ({ ...edge, selected: false })) });
  window.__canvasEditing.getState().setSelectionRegion({ rect: { x: 80, y: 100, width: 600, height: 1300 }, nodeIds, edgeIds, frameIds: [] });
}, { nodeIds, edgeIds });
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5196', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await fixture();
  const initial = await geometry(), originalEdges = await edges();
  assert.equal(initial.length, 4);
  await drag('width', 60, 0);
  let sized = await geometry();
  for (let i = 0; i < 3; i++) { near(sized[i].width, initial[i].width + 100); assert.equal(sized[i].height, initial[i].height); assert.deepEqual(sized[i].position, initial[i].position); }
  assert.deepEqual(sized[3], initial[3]); assert.deepEqual(await edges(), originalEdges);
  await undo(); assert.deepEqual(await geometry(), initial);
  await page.evaluate(() => window.__store.getState().redo()); assert.deepEqual(await geometry(), sized);
  check('horizontal drag resizes every selected node at canvas zoom, preserves positions and wiring, and undoes/redoes once');
  await drag('height', 0, 60);
  const tall = await geometry();
  for (let i = 0; i < 3; i++) { near(tall[i].height, sized[i].height + 100); assert.equal(tall[i].width, sized[i].width); assert.deepEqual(tall[i].position, sized[i].position); }
  await page.screenshot({ path: `${output}/nodes-light.png` });
  await drag('both', 30, 30, true); assert.deepEqual(await geometry(), tall);
  check('vertical resize is visible in overview; Escape cancels the complete drag without changing selection');
  await page.locator('[data-selection-resize="width"]').focus();
  await page.keyboard.press('Shift+ArrowRight');
  sized = await geometry(); for (let i = 0; i < 3; i++) near(sized[i].width, tall[i].width + 10);
  await undo(); assert.deepEqual(await geometry(), tall);
  check('keyboard resize has a single undo step');

  await scopeFixture(['a', 'b', 'c'], ['ab', 'bc']);
  await page.locator('[data-selection-target="edges"]').click();
  assert.deepEqual(await selectedEdges(), ['ab', 'bc']);
  assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds), []);
  await page.locator('[data-batch-edge-inspector]').waitFor();
  const batchPanel = page.locator('[data-batch-edge-inspector]');
  assert.equal(await batchPanel.locator('.edge-inspector-mixed').count(), 3);
  assert.equal(await page.locator('[data-batch-edge-relation]:checked').count(), 0);
  assert.equal(await page.locator('[data-batch-edge-route][aria-pressed="true"]').count(), 0);
  assert.equal(await page.locator('[data-batch-edge-label]').inputValue(), '');
  assert.equal(await page.locator('[data-batch-edge-label]').getAttribute('placeholder'), '保留各自原值');
  assert.equal(await page.locator('[data-batch-edge-apply], [data-batch-edge-reset]').count(), 0);
  check('mixed values remain distinct in the shared relation choices, routes and live label field');
  await page.locator('[data-batch-edge-route="curve"]').click();
  const routedEdges = await edges();
  assert.ok(routedEdges.slice(0, 2).every(edge => edge.data.route === 'curve'));
  assert.equal(routedEdges[0].data.isCrossLink, undefined); assert.equal(routedEdges[1].data.isCrossLink, true);
  assert.deepEqual(routedEdges[2], originalEdges[2]);
  await undo(); assert.deepEqual(await edges(), originalEdges);
  assert.equal(await page.locator('[data-batch-edge-relation]:checked').count(), 0);
  assert.equal(await page.locator('[data-batch-edge-route][aria-pressed="true"]').count(), 0);
  await page.evaluate(() => window.__store.getState().redo()); assert.deepEqual(await edges(), routedEdges);
  check('a batch route choice saves immediately, preserves other values, and undoes as one step');
  await page.locator('[data-batch-edge-relation="reference"]').check();
  const referencedEdges = await edges();
  assert.ok(referencedEdges.slice(0, 2).every(edge => edge.data.isCrossLink));
  await undo(); assert.deepEqual(await edges(), routedEdges);
  await page.evaluate(() => window.__store.getState().redo()); assert.deepEqual(await edges(), referencedEdges);
  await page.locator('[data-batch-edge-label]').fill('共同标注');
  await batchPanel.locator('legend').first().click();
  const appliedEdges = await edges();
  assert.ok(appliedEdges.slice(0, 2).every(edge => edge.data.route === 'curve' && edge.data.label === '共同标注'));
  assert.equal(appliedEdges[1].data.isCrossLink, true); assert.deepEqual(appliedEdges[2], originalEdges[2]);
  await undo(); assert.deepEqual(await edges(), referencedEdges);
  await page.evaluate(() => window.__store.getState().redo()); assert.deepEqual(await edges(), appliedEdges);
  check('batch relation and annotation edits save immediately and preserve untouched fields and lines');
  await page.evaluate(() => window.__store.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: ['ab', 'bc'].includes(edge.id) })) })));

  await page.locator('[data-batch-edge-label]').fill('');
  await page.locator('[data-batch-edge-inspector]').getByRole('button', { name: '关闭', exact: true }).click();
  assert.deepEqual(await selectedEdges(), ['ab', 'bc']);
  assert.equal(await page.locator('[data-selection-properties]').count(), 0);
  await page.evaluate(() => window.__canvasEditing.getState().requestProperties());
  assert.equal(await page.locator('[data-batch-edge-label]').inputValue(), '');
  assert.ok((await edges()).slice(0, 2).every(edge => !edge.data.label));
  await page.locator('[data-batch-edge-label]').fill('即时保存');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-batch-edge-label]').inputValue(), '即时保存');
  assert.ok((await edges()).slice(0, 2).every(edge => edge.data.label === '即时保存'));
  assert.deepEqual(await selectedEdges(), ['ab', 'bc']);
  check('cleared labels stay saved across close/reopen and Escape does not revert live annotations');
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await page.screenshot({ path: `${output}/edges-dark.png` });

  await fixture(0.4);
  await page.mouse.click(1050, 700);
  const point = await page.locator('.react-flow__edge[data-id="ab"] .react-flow__edge-path').evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  // At overview zoom the node's minimum rendered height leaves a short gap.
  // Start in that gap, outside both the node and the edge-label hit area.
  await page.mouse.move(point.x - 38, point.y - 8); await page.mouse.down();
  await page.mouse.move(point.x + 38, point.y + 8, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(150);
  await page.locator('[data-selection-target="edges"]').click();
  assert.deepEqual(await selectedEdges(), ['ab']);
  assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds), []);
  check('a marquee across the visible middle of a curve selects only the line, without its endpoints');
  const other = await page.locator('.react-flow__edge[data-id="bc"] .react-flow__edge-path').evaluate(path => {
    const p = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()); return { x: p.x, y: p.y };
  });
  await page.keyboard.down('Control'); await page.mouse.click(other.x, other.y); await page.keyboard.up('Control');
  assert.deepEqual(await selectedEdges(), ['ab', 'bc']);
  await page.keyboard.down('Control'); await page.mouse.click(other.x, other.y); await page.keyboard.up('Control');
  assert.deepEqual(await selectedEdges(), ['ab']);
  check('Ctrl-click adds and removes lines without replacing the whole selection');
  await scopeFixture(['a', 'b', 'c'], ['ab', 'bc']);
  await page.locator('[data-selection-target="edges"]').click();
  await page.keyboard.press('Control+a');
  assert.deepEqual(await selectedEdges(), ['ab', 'bc', 'co']);
  check('select all follows the line selection mode');

  const invalid = await page.evaluate(async () => {
    const { applyBatchEdgeSettings } = await import('/src/lib/edge-edit.ts');
    const state = window.__store.getState();
    const edges = [{ id: 'one', source: 'a', target: 'b', data: { isCrossLink: true } }, { id: 'two', source: 'b', target: 'a', data: { isCrossLink: true } }];
    const before = JSON.stringify(edges);
    const result = applyBatchEdgeSettings(state.nodes, edges, ['one', 'two'], { relation: 'continue' });
    return { result, unchanged: JSON.stringify(edges) === before };
  });
  assert.deepEqual(invalid, { result: { ok: false, error: 'cycle' }, unchanged: true });
  check('a cycle formed by simultaneous conversions rejects the complete batch');

  const clampCheck = await page.evaluate(async () => {
    const { resizeSelectionBy } = await import('/src/lib/node-geometry.ts');
    const nodes = window.__store.getState().nodes.map((node, index) => ({ ...node, width: 600, height: 300,
      data: { ...node.data, lockAspectRatio: index === 0, stepKind: index === 1 ? 'note' : undefined } }));
    const live = nodes.map(node => ({ ...node, data: { ...node.data, response: 'live streamed answer' } }));
    const next = resizeSelectionBy(live, nodes.slice(0, 2), 600, undefined);
    const min = resizeSelectionBy(live, nodes.slice(0, 2), -2000, undefined);
    return { sizes: next.map(node => [node.width, node.height]), minimum: min.slice(0, 2).map(node => [node.width, node.height]),
      positions: next.every((node, i) => node.position === live[i].position), content: next.every(node => node.data.response === 'live streamed answer') };
  });
  assert.deepEqual(clampCheck, { sizes: [[1200, 600], [860, 300], [600, 300], [600, 300]], minimum: [[480, 240], [340, 300]], positions: true, content: true });
  check('mixed ratios, minimum/maximum sizes, unselected nodes and live streamed content are preserved');

  assert.equal(await page.locator('[data-selection-target-control]').count(), 0);
  await scopeFixture(['a', 'b', 'c', 'outside'], ['ab', 'bc', 'co']);
  await page.locator('[data-selection-target="edges"]').click();
  await page.locator('[data-selection-target="nodes"]').click();
  assert.deepEqual(await page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort()), ['a', 'b', 'c', 'outside']);
  assert.deepEqual(await selectedEdges(), []);
  await page.locator('[data-selection-target="edges"]').click();
  check('switching a confirmed scope restores its node candidates and clears the opposite object type');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-selection-target="nodes"]').click();
  await page.locator('[data-selection-target="edges"]').click();
  await page.getByRole('complementary', { name: 'Selection properties', exact: true }).waitFor();
  for (const selector of ['[data-selection-target-control]', '[data-batch-edge-inspector]']) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
  }
  await page.screenshot({ path: `${output}/mobile-english.png` });
  check('English controls and the batch panel fit a narrow viewport');
  const beforeDelete = await edges();
  await page.locator('[data-batch-edge-inspector]').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.keyboard.press('Enter');
  assert.deepEqual(await edges(), beforeDelete);
  await page.locator('[data-batch-edge-inspector]').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  assert.deepEqual(await edges(), []);
  assert.equal((await geometry()).length, 4);
  await undo(); assert.deepEqual(await edges(), beforeDelete);
  check('bulk deletion defaults to cancel, deletes only lines on confirmation, and undoes once');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`All ${checks.length} selection editing checks passed.`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
