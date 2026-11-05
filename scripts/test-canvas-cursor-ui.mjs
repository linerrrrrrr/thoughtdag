// Pointer promises are checked at the actual hit target, then exercised with real mouse gestures.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const output = 'local-tests/canvas-cursor';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
await context.routeWebSocket(/.*/, socket => socket.close());
const checks = [], failures = [], errors = [], writes = [];
await context.route('**/api/**', route => {
  const request = route.request(), url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`);
  if (url.pathname === '/api/models') return route.fulfill({ json: {
    models: [{ id: 'test/cursor', name: 'Local fixture', provider: 'test', vision: false }], default: 'test/cursor',
  } });
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', error => errors.push(error.message));
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const positions = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position }) => ({ id, ...position })));
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);

async function probe(label, run) {
  try { await run(); checks.push(label); console.log(`PASS ${label}`); }
  catch (error) {
    failures.push({ label, error: String(error) });
    console.error(`FAIL ${label}: ${error}`);
    await page.screenshot({ path: `${output}/failure-${failures.length}.png` }).catch(() => {});
  } finally {
    await page.mouse.up();
    await page.mouse.up({ button: 'middle' });
    await page.keyboard.up('Space');
  }
}

async function fixture({ zoom = 1, theme = 'light', detail = 'full', disabled = false } = {}) {
  await page.keyboard.press('Escape');
  await page.mouse.move(1500, 1000);
  await page.evaluate(async ({ zoom, theme, detail, disabled }) => {
    document.activeElement?.blur();
    window.getSelection()?.removeAllRanges();
    const data = (question, extra = {}) => ({ question,
      response: 'Readable answer text remains selectable while the header moves the card. [Reference](https://example.com/reference)',
      responses: ['Readable answer text remains selectable while the header moves the card. [Reference](https://example.com/reference)'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, isRoot: false, isBranch: false,
      highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 24, roleMode: 'inherit',
      detailLevel: detail, ...extra });
    const nodes = [
      { id: 'frame', position: { x: 80, y: 100 }, width: 1200, height: 780,
        data: data('材料与引用', { stepKind: 'frame', frameCarry: true }) },
      { id: 'note', position: { x: 130, y: 190 }, width: 440, height: 310,
        data: data('# 我的收藏夹体检\n\nSelectable material text keeps its reading behavior.\n\n[Reference](https://example.com/reference)', { stepKind: 'note', response: '', responses: [], responseIndex: -1 }) },
      { id: 'thought', position: { x: 680, y: 190 }, width: 440, height: 450,
        data: data('How should this material be used?', { displayName: '整理结果', displaySummary: '阅读正文和拖动卡片使用不同区域。' }) },
    ].map(item => ({ ...item, type: 'thought', dragHandle: '.drag-handle', draggable: !disabled, selected: false }));
    const edges = [{ id: 'note-thought', source: 'note', target: 'thought', type: 'smoothstep',
      sourceHandle: 'source-right', targetHandle: 'target-left', data: { route: 'curve' } }];
    window.__canvasEditing.getState().reset();
    window.__ui.setState({ panelOpen: false, panelNodeId: null, readerNodeId: null, tutorialOpen: false,
      releaseNotesOpen: false, autoRefreshPaused: true, drafts: {}, canvasDetail: detail,
      condenseRun: { status: 'idle', current: 0, total: 0, streaming: '', originalIds: [], distillIds: [] } });
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges }], historyIndex: 0 });
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
    window.__rf.setViewport({ x: zoom === 1 ? 40 : 120, y: zoom === 1 ? 20 : 100, zoom }, { duration: 0 });
  }, { zoom, theme, detail, disabled });
  await node('thought').waitFor();
  await page.waitForFunction(() => window.__store.getState().nodes.every(item => item.measured?.width && item.measured?.height));
  await page.waitForTimeout(250);
  // The one-time fit on first render must finish before screen coordinates are sampled.
  await page.evaluate(zoom => window.__rf.setViewport({ x: zoom === 1 ? 40 : 120, y: zoom === 1 ? 20 : 100, zoom }, { duration: 0 }), zoom);
  await settle();
}

async function point(locator, fx = .5, fy = .5) {
  const box = await locator.boundingBox();
  assert.ok(box, 'The interaction target is rendered');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function cursorAt(at, expected, label, selector) {
  await page.mouse.move(at.x, at.y);
  await settle();
  const hit = await page.evaluate(({ x, y, selector }) => {
    const element = document.elementFromPoint(x, y);
    return { cursor: element && getComputedStyle(element).cursor, tag: element?.tagName,
      className: element?.getAttribute('class'), matches: !selector || !!element?.closest(selector) };
  }, { ...at, selector });
  assert.ok(hit.matches, `${label} hit the wrong target: ${JSON.stringify(hit)}`);
  assert.equal(hit.cursor, expected, `${label}: ${JSON.stringify(hit)}`);
}

async function drag(at, dx = 72, dy = 30, during) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await settle();
  if (during) await during({ x: at.x + dx, y: at.y + dy });
  await page.mouse.up();
  await settle();
}

function moved(before, after, ids, dx, dy, zoom) {
  for (const original of before) {
    const current = after.find(item => item.id === original.id);
    assert.ok(current, `Node ${original.id} still exists`);
    if (!ids.includes(original.id)) { assert.deepEqual(current, original); continue; }
    // React Flow consumes the first subthreshold movement while starting its drag.
    near(current.x - original.x, dx / zoom, 8 / zoom, `${original.id} horizontal drag`);
    near(current.y - original.y, dy / zoom, 5 / zoom, `${original.id} vertical drag`);
  }
}

async function dragNode(id, selector, ids, zoom, fx = .6, fy = .5) {
  const at = await point(node(id).locator(selector).first(), fx, fy);
  await cursorAt(at, 'grab', `${id} drag target`, '.drag-handle');
  const before = await positions();
  await drag(at, 72, 30, async current => {
    await cursorAt(current, 'grabbing', `${id} active drag`);
    assert.equal(await node(id).evaluate(element => element.classList.contains('dragging')), true);
  });
  moved(before, await positions(), ids, 72, 30, zoom);
  const released = await point(node(id).locator(selector).first(), fx, fy);
  // Selecting a frame exposes its border resizer. That new hit target may
  // own the pointer after release, but must not change the active move cursor.
  const resizeLine = selector === '[data-frame-border]' && await page.evaluate(({ x, y }) =>
    !!document.elementFromPoint(x, y)?.closest('.react-flow__resize-control.bottom'), released);
  await cursorAt(released, resizeLine ? 'ns-resize' : 'grab', `${id} released drag`);
}

async function selectText(id, selector) {
  const target = node(id).locator(selector).first();
  const range = await target.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if ((text.textContent?.length ?? 0) < 30) continue;
      const range = document.createRange();
      range.setStart(text, 1); range.setEnd(text, 2);
      const start = range.getBoundingClientRect();
      range.setStart(text, 23); range.setEnd(text, 24);
      const end = range.getBoundingClientRect();
      return { start: { x: start.x, y: start.y + start.height / 2 }, end: { x: end.x, y: end.y + end.height / 2 } };
    }
    return null;
  });
  assert.ok(range, 'Fixture has enough text to exercise selection');
  await cursorAt(range.start, 'text', `${id} readable text`);
  const before = await positions(), camera = await viewport();
  await drag(range.start, range.end.x - range.start.x, range.end.y - range.start.y);
  assert.ok((await page.evaluate(() => window.getSelection()?.toString() ?? '')).length >= 8, `${id} text is actually selected`);
  assert.deepEqual(await positions(), before, `${id} text selection does not move nodes`);
  assert.deepEqual(await viewport(), camera, `${id} text selection does not pan the canvas`);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5201', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__canvasEditing);
  for (const theme of ['light', 'dark']) for (const zoom of [1, .65]) {
    const label = `${theme} at ${zoom} zoom`;
    await probe(`${label}: headers and frame border promise and perform dragging`, async () => {
      await fixture({ theme, zoom });
      await dragNode('thought', '[data-node-details-header]', ['thought'], zoom);
      await fixture({ theme, zoom });
      await dragNode('note', '.material-header', ['note'], zoom);
      await fixture({ theme, zoom });
      await dragNode('frame', '[data-frame-header]', ['frame', 'note', 'thought'], zoom, .45);
      await fixture({ theme, zoom });
      await dragNode('frame', '[data-frame-border]', ['frame', 'note', 'thought'], zoom, .5);
    });

    await probe(`${label}: body text, padding, links, buttons and canvas have distinct cursors`, async () => {
      await fixture({ theme, zoom });
      await selectText('thought', '.conversation-answer p');
      await fixture({ theme, zoom });
      await selectText('note', '[data-content-body] .markdown-body p');
      await fixture({ theme, zoom });
      await cursorAt(await point(node('thought').locator('[data-thought-body]'), .01, .1), 'default', 'Conversation body padding');
      await cursorAt(await point(node('note').locator('[data-content-body]').locator('..'), .01, .5), 'default', 'Material body padding');
      await cursorAt(await point(node('thought').locator('.conversation-answer a').first()), 'pointer', 'Reference link', 'a');
      await cursorAt(await point(node('thought').locator('[data-node-metadata-toggle]')), 'pointer', 'Metadata edit action', 'button');
      const frame = await node('frame').boundingBox();
      await cursorAt({ x: frame.x + frame.width - 25 * zoom, y: frame.y + frame.height * .7 }, 'crosshair', 'Frame interior', '.react-flow__pane');
      await cursorAt({ x: 1470, y: 900 }, 'crosshair', 'Empty canvas', '.react-flow__pane');
      await page.screenshot({ path: `${output}/${theme}-${zoom}.png` });
    });

    await probe(`${label}: header button gestures never move their node`, async () => {
      for (const [id, selector] of [['thought', '[data-node-details]'], ['note', '[data-note-edit]'], ['frame', '[data-frame-carry-toggle]']]) {
        await fixture({ theme, zoom });
        const at = await point(node(id).locator(selector));
        await cursorAt(at, 'pointer', `${id} header button`, 'button');
        const before = await positions();
        await drag(at, -65, 14);
        assert.deepEqual(await positions(), before, `${id} button must not initiate node drag`);
      }
    });
  }

  for (const detail of ['summary', 'compact']) await probe(`${detail}: overview drag targets retain the same promise`, async () => {
    await fixture({ detail, zoom: .65 });
    await dragNode('note', '.drag-handle', ['note'], .65, .55, .65);
    await fixture({ detail, zoom: .65 });
    await dragNode('thought', '[data-node-details-header]', ['thought'], .65, .6, .5);
  });

  await probe('Compact material connection ports keep their crosshair inside the drag surface', async () => {
    await fixture({ detail: 'compact', zoom: .65 });
    await node('note').locator('.drag-handle').hover();
    const port = node('note').locator('[data-connection-role="source"][data-connection-side="bottom"]');
    await cursorAt(await point(port), 'crosshair', 'Compact material source port', '.react-flow__handle');
  });

  await probe('Multi-selection owns dragging and resize cursors across the entire selected region', async () => {
    await fixture({ zoom: .65 });
    await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['note', 'thought']));
    await page.locator('[data-selection-move]').waitFor();
    const at = await point(page.locator('[data-selection-move]'), .5, .5);
    await cursorAt(at, 'grab', 'Multi-selection interior', '[data-selection-move]');
    const before = await positions();
    await drag(at, 48, 24, at => cursorAt(at, 'grabbing', 'Moving multi-selection'));
    moved(before, await positions(), ['note', 'thought'], 48, 24, .65);
    await cursorAt(await point(page.locator('[data-selection-resize="both"]')), 'nwse-resize', 'Multi-selection resize');
  });

  await probe('Disabled node dragging does not leave a grab cursor on headers or overviews', async () => {
    for (const detail of ['full', 'compact']) {
      await fixture({ disabled: true, detail });
      for (const id of ['thought', 'note', 'frame']) {
        const at = await point(node(id).locator('.drag-handle').first(), .55, .5);
        await cursorAt(at, 'default', `${id} disabled header`);
        const before = await positions();
        await drag(at, 40, 20);
        assert.deepEqual(await positions(), before);
      }
    }
  });

  await probe('Layout preview suppresses dragging promises and mutations', async () => {
    await fixture();
    await page.evaluate(() => window.__canvasEditing.getState().setLayoutPreview(window.__store.getState().nodes));
    await settle();
    const at = await point(node('thought').locator('[data-node-details-header]'), .6, .5);
    await cursorAt(at, 'default', 'Layout preview header');
    const before = await positions();
    await drag(at, 40, 20);
    assert.deepEqual(await positions(), before);
  });

  await probe('Condense build disables node and multi-selection grab surfaces until it finishes', async () => {
    await fixture();
    await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['note', 'thought']));
    await page.locator('[data-selection-move]').waitFor();
    await page.evaluate(() => window.__ui.getState().setCondenseRun({ status: 'building', total: 1 }));
    await page.locator('[data-selection-move]').waitFor({ state: 'detached' });
    const before = await positions();
    const at = await point(node('thought').locator('[data-node-details-header]'), .6, .5);
    await cursorAt(at, 'default', 'Locked header during condense');
    await drag(at, 60, 24);
    assert.deepEqual(await positions(), before);
    await page.evaluate(() => {
      window.__ui.getState().setCondenseRun({ status: 'idle' });
      window.__store.getState().setSelectedNodeIds(['note', 'thought']);
    });
    await page.locator('[data-selection-move]').waitFor();
    await cursorAt(await point(page.locator('[data-selection-move]')), 'grab', 'Restored multi-selection');
  });

  await probe('Read-only viewer removes node grab cursors while its canvas really pans', async () => {
    await fixture();
    const payload = await page.evaluate(() => {
      const state = window.__store.getState();
      return { nodes: state.nodes, edges: state.edges };
    });
    const hash = deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
    // A changed query loads a fresh document without racing the app's hashchange reload.
    const viewerUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5201');
    viewerUrl.searchParams.set('cursor-viewer-test', '1');
    viewerUrl.hash = `view=${hash}`;
    await page.goto(viewerUrl.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__rf && window.__store?.getState().nodes.some(item => item.id === 'thought'));
    await page.evaluate(() => {
      window.__ui.setState({ tutorialOpen: false, releaseNotesOpen: false, panelOpen: false });
      window.__rf.setViewport({ x: 40, y: 20, zoom: 1 }, { duration: 0 });
    });
    await settle();
    for (const id of ['thought', 'note', 'frame']) {
      const at = await point(node(id).locator('.drag-handle').first(), .6, .5);
      await cursorAt(at, 'default', `${id} viewer header`);
    }
    const before = await positions(), camera = await viewport();
    const at = { x: 1470, y: 900 };
    await cursorAt(at, 'grab', 'Read-only canvas pan', '.react-flow__pane');
    await drag(at, 48, 28, current => cursorAt(current, 'grabbing', 'Active viewer pan'));
    const after = await viewport();
    near(after.x - camera.x, 48, 1, 'Viewer pan x');
    near(after.y - camera.y, 28, 1, 'Viewer pan y');
    assert.deepEqual(await positions(), before, 'Viewer pans without changing graph geometry');
  });

  assert.deepEqual(writes, [], 'Pointer gestures never issue API writes');
  assert.deepEqual(errors, [], 'No browser errors');
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes }, null, 2));
  await browser.close();
}
assert.deepEqual(failures, [], `${failures.length} cursor/gesture regression checks failed; see ${output}/results.json`);
console.log(`PASS ${checks.length} canvas cursor/gesture scenarios`);
