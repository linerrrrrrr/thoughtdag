// A confirmed marquee retains its spatial scope when changing the selected object type.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/selection-region';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
// Other workspace work must not hot-replace the store during pointer gestures.
await context.routeWebSocket(/.*/, socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1.5, `${label}: ${actual} != ${expected}`);
const region = () => page.evaluate(() => window.__canvasEditing.getState().selectionRegion);
const selection = () => page.evaluate(() => ({
  nodes: [...window.__store.getState().selectedNodeIds].sort(),
  edges: window.__store.getState().edges.filter(edge => edge.selected).map(edge => edge.id).sort(),
}));
const wiring = () => page.evaluate(() => window.__store.getState().edges.map(({ selected: _selected, ...edge }) => edge));
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const choose = target => page.locator(`[data-selection-target="${target}"]`).click();
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
async function selected(nodes, edges) {
  const expected = { nodes: [...nodes].sort(), edges: [...edges].sort() };
  await page.waitForFunction(expected => JSON.stringify({
    nodes: [...window.__store.getState().selectedNodeIds].sort(),
    edges: window.__store.getState().edges.filter(edge => edge.selected).map(edge => edge.id).sort(),
  }) === JSON.stringify(expected), expected).catch(async error => {
    throw new Error(`Expected selection ${JSON.stringify(expected)}, got ${JSON.stringify(await selection())}: ${error.message}`);
  });
  assert.deepEqual(await selection(), expected);
}
async function probe(name, run) {
  if (process.env.CHECK_MATCH && !name.includes(process.env.CHECK_MATCH)) return;
  try { await run(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) {
    failures.push({ name, error: String(error) });
    console.error(`FAIL ${name}: ${error}`);
    await page.screenshot({ path: `${output}/failure-${failures.length}.png` }).catch(() => {});
  } finally {
    await page.keyboard.up('Control'); await page.keyboard.up('Shift');
    await page.mouse.up({ button: 'middle' }); await page.mouse.up({ button: 'right' });
  }
}
async function fixture(mixed = false) {
  await page.evaluate(mixed => {
    const data = id => ({ question: `区域节点 ${id}`, displayName: `区域节点 ${id}`,
      response: 'A stable answer for marquee region tests.', responses: ['A stable answer for marquee region tests.'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, isRoot: false, isBranch: false,
      highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 10, roleMode: 'inherit' });
    const nodes = (mixed ? [
      { id: 'a', x: 800, y: 250 }, { id: 'b', x: 800, y: 650 },
      { id: 'c', x: 1450, y: -100 }, { id: 'd', x: 1450, y: 1000 },
    ] : [
      { id: 'a', x: 850, y: 100 }, { id: 'b', x: 850, y: 650 },
      { id: 'c', x: 1700, y: 150 }, { id: 'd', x: 1700, y: 700 },
    ]).map(({ id, x, y }) => ({ id, type: 'thought', selected: false, position: { x, y }, width: 400, height: 240, data: data(id) }));
    const edges = [{ id: 'ab', source: 'a', target: 'b' }, { id: 'cd', source: 'c', target: 'd' }].map(edge => ({
      ...edge, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', data: { route: 'curve', label: mixed ? edge.id : '' },
    }));
    window.__canvasEditing.getState().reset();
    window.__canvasEditing.getState().setSelectionTarget(mixed ? 'nodes' : 'edges');
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    window.__ui.setState({ panelOpen: false, panelNodeId: null, tutorialOpen: false, releaseNotesOpen: false, autoRefreshPaused: true, drafts: {} });
  }, mixed);
  await page.waitForTimeout(650);
  await page.evaluate(() => window.__rf.setViewport({ x: 80, y: 70, zoom: 0.55 }, { duration: 0 }));
  await page.waitForFunction(() => window.__store.getState().nodes.every(item => item.measured?.width && item.measured?.height));
  await page.waitForTimeout(180);
}
async function linePoint(id, fraction = 0.5) {
  return page.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`).evaluate((path, fraction) => {
    const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM());
    return { x: point.x, y: point.y };
  }, fraction);
}
async function marquee(rect) {
  await page.mouse.move(rect.x, rect.y); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width, rect.y + rect.height, { steps: 12 }); await page.mouse.up();
  await page.locator('[data-selection-region]').waitFor();
  await page.waitForTimeout(120);
  const box = await page.locator('[data-selection-region]').boundingBox(); assert.ok(box);
  for (const key of ['x', 'y', 'width', 'height']) near(box[key], rect[key], `confirmed region ${key}`);
}
async function lineMarquee() {
  const p = await linePoint('ab');
  await marquee({ x: p.x - 24, y: p.y - 24, width: 48, height: 48 });
  await selected([], ['ab']);
}
async function mixedMarquee() {
  const a = await node('a').boundingBox(), b = await node('b').boundingBox(), p = await linePoint('cd');
  assert.ok(a && b);
  const x = Math.min(a.x, b.x) - 12, y = Math.min(a.y, b.y) - 12;
  await marquee({ x, y, width: Math.max(a.x + a.width, b.x + b.width, p.x) + 24 - x,
    height: Math.max(a.y + a.height, b.y + b.height) + 12 - y });
  await selected(['a', 'b'], []);
}
async function assertProjection(saved) {
  assert.deepEqual(await region(), saved, 'Viewport changes must keep the canvas-space region intact');
  const vp = await viewport(), box = await page.locator('[data-selection-region]').boundingBox();
  const canvas = await page.locator('.react-flow').boundingBox(); assert.ok(box && canvas);
  near(box.x, canvas.x + vp.x + saved.rect.x * vp.zoom, 'projected x');
  near(box.y, canvas.y + vp.y + saved.rect.y * vp.zoom, 'projected y');
  near(box.width, saved.rect.width * vp.zoom, 'projected width');
  near(box.height, saved.rect.height * vp.zoom, 'projected height');
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5198', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__canvasEditing);
  await probe('line-only marquee remains after release and survives switching through an empty node selection', async () => {
    await fixture(); await lineMarquee();
    const saved = await region(); assert.deepEqual(saved.nodeIds, []); assert.deepEqual(saved.edgeIds, ['ab']);
    await choose('nodes'); await selected([], []);
    assert.deepEqual(await region(), saved); await page.locator('[data-selection-region]').waitFor();
    await choose('edges'); await selected([], ['ab']); assert.deepEqual(await region(), saved);
    await page.screenshot({ path: `${output}/line-only.png` });
  });
  await probe('switching a confirmed scope selects crossing lines and enclosed nodes rather than line endpoints', async () => {
    await fixture(true); await mixedMarquee();
    const saved = await region(); assert.deepEqual([...saved.nodeIds].sort(), ['a', 'b']); assert.deepEqual([...saved.edgeIds].sort(), ['ab', 'cd']);
    await choose('edges'); await selected([], ['ab', 'cd']); assert.deepEqual(await region(), saved);
    await choose('nodes'); await selected(['a', 'b'], []); assert.deepEqual(await region(), saved);
    await choose('edges'); await selected([], ['ab', 'cd']);
    await page.screenshot({ path: `${output}/mixed-scope.png` });
  });
  await probe('the retained rectangle follows zoom and pan without changing its selection candidates', async () => {
    await fixture(); await lineMarquee(); const saved = await region();
    await page.evaluate(() => window.__rf.setViewport({ x: 170, y: 35, zoom: 0.7 }, { duration: 0 }));
    await assertProjection(saved); await selected([], ['ab']);
    await choose('nodes'); await selected([], []); await assertProjection(saved);
    await choose('edges'); await selected([], ['ab']); await assertProjection(saved);
  });
  await probe('middle and right dragging within the retained region pan the canvas while preserving the selection', async () => {
    await fixture(); await lineMarquee(); const saved = await region();
    for (const button of ['middle', 'right']) {
      const box = await page.locator('[data-selection-region]').boundingBox(); assert.ok(box);
      const p = { x: box.x + 5, y: box.y + 5 }, before = await viewport();
      await page.mouse.move(p.x, p.y); await page.mouse.down({ button });
      await page.mouse.move(p.x + 48, p.y + 32, { steps: 12 }); await page.mouse.up({ button });
      await page.waitForTimeout(120);
      const after = await viewport(); near(after.x, before.x + 48, `${button} pan x`); near(after.y, before.y + 32, `${button} pan y`);
      assert.equal(after.zoom, before.zoom); await selected([], ['ab']); await assertProjection(saved);
    }
  });
  await probe('line draft and original values survive object type switches; Escape cancels the draft before the region', async () => {
    await fixture(true); await mixedMarquee(); await choose('edges'); await selected([], ['ab', 'cd']);
    const saved = await region(), before = await wiring();
    await page.locator('[data-batch-edge-label]').fill('保留的区域草稿');
    await choose('nodes'); await selected(['a', 'b'], []); assert.deepEqual(await region(), saved);
    await choose('edges'); await selected([], ['ab', 'cd']);
    assert.equal(await page.locator('[data-batch-edge-label]').inputValue(), '保留的区域草稿');
    assert.deepEqual(await wiring(), before); assert.deepEqual(await region(), saved);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-batch-edge-label]').inputValue(), '');
    await selected([], ['ab', 'cd']); assert.deepEqual(await region(), saved); assert.deepEqual(await wiring(), before);
    await page.keyboard.press('Escape');
    await selected([], []); assert.equal(await region(), null); assert.equal(await page.locator('[data-selection-region]').count(), 0);
  });
  await probe('clicking blank canvas clears the retained rectangle and both selection types', async () => {
    await fixture(); await lineMarquee();
    await page.mouse.click(1450, 870); await selected([], []);
    assert.equal(await region(), null); assert.equal(await page.locator('[data-selection-region]').count(), 0);
    await lineMarquee(); await choose('nodes'); await selected([], []);
    await page.keyboard.press('Escape'); assert.equal(await region(), null);
    assert.equal(await page.locator('[data-selection-region]').count(), 0);
  });
  await probe('line-region gaps retain the scope and clicking an outside line selects the new target', async () => {
    await fixture(); await lineMarquee();
    const saved = await region(), box = await page.locator('[data-selection-region]').boundingBox(); assert.ok(box);
    const gap = { x: box.x + 8, y: box.y + 8 };
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.classList.contains('react-flow__pane'), gap), true,
      'The retained rectangle leaves its empty area available to canvas gestures');
    await page.mouse.click(gap.x, gap.y); await selected([], ['ab']); assert.deepEqual(await region(), saved);
    const other = await linePoint('cd');
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.closest('.react-flow__edge')?.getAttribute('data-id'), other), 'cd',
      'The direct click targets the outside SVG line');
    await page.mouse.click(other.x, other.y);
    await selected([], ['cd']); assert.equal(await region(), null);
  });
  await probe('Ctrl-clicking a line within the retained region changes exact membership and releases the scope', async () => {
    await fixture(true); await mixedMarquee(); await choose('edges'); await selected([], ['ab', 'cd']);
    const p = await linePoint('cd', 0.35);
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.closest('.react-flow__edge')?.getAttribute('data-id'), p), 'cd',
      'The Ctrl-click targets the selected SVG line');
    await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control');
    await selected([], ['ab']); assert.equal(await region(), null, 'Changing the exact selected set releases the original scope');
    await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control');
    await selected([], ['ab', 'cd']);
  });
  await probe('canvas Tab navigation releases the line region and selects one node without leftover lines', async () => {
    await fixture(); await lineMarquee();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.keyboard.press('Tab'); await selected(['a'], []);
    assert.equal(await region(), null); assert.equal(await page.locator('[data-selection-region]').count(), 0);
  });
  assert.deepEqual(errors, [], 'No browser errors'); assert.deepEqual(writes, [], 'No API writes');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes }, null, 2));
  console.log(`${checks.length} selection region checks passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
} catch (error) {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
