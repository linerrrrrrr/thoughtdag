// Browser acceptance for the question/answer height splitter.
// Run against Vite; APP_URL and CHROME_PATH override the local defaults.
// The isolated browser uses fixtures and blocks all API and external requests.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/conversation-split';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const checks = [], errors = [], apiWrites = [], measurements = [];
const check = label => { checks.push(label); console.log('PASS', label); };
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) apiWrites.push({ method: request.method(), url: url.href });
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  if (!localStorage.getItem('thoughtdag.lang')) localStorage.setItem('thoughtdag.lang', 'zh');
});

const nodeId = 'conversation-split-fixture';
const node = () => page.locator(`.react-flow__node[data-id="${nodeId}"]`);
const split = surface => page.locator(`[data-conversation-split="${surface}"][data-conversation-node-id="${nodeId}"]`);
const divider = surface => split(surface).locator('[data-conversation-divider]');
const question = surface => split(surface).locator('[data-conversation-split-question]');
const answer = surface => split(surface).locator('[data-conversation-split-answer]');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const ratio = () => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id)?.data.questionHeightRatio, nodeId);
const patch = value => page.evaluate(({ id, value }) => window.__store.setState(state => ({
  nodes: state.nodes.map(n => n.id === id ? { ...n, ...value, data: { ...n.data, ...value.data } } : n),
})), { id: nodeId, value });
const geometry = async surface => {
  // Store actions can resolve before React commits the corresponding pane sizes.
  await settle();
  const boxes = await Promise.all([split(surface), question(surface), answer(surface), divider(surface), node()].map(locator => locator.boundingBox()));
  assert.ok(boxes.every(Boolean), `${surface}: all split regions are rendered`);
  const [whole, q, a, handle, card] = boxes;
  return { whole, q, a, handle, card };
};
const startDrag = async (surface, delta) => {
  const box = await divider(surface).boundingBox();
  assert.ok(box, `${surface}: divider is visible`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + delta, { steps: 8 });
  await settle();
};
const drag = async (surface, delta) => {
  await startDrag(surface, delta);
  await page.mouse.up();
  await settle();
};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
const openPanel = () => page.evaluate(async id => {
  const { useUiStore } = await import('/src/lib/ui-store.ts');
  window.__store.getState().setSelectedNodeId(id);
  useUiStore.getState().setPanelOpen(true, id);
}, nodeId);
const closePanel = () => page.evaluate(async () => (await import('/src/lib/ui-store.ts')).useUiStore.getState().setPanelOpen(false));
const resetScroll = surface => Promise.all([question(surface), answer(surface)].map(locator => locator.evaluate(el => { el.scrollTop = 0; })));

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async id => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    useUiStore.getState().setPanelOpen(false);
    const question = Array.from({ length: 26 }, (_, i) => `问题 ${i + 1}：解释这组指标的定义、来源和适用范围。Question ${i + 1}: describe the assumptions and source.`).join('\n\n');
    const response = Array.from({ length: 42 }, (_, i) => `回答 ${i + 1}：这段较长的说明用于验证两个区域能分别滚动，调整比例不会改变内容或执行生成。Answer ${i + 1}: the reading area preserves all content.`).join('\n\n');
    window.__store.getState().setNodes([{ id, type: 'thought', width: 620, height: 780,
      position: { x: 0, y: 0 }, style: { width: 620, height: 780 }, data: {
        question, response, responses: [response], responseIndex: 0, questionHeightRatio: .35,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        detailLevel: 'full', tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [],
        excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false,
      } }]);
    window.__store.getState().setEdges([]);
    window.__rf.setViewport({ x: 90, y: 130, zoom: 1 }, { duration: 0 });
  }, nodeId);
  await divider('node').waitFor({ state: 'visible' });
  // Initial graph measurement can still finish the app's animated fitView.
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 130, zoom: 1 }, { duration: 0 }));
  await settle();
  assert.equal(await divider('node').getAttribute('role'), 'separator');
  assert.equal(await divider('node').getAttribute('aria-orientation'), 'horizontal');
  assert.ok(await divider('node').getAttribute('aria-label'));
  assert.equal(await divider('node').locator('*').count(), 0);
  assert.equal(await divider('node').getAttribute('data-tooltip'), null);
  const quietLine = await divider('node').evaluate(el => ({
    outline: getComputedStyle(el).outlineStyle,
    height: getComputedStyle(el, '::before').height,
  }));
  assert.equal(quietLine.outline, 'none');
  assert.equal(quietLine.height, '1px');
  await divider('node').click();
  const clickedLine = await divider('node').evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
  assert.equal(clickedLine.outline, 'none', 'Pointer clicking adds no outline');
  assert.equal(clickedLine.shadow, 'none', 'Pointer clicking adds no shadow');
  await page.mouse.move(800, 1000);
  await page.waitForTimeout(150);
  near(Number(await divider('node').evaluate(el => getComputedStyle(el, '::before').opacity)), .5, .01, 'The line returns to its base opacity when the pointer leaves');
  check('The separator stays a quiet one-pixel line without a handle, tooltip, or outline capsule');
  const before = await geometry('node');
  await drag('node', 90);
  const after = await geometry('node');
  assert.ok(after.q.height > before.q.height + 60, JSON.stringify({ before, after }));
  assert.ok(after.a.height < before.a.height - 60);
  near(after.whole.height, before.whole.height, 1, 'Node reading height stays fixed');
  near(after.card.height, before.card.height, 1, 'Node outer height stays fixed');
  near(after.card.x, before.card.x, 1, 'Divider drag does not move the node horizontally');
  near(after.card.y, before.card.y, 1, 'Divider drag does not move the node vertically');
  measurements.push({ stage: 'node-drag', before, after, ratio: await ratio() });
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '');
  check('Node divider reallocates height without moving/resizing the card or selecting text');

  const completedRatio = await ratio();
  await page.evaluate(() => window.__store.getState().undo());
  near(await ratio(), .35, .0001, 'Completed reading resize is one undo step');
  await page.evaluate(() => window.__store.getState().redo());
  near(await ratio(), completedRatio, .0001, 'Completed reading resize can redo');
  check('Completed answer ratio changes support undo and redo');

  const cancelBefore = await geometry('node');
  const cancelRatio = await ratio();
  await divider('node').evaluate(el => el.addEventListener('pointerdown', event => { el.dataset.testPointerId = String(event.pointerId); }, { once: true }));
  await startDrag('node', 45);
  assert.ok((await geometry('node')).q.height > cancelBefore.q.height + 20);
  near(await ratio(), cancelRatio, .0001, 'Pointer preview does not persist before release');
  await divider('node').evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, pointerId: Number(el.dataset.testPointerId), isPrimary: true, pointerType: 'mouse',
  })));
  await page.mouse.up();
  await settle();
  near(await ratio(), cancelRatio, .0001, 'Pointer cancellation never persists the preview');
  near((await geometry('node')).q.height, cancelBefore.q.height, 1, 'Pointer cancellation restores the saved geometry');
  check('Pointer cancellation discards the resize preview');

  await resetScroll('node');
  const scroll = await split('node').evaluate(el => {
    const q = el.querySelector('[data-conversation-split-question]');
    const a = el.querySelector('[data-conversation-split-answer]');
    const dimensions = { question: [q.clientHeight, q.scrollHeight], answer: [a.clientHeight, a.scrollHeight] };
    q.scrollTop = 150;
    const questionOnly = [q.scrollTop, a.scrollTop];
    a.scrollTop = 210;
    return { dimensions, questionOnly, both: [q.scrollTop, a.scrollTop] };
  });
  assert.ok(scroll.dimensions.question[1] > scroll.dimensions.question[0]);
  assert.ok(scroll.dimensions.answer[1] > scroll.dimensions.answer[0]);
  assert.ok(scroll.questionOnly[0] > 0);
  assert.equal(scroll.questionOnly[1], 0);
  assert.equal(scroll.both[0], scroll.questionOnly[0]);
  assert.ok(scroll.both[1] > 0);
  check('Long questions and answers scroll independently');

  await resetScroll('node');
  await openPanel();
  await divider('panel').waitFor({ state: 'visible' });
  // The content-bounded panel resolves its available height through observers.
  // Let that initial layout settle before using the divider's pointer origin.
  await page.waitForTimeout(150);
  await settle();
  const sharedBefore = await ratio();
  const panelBefore = await geometry('panel');
  await drag('panel', -110);
  const panelAfter = await geometry('panel');
  assert.ok(panelAfter.q.height < panelBefore.q.height - 75);
  near(panelAfter.whole.height, panelBefore.whole.height, 1, 'Panel reading height stays fixed');
  assert.ok((await ratio()) < sharedBefore);
  near(Number(await divider('node').getAttribute('aria-valuenow')), Number(await divider('panel').getAttribute('aria-valuenow')), .1, 'Both surfaces expose the same ratio');
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds([]));
  await page.mouse.move(800, 1000);
  await page.screenshot({ path: `${outputDir}/node-and-panel.png` });
  check('Panel divider reallocates its remaining height and shares the per-node ratio');

  await divider('panel').focus();
  const arrowBefore = await ratio();
  await page.keyboard.press('ArrowDown');
  assert.equal(await divider('panel').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Keyboard focus remains a single line');
  assert.ok((await ratio()) > arrowBefore);
  await page.keyboard.press('ArrowUp');
  near(await ratio(), arrowBefore, .002, 'Arrow keys move in matching steps');
  await page.keyboard.press('Home');
  const minimum = await ratio();
  await page.keyboard.press('End');
  const maximum = await ratio();
  assert.ok(minimum >= .05 && maximum <= .95 && maximum > minimum);
  await page.keyboard.press('ArrowDown');
  near(await ratio(), maximum, .002, 'Keyboard cannot pass the maximum');
  await page.evaluate(id => window.__store.getState().setQuestionHeightRatio(id, .42), nodeId);
  check('Focusable separator supports arrow keys, Home/End, and bounded ratios');

  await divider('panel').dblclick();
  near(await ratio(), .35, .0001, 'Double-click restores the default ratio');
  await page.evaluate(() => window.__store.getState().undo());
  near(await ratio(), .42, .0001, 'Reset can be undone');
  await page.evaluate(() => window.__store.getState().redo());
  near(await ratio(), .35, .0001, 'Reset can be redone');
  check('Double-click resets the split and preserves undo/redo');

  await page.locator('[data-focus-panel] [data-edit-question]').click();
  const panelEditor = page.locator('[data-focus-panel] .focus-message-editor textarea').first();
  await panelEditor.fill('');
  await page.waitForTimeout(130);
  await settle();
  const escapeRatio = await ratio();
  const escapeBefore = await geometry('panel');
  await startDrag('panel', 55);
  assert.equal(await split('panel').evaluate(el => el.classList.contains('conversation-split--dragging')), true, 'A real drag starts even when the short editor is already content-capped');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  near(await ratio(), escapeRatio, .0001, 'Escape cancels only the pending drag');
  near((await geometry('panel')).q.height, escapeBefore.q.height, 1, 'Escape restores the saved panel ratio');
  assert.equal(await page.locator('[data-focus-panel]').isVisible(), true);
  assert.equal(await panelEditor.isVisible(), true);
  assert.equal(await panelEditor.inputValue(), '');
  await page.locator('[data-focus-panel] [data-edit-cancel]').click();
  check('Escape during a drag keeps the panel and active empty editor draft open');

  await closePanel();
  // Closing the dock can animate the canvas into its newly available width.
  await page.waitForTimeout(350);
  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 130, zoom: .6 }, { duration: 0 }));
  await settle();
  await page.waitForFunction(() => Math.abs(window.__rf.getZoom() - .6) < .001);
  const zoomBefore = await geometry('node');
  near(zoomBefore.card.width, 620 * .6, 1, 'Zoomed measurements use the final viewport');
  const ratioBeforeZoomDrag = await ratio();
  await drag('node', 48);
  const ratioAfterZoomDrag = await ratio();
  const zoomAfter = await geometry('node');
  near(ratioAfterZoomDrag - ratioBeforeZoomDrag, 48 / (zoomBefore.q.height + zoomBefore.a.height), .035, 'Zoomed node uses screen-space pointer delta');
  near(zoomAfter.whole.height, zoomBefore.whole.height, 1, 'Zoomed reading height stays fixed');
  near(zoomAfter.card.x, zoomBefore.card.x, 1, 'Zoomed drag does not pan/move the node');
  near(zoomAfter.card.y, zoomBefore.card.y, 1, 'Zoomed drag does not pan/move the node');
  check('Canvas zoom preserves accurate dragging and graph geometry');

  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 130, zoom: 1 }, { duration: 0 }));
  await resetScroll('node');
  await node().locator('[data-edit-question]').click();
  const editor = node().locator('[data-canvas-question-editor]');
  await editor.fill('保留这份问题草稿。\nDo not submit while resizing.');
  // Shortening the editor changes its content cap and moves the divider.
  await page.waitForTimeout(130);
  await settle();
  await drag('node', -30);
  assert.equal(await editor.inputValue(), '保留这份问题草稿。\nDo not submit while resizing.');
  assert.equal(await editor.isVisible(), true);
  assert.notEqual(await page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data.question, nodeId), await editor.inputValue());
  await page.keyboard.press('Escape');
  check('Resizing an active question editor preserves its draft without submitting');

  const persistedRatio = await ratio();
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 130, zoom: 1 }, { duration: 0 }));
  await divider('node').waitFor({ state: 'visible' });
  near(await ratio(), persistedRatio, .0001, 'Per-node ratio survives reload');
  await openPanel();
  await divider('panel').waitFor({ state: 'visible' });
  near(Number(await divider('node').getAttribute('aria-valuenow')), Number(await divider('panel').getAttribute('aria-valuenow')), .1, 'Reopened panel restores the ratio');
  check('IndexedDB persistence and reopening preserve the adjusted ratio');

  // Reload after selecting appearance/language so a simultaneous Vite source
  // edit cannot make a dynamically imported language store differ from the app.
  await page.evaluate(async () => {
    await (await import('/src/lib/persistence.ts')).flushPendingWrites();
    localStorage.setItem('thoughtdag.panelWidth', '380');
    localStorage.setItem('thoughtdag.lighting', 'dark');
    localStorage.setItem('thoughtdag.lang', 'en');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 130, zoom: 1 }, { duration: 0 }));
  await openPanel();
  await divider('panel').waitFor({ state: 'visible' });
  await settle();
  const narrow = await split('panel').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth,
    children: [...el.querySelectorAll('[data-conversation-split-question], [data-conversation-split-answer]')].map(pane => ({ width: pane.clientWidth, scrollWidth: pane.scrollWidth })) }));
  assert.ok(narrow.scrollWidth <= narrow.width + 1, JSON.stringify(narrow));
  assert.ok(narrow.children.every(pane => pane.scrollWidth <= pane.width + 1), JSON.stringify(narrow));
  assert.match(await divider('panel').getAttribute('aria-label'), /[A-Za-z]/);
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds([]));
  await page.mouse.move(800, 1000);
  await page.screenshot({ path: `${outputDir}/narrow-dark-english.png` });
  check('Narrow dark English panel keeps the divider and prose inside its width');

  const streamStart = Array.from({ length: 28 }, (_, i) => `Streaming paragraph ${i + 1}: keep the live tail visible and allow the reader to scroll back.`).join('\n\n');
  await patch({ data: { isLoading: true, response: streamStart } });
  await settle();
  const streamInitialScroll = await answer('panel').evaluate(el => el.scrollTop);
  assert.ok(streamInitialScroll > 0, 'The initial long stream follows its live tail');
  await patch({ data: { response: `${streamStart}\n\n${streamStart}` } });
  await settle();
  const streamLaterScroll = await answer('panel').evaluate(el => el.scrollTop);
  assert.ok(streamLaterScroll > streamInitialScroll + 100, 'New chunks keep the tail in view');
  await answer('panel').evaluate(el => { el.scrollTop = 0; });
  await settle();
  await patch({ data: { response: `${streamStart}\n\n${streamStart}\n\n${streamStart}` } });
  await settle();
  near(await answer('panel').evaluate(el => el.scrollTop), 0, 1, 'Scrolling back suspends automatic following');
  await answer('panel').evaluate(el => {
    const content = el.querySelector('.focus-response-section > .focus-assistant-message');
    el.scrollTop = Math.max(0, content.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight);
  });
  await settle();
  const resumedScroll = await answer('panel').evaluate(el => el.scrollTop);
  await patch({ data: { response: `${streamStart}\n\n${streamStart}\n\n${streamStart}\n\n${streamStart}` } });
  await settle();
  assert.ok((await answer('panel').evaluate(el => el.scrollTop)) > resumedScroll + 100, 'Returning to the tail resumes following');
  check('The answer pane follows live chunks, respects manual scrollback, and resumes at the tail');

  await closePanel();
  await patch({ data: { isLoading: true, response: 'Streaming chunk one.', questionHeightRatio: .4 } });
  await page.evaluate(id => window.__store.getState().setQuestionHeightRatio(id, .62), nodeId);
  await patch({ data: { response: 'Streaming chunk two remains live.' } });
  await page.evaluate(() => window.__store.getState().undo());
  near(await ratio(), .4, .0001, 'A streaming ratio change can undo');
  let streaming = await page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data, nodeId);
  assert.equal(streaming.isLoading, true);
  assert.equal(streaming.response, 'Streaming chunk two remains live.');
  await page.evaluate(() => window.__store.getState().redo());
  near(await ratio(), .62, .0001, 'A streaming ratio change can redo');
  await patch({ data: { isLoading: false, response: 'Completed final answer.', responses: ['Completed final answer.'] } });
  await page.evaluate(id => window.__store.getState().settleNode(id), nodeId);
  await page.evaluate(() => window.__store.getState().undo());
  near(await ratio(), .4, .0001, 'Settling generation retains the earlier ratio undo state');
  streaming = await page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data, nodeId);
  assert.equal(streaming.isLoading, false);
  assert.equal(streaming.response, 'Completed final answer.');
  await page.evaluate(() => window.__store.getState().redo());
  near(await ratio(), .62, .0001, 'Settling generation retains the later ratio redo state');
  check('Streaming and settled ratio undo/redo preserve the current generated answer');

  await patch({ data: { response: Array.from({ length: 42 }, (_, i) => `长回答 ${i + 1}: verify bounded reading height and separate scrolling.`).join('\n\n') } });
  await patch({ height: undefined, style: { width: 620 }, data: { questionHeightRatio: .35 } });
  await settle();
  const naturalBefore = await geometry('node');
  assert.ok(naturalBefore.whole.height <= 420.5, `Long natural reading area is bounded: ${naturalBefore.whole.height}`);
  await drag('node', 40);
  const naturalAfter = await geometry('node');
  near(naturalAfter.card.height, naturalBefore.card.height, 1, 'Natural-size card has a bounded stable reading area');
  assert.ok(naturalAfter.q.height > naturalBefore.q.height + 20);
  check('A node without a custom height still reallocates a bounded reading area');

  await patch({ data: { question: '简短问题。', response: '简短回答。', responses: ['简短回答。'] } });
  await settle();
  await page.waitForTimeout(150);
  const short = await geometry('node');
  const shortContent = await split('node').evaluate(el => ({
    style: el.getAttribute('style'), naturalHeight: getComputedStyle(el).getPropertyValue('--conversation-natural-height'),
    children: [...el.querySelectorAll('.conversation-split-content')].map(content => ({ height: content.offsetHeight, text: content.textContent })),
  }));
  measurements.push({ stage: 'natural-height', naturalBefore, short, shortContent });
  assert.ok(short.whole.height < naturalBefore.whole.height - 80, JSON.stringify({ short, naturalBefore, shortContent }));
  check('Short natural-size turns keep a compact reading area');

  await patch({ data: { question: '', response: '', responses: [], responseIndex: -1, isEditing: false, isEditingResponse: false, isLoading: false } });
  await settle();
  assert.equal(await node().locator('[data-conversation-divider]').count(), 0);
  await openPanel();
  await settle();
  assert.equal(await page.locator('[data-focus-panel] [data-conversation-divider]').count(), 0);
  check('Unanswered draft nodes keep their original input flow without an empty split');

  assert.deepEqual(apiWrites, [], 'Reading layout changes never issue mutating API requests');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  check('All interactions finish without API side effects or browser runtime errors');
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, measurements, errors, apiWrites }, null, 2));
  console.log(`${checks.length} conversation splitter checks passed.`);
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` }).catch(() => {});
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, measurements, errors, apiWrites, failure: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
