// Content-bounded node resizing in the real canvas. Uses isolated fixtures and no LLM calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5175');
const output = 'local-tests/node-content-height';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const checks = [], errors = [], writes = [], measurements = [];
const id = 'content-height-fixture';
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), url: url.href });
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

const check = label => { checks.push(label); console.log('PASS', label); };
const near = (a, b, label, tolerance = 2) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} versus ${b}`);
const node = () => page.locator(`.react-flow__node[data-id="${id}"]`);
const handle = direction => node().locator(`[data-node-resize="${direction}"]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const read = () => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id), id);
const limit = () => page.evaluate(id => window.__contentHeight.getNodeContentHeightLimit(id), id);
const patch = data => page.evaluate(({ id, data }) => window.__store.setState(state => ({ nodes: state.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n) })), { id, data });
const format = patch => page.evaluate(({ id, patch }) => window.__store.getState().setSelectionGeometry([id], patch), { id, patch });
const frame = async zoom => {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 70, y: 160, zoom }, { duration: 0 }), zoom);
  await page.evaluate(async ({ id, zoom }) => {
    let previous, stable = 0;
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const rect = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect();
      const next = rect && [rect.x, rect.y, rect.width, rect.height];
      if (next && previous && Math.abs(window.__rf.getZoom() - zoom) < .0001 && next.every((n, j) => Math.abs(n - previous[j]) < .05)) stable++;
      else stable = 0;
      if (stable >= 2) return;
      previous = next;
    }
    throw new Error('Canvas geometry did not stabilize');
  }, { id, zoom });
};
const inspect = () => node().evaluate(el => {
  const root = el.querySelector('.conversation-node');
  const split = root.querySelector('[data-conversation-split="node"]');
  const pane = attribute => {
    const item = split.querySelector(`[${attribute}]`), content = item.querySelector('.conversation-split-content');
    return { client: item.clientHeight, scroll: item.scrollHeight, content: content.offsetHeight };
  };
  return { outer: root.offsetHeight, reading: split.offsetHeight,
    question: pane('data-conversation-split-question'), answer: pane('data-conversation-split-answer') };
});
const fullyVisible = async label => {
  const measured = await inspect();
  for (const key of ['question', 'answer']) assert.ok(measured[key].scroll <= measured[key].client + 1, `${label}: ${key} still overflows ${JSON.stringify(measured)}`);
  return measured;
};
const startDrag = async (direction, dx, dy) => {
  await handle(direction).hover();
  const rect = await handle(direction).boundingBox();
  assert.ok(rect, 'Resize control is visible');
  await handle(direction).evaluate(el => el.addEventListener('pointerdown', event => { el.__testPointerId = event.pointerId; }, { once: true }));
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await settle();
  return { x, y };
};
const drag = async (direction, dx, dy) => {
  await startDrag(direction, dx, dy);
  await page.mouse.up();
  await settle();
};
const seed = async (question, response, ratio = .35) => {
  await page.evaluate(({ id, question, response, ratio }) => {
    const nodes = [{ id, type: 'thought', dragHandle: '.drag-handle', selected: true, position: { x: 0, y: 0 }, width: 600, height: 280, data: {
      question, response, responses: [response], responseIndex: 0, questionHeightRatio: ratio,
      detailLevel: 'full', isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      tokenCount: 0, roleMode: 'inherit', isRoot: false, isBranch: false,
    } }];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [id], selectedNodeId: id, history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__ui.getState().setCanvasDetail('full');
  }, { id, question, response, ratio });
  await node().waitFor();
  await page.waitForFunction(id => Number.isFinite(window.__contentHeight.getNodeContentHeightLimit(id)), id);
  await settle();
  await page.waitForTimeout(350);
  await frame(.7);
};
const growToLimit = async label => {
  const cap = Math.max(240, await limit());
  const current = await read();
  const zoom = Math.min(.8, 700 / cap);
  await frame(zoom);
  const original = await startDrag('height', 0, (cap - current.height + 90) * zoom);
  const capped = await read();
  near(capped.height, cap, `${label}: drag reaches content cap`);
  await page.mouse.move(original.x, original.y + (cap - current.height + 220) * zoom, { steps: 4 });
  await settle();
  near((await read()).height, capped.height, `${label}: continuing to drag does not increase height`);
  await page.mouse.up();
  await settle();
  assert.deepEqual((await read()).position, current.position, `${label}: resize does not move the node`);
  const visible = await fullyVisible(label);
  measurements.push({ label, cap, height: capped.height, visible });
  return cap;
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async () => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    window.__ui = (await window.__importLive('/src/lib/ui-store.ts')).useUiStore;
    window.__contentHeight = await window.__importLive('/src/lib/node-content-height.ts');
  });
  await seed('一个简短问题。', '一段简短回答。');
  const shortCap = await growToLimit('short turn');
  assert.ok(shortCap < 600);
  check('A short turn stops growing once both panes show their full content');

  const q = Array.from({ length: 3 }, (_, i) => `问题 ${i + 1}：说明指标定义、来源与适用范围，并解释其中的条件。`).join('\n\n');
  const a = Array.from({ length: 6 }, (_, i) => `回答 ${i + 1}：这段内容用于验证节点在全部文字可见时停止增高，同时保持问题与回答之间设定的比例。`).join('\n\n');
  await seed(q, a);
  const longCap = await growToLimit('long turn');
  assert.ok(longCap > shortCap + 200);
  check('Long question/answer turns use their actual rendered content ceiling');

  await handle('height').focus();
  await page.keyboard.press('ArrowDown');
  near((await read()).height, longCap, 'Keyboard cannot grow past the cap');
  await page.keyboard.press('ArrowUp');
  near((await read()).height, longCap - 1, 'Keyboard can still shrink from the cap');
  await page.evaluate(() => window.__store.getState().undo());
  near((await read()).height, longCap, 'One undo restores the keyboard resize');
  await page.evaluate(() => window.__store.getState().redo());
  near((await read()).height, longCap - 1, 'One redo restores the keyboard resize');
  check('Keyboard height edits respect the cap and preserve undo/redo');

  await format({ height: longCap - 100 });
  const beforeCancel = (await read()).height;
  await frame(Math.min(.8, 700 / longCap));
  await startDrag('height', 0, 40);
  assert.ok((await read()).height > beforeCancel);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  near((await read()).height, beforeCancel, 'Escape cancels the resize');
  await startDrag('height', 0, 40);
  await handle('height').evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: el.__testPointerId, pointerType: 'mouse' })));
  await page.mouse.up();
  near((await read()).height, beforeCancel, 'Pointer cancellation restores the original height');
  check('Escape and pointer cancellation preserve content-bounded resize behavior');

  await format({ height: 280 });
  await page.evaluate(id => window.__store.getState().setQuestionHeightRatio(id, .7), id);
  await settle();
  const changedRatioCap = await growToLimit('changed ratio');
  near(changedRatioCap, longCap, 'The full-content sum is independent of the requested split ratio');
  check('Changing the ratio preserves the same full-content height without creating pane whitespace');

  await patch({ response: `${a}\n\n${a}`, responses: [`${a}\n\n${a}`] });
  await settle();
  const appendedCap = await limit();
  assert.ok(appendedCap > changedRatioCap + 200);
  await format({ height: 100000 });
  near((await read()).height, appendedCap, 'Property action uses the updated long-content ceiling');
  await fullyVisible('appended content');
  await patch({ question: '删减后的问题。', response: '删减后的回答。', responses: ['删减后的回答。'] });
  await settle();
  const deletedCap = await limit();
  assert.ok(deletedCap < appendedCap - 200);
  await page.waitForFunction(({ id, cap }) => window.__store.getState().nodes.find(n => n.id === id).height <= cap + 2, { id, cap: deletedCap });
  near((await read()).height, deletedCap, 'Deleting content tightens an existing oversized card');
  await format({ height: 240 });
  await format({ height: 100000 });
  near((await read()).height, deletedCap, 'Fresh growth uses the shortened content ceiling');
  await fullyVisible('deleted content');
  check('Appending and deleting prose refresh the cap without changing the conversation');

  await seed(q, a, .35);
  const narrowBefore = await limit();
  await format({ width: 360, height: 280 });
  await settle();
  const narrower = await limit();
  assert.ok(narrower > narrowBefore, `${narrower} versus ${narrowBefore}`);
  await format({ height: 100000 });
  near((await read()).height, narrower, 'Narrower width updates the wrapped-content ceiling');
  await fullyVisible('narrower content');
  check('Width changes refresh the ceiling using the newly wrapped text');

  await format({ height: 300 });
  await frame(.55);
  const beforeZoom = await read();
  const beforeBox = await node().boundingBox();
  await drag('height', 0, 33);
  near((await read()).height, beforeZoom.height + 60, 'Screen delta is converted once at canvas zoom');
  const afterBox = await node().boundingBox();
  near(afterBox.height - beforeBox.height, 33, 'Visible height follows pointer movement', 1);
  await page.evaluate(() => window.__store.getState().undo());
  near((await read()).height, beforeZoom.height, 'Zoomed resize has one undo step');
  check('Zoomed resizing stays accurate below the cap and remains undoable');

  await format({ width: 600, height: 280 });
  await settle();
  const formatCap = await limit();
  await frame(.7);
  await page.locator('[data-node-format-panel]').waitFor();
  const reopen = page.locator('[data-node-format-reopen]');
  if (await reopen.isVisible()) await reopen.click();
  const heightField = page.locator('[data-node-format-field="height"]');
  await heightField.fill(String(Math.ceil(formatCap + 500)));
  await heightField.press('Enter');
  assert.ok((await read()).height <= formatCap + 1, 'Oversized typed height cannot exceed the content cap');
  await heightField.fill(String(Math.floor(formatCap)));
  await heightField.press('Enter');
  near((await read()).height, Math.floor(formatCap), 'Typing the legal maximum applies normally');
  await fullyVisible('typed height');
  await page.mouse.move(10, 110);
  await page.screenshot({ path: `${output}/content-cap.png` });
  check('Selection properties apply the same full-content height limit');

  await format({ height: 280 });
  const beforeCorner = await read();
  const cornerCap = await limit();
  const cornerZoom = Math.min(.7, 700 / cornerCap);
  await frame(cornerZoom);
  await drag('both', 0, (cornerCap - beforeCorner.height + 100) * cornerZoom);
  near((await read()).height, cornerCap, 'Corner resizing also stops at the content cap');
  near((await read()).width, beforeCorner.width, 'Vertical corner resizing preserves unlocked width');
  await fullyVisible('corner height');
  check('Corner resizing follows the same content limit as the height edge');

  assert.deepEqual(writes, [], 'Resizing never sends mutating API requests');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  check('All content-limit interactions finish without API side effects or runtime errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, measurements, errors, writes }, null, 2));
  console.log(`${checks.length} content height checks passed.`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, measurements, errors, writes, failure: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
