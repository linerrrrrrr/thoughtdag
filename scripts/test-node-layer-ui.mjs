// Layer commands use the real inspector and verify actual rendered stacking.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/node-layer';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
await context.routeWebSocket(/.*/, socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const panel = () => page.locator('[data-selection-properties]');
const menu = () => page.locator('[data-selection-menu][role="menu"]');
const geometry = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height, data }) => ({ id, position, width, height,
  question: data.question, response: data.response, frameCarry: data.frameCarry })));
const order = () => page.evaluate(async () => {
  const { nodeLayerOrder } = await import('/src/lib/node-layer.ts');
  return nodeLayerOrder(window.__store.getState().nodes).map(node => node.id);
});
const renderedOrder = () => page.locator('.react-flow__node').evaluateAll(nodes => nodes.map((node, index) => ({ id: node.dataset.id,
  z: Number(getComputedStyle(node).zIndex), index })).sort((a, b) => a.z - b.z || a.index - b.index).map(node => node.id));
const select = async ids => {
  await page.evaluate(ids => {
    window.__store.getState().setSelectedNodeIds(ids);
    window.__canvasEditing.getState().requestProperties();
  }, ids);
  if (ids.length) await panel().waitFor();
};
async function fixture(ids = ['b']) {
  if (await menu().count()) await page.keyboard.press('Escape');
  await page.evaluate(ids => {
    const nodes = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, type: 'thought', dragHandle: '.drag-handle',
      position: { x: 100 + index * 40, y: 240 + index * 20 }, width: 360, height: 240, selected: ids.includes(id),
      data: { stepKind: 'note', displayName: `研究材料 ${id.toUpperCase()}`, question: `研究材料 ${id.toUpperCase()}`, response: '',
        responses: [''], responseIndex: 0, isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 5, roleMode: 'inherit' } }));
    const edges = [{ id: 'ab', source: 'a', target: 'b', type: 'thought', data: {} }, { id: 'bc', source: 'b', target: 'c', type: 'thought', data: {} }];
    window.__store.setState({ nodes, edges, selectedNodeIds: ids, selectedNodeId: ids.length === 1 ? ids[0] : null,
      history: [{ nodes, edges }], historyIndex: 0 });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__canvasEditing.getState().setSelectionRegion(null);
    window.__canvasEditing.getState().requestProperties();
    window.__rf.setViewport({ x: 60, y: 50, zoom: 0.8 }, { duration: 0 });
  }, ids);
  await panel().waitFor();
  await page.waitForFunction(() => window.__store.getState().nodes.every(node => node.measured?.width && node.measured?.height));
}
async function openLayers() {
  await page.locator('[data-selection-layers]').click();
  await page.locator('[data-layer-action="forward"]').waitFor();
  assert.equal(await menu().count(), 1);
}
async function action(command) {
  await openLayers();
  await page.locator(`[data-layer-action="${command}"]`).click();
  assert.equal(await menu().count(), 0);
  assert.equal(await page.evaluate(() => window.__ui.getState().confirmRequest), null);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function menuFits() {
  const box = await menu().boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
}
const hit = () => page.evaluate(() => {
  const { x, y, zoom } = window.__rf.getViewport();
  return document.elementsFromPoint(x + 300 * zoom, y + 350 * zoom).find(element => element.matches('.react-flow__node'))?.getAttribute('data-id');
});

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5177', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__canvasEditing);
  const expected = { forward: ['a', 'c', 'b', 'd'], backward: ['b', 'a', 'c', 'd'], front: ['a', 'c', 'd', 'b'], back: ['b', 'a', 'c', 'd'] };
  for (const command of ['forward', 'backward', 'front', 'back']) {
    await fixture();
    const before = await geometry();
    const edges = await page.evaluate(() => window.__store.getState().edges);
    await action(command);
    assert.deepEqual(await order(), expected[command]);
    assert.deepEqual(await renderedOrder(), expected[command]);
    assert.deepEqual(await geometry(), before);
    assert.deepEqual(await page.evaluate(() => window.__store.getState().edges), edges);
    assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds), ['b']);
    await page.evaluate(() => window.__store.getState().undo());
    assert.deepEqual(await order(), ['a', 'b', 'c', 'd']);
    await page.evaluate(() => window.__store.getState().redo());
    assert.deepEqual(await order(), expected[command]);
  }
  check('all four commands change rendered order, preserve geometry and wiring, and support one-step undo and redo');

  await fixture(['a']);
  assert.equal(await hit(), 'd', 'Selecting a lower object does not automatically raise it');
  await action('front');
  assert.equal(await hit(), 'a', 'The requested front object actually receives pointer hits');
  await select([]);
  assert.equal(await hit(), 'a', 'Deselecting preserves authored stacking');
  check('selection and deselection preserve actual overlap and pointer hit order');

  await fixture(['b', 'c']);
  await action('front');
  assert.deepEqual(await order(), ['a', 'd', 'b', 'c']);
  assert.deepEqual(await renderedOrder(), ['a', 'd', 'b', 'c']);
  check('multiple selected objects retain their relative stacking order');

  await fixture(['d']);
  const historyIndex = await page.evaluate(() => window.__store.getState().historyIndex);
  await openLayers();
  assert.ok(await page.locator('[data-layer-action="forward"]').isDisabled());
  assert.ok(await page.locator('[data-layer-action="front"]').isDisabled());
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('[data-selection-layers]').evaluate(node => node === document.activeElement));
  assert.equal(await page.evaluate(() => window.__store.getState().historyIndex), historyIndex);
  assert.equal(await panel().count(), 1);
  check('boundary commands are disabled and Escape closes only the menu without an undo step');

  await fixture();
  const cardBox = await panel().boundingBox();
  await page.locator('[data-selection-align]').click();
  await page.locator('[data-arrange-action="left"]').waitFor();
  await openLayers();
  assert.equal(await page.locator('[data-arrange-action]').count(), 0);
  assert.equal(await page.locator('[data-layer-action]').count(), 4);
  assert.deepEqual(await panel().boundingBox(), cardBox);
  await page.locator('[data-selection-align]').click();
  assert.equal(await page.locator('[data-layer-action]').count(), 0);
  assert.equal(await page.locator('[data-arrange-action]').count(), 8);
  await page.keyboard.press('Escape');
  await openLayers();
  await menuFits();
  await page.screenshot({ path: `${output}/desktop.png` });
  await menu().screenshot({ path: `${output}/menu.png` });
  await page.keyboard.press('Escape');
  check('Layers and Align replace one another without moving the inspector or changing selection');

  await fixture();
  await page.evaluate(() => {
    const frame = { id: 'frame', type: 'thought', position: { x: 40, y: 160 }, width: 900, height: 700,
      zIndex: -1, dragHandle: '.drag-handle', data: { ...window.__store.getState().nodes[0].data, question: '研究分区', stepKind: 'frame', frameCarry: true } };
    window.__store.setState(state => ({ nodes: [...state.nodes, frame] }));
  });
  await select(['frame']);
  const beforeFrame = await geometry();
  await action('front');
  assert.equal((await order()).at(-1), 'frame');
  assert.equal((await renderedOrder()).at(-1), 'frame');
  assert.deepEqual(await geometry(), beforeFrame, 'Frame layering does not move or resize its contents');
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  assert.equal((await order()).at(-1), 'frame');
  assert.equal((await renderedOrder()).at(-1), 'frame');
  check('explicit frame layers override automatic background stacking and persist after reload');

  await fixture();
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('[data-appearance-lighting]').getByRole('button', { name: 'Dark', exact: true }).click();
  await page.keyboard.press('Escape');
  await select(['b']);
  await openLayers();
  await menuFits();
  assert.equal(await page.getByRole('menuitem', { name: 'Bring forward', exact: true }).count(), 1);
  await page.screenshot({ path: `${output}/english-dark.png` });
  await page.keyboard.press('Escape');
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.locator('[data-appearance-lighting]').getByRole('button', { name: '亮', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await select(['b']);
  await openLayers();
  await menuFits();
  await page.screenshot({ path: `${output}/mobile.png` });
  check('Chinese, English, light, dark and narrow layouts keep all four commands accessible');

  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`All ${checks.length} layer UI checks passed.`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
