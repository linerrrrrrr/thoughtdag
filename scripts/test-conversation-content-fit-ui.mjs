// Screenshot-level acceptance: each reading pane stops at its own content height.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5175');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const baselineOnly = process.argv.includes('--baseline-only');
const label = (process.env.CONTENT_FIT_LABEL ?? (baselineOnly ? 'before-fit' : 'current')).replace(/[^a-z0-9_-]/gi, '-');
const output = 'local-tests/conversation-content-fit';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const id = 'content-fit-fixture';
const checks = [], errors = [], writes = [], measurements = [], failures = [];
const shortQuestion = '继续。';
const shortAnswer = '已完成。';
const longAnswer = Array.from({ length: 16 }, (_, i) => `回答 ${i + 1}：这是一段用于验证真实阅读高度的说明。问题只有一行时，回答应获得剩余空间，完整正文可见后节点停止继续增高。`).join('\n\n');
const longQuestion = Array.from({ length: 24 }, (_, i) => `问题 ${i + 1}：说明数据来源、计算方法、适用范围与限制，并在两个区域内容都足够长时保留自由调整比例的能力。`).join('\n\n');
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
const check = text => { checks.push(text); console.log('PASS', text); };
const near = (a, b, text, tolerance = 2) => assert.ok(Math.abs(a - b) <= tolerance, `${text}: ${a} versus ${b}`);
const node = () => page.locator(`.react-flow__node[data-id="${id}"]`);
const split = () => node().locator('[data-conversation-split="node"]');
const divider = () => split().locator('[data-conversation-divider]');
const read = () => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id), id);
const format = patch => page.evaluate(({ id, patch }) => window.__store.getState().setSelectionGeometry([id], patch), { id, patch });
const runtime = () => page.evaluate(async () => {
  window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path)?.name ?? path);
  window.__ui = (await window.__importLive('/src/lib/ui-store.ts')).useUiStore;
});
const undoAvailability = () => page.evaluate(async () => (await window.__importLive('/src/store/slices/history.ts')).undoState(window.__store.getState()));
const settle = async () => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(130);
};
const metrics = () => node().evaluate(el => {
  const root = el.querySelector('.conversation-node');
  const split = el.querySelector('[data-conversation-split="node"]');
  const pane = attribute => {
    const item = split.querySelector(`[${attribute}]`), content = item.querySelector('.conversation-split-content');
    return { height: item.clientHeight, scroll: item.scrollHeight, content: Math.max(content.offsetHeight, content.scrollHeight) };
  };
  const question = pane('data-conversation-split-question'), answer = pane('data-conversation-split-answer');
  const line = split.querySelector('[data-conversation-divider]').offsetHeight;
  const chrome = root.offsetHeight - split.offsetHeight;
  return { outer: root.offsetHeight, split: split.offsetHeight, chrome, line, question, answer,
    fullContentCap: Math.ceil(chrome + question.content + answer.content + line) + 1 };
});
const seed = async ({ question = shortQuestion, answer = longAnswer, height, styleHeight, ratio = .85, activity = true } = {}) => {
  await page.evaluate(({ id, question, answer, height, styleHeight, ratio, activity }) => {
    const now = Date.now();
    const entries = Array.from({ length: 22 }, (_, i) => ({ id: `fit-command-${i}`, kind: 'command', status: 'completed', title: `检查 ${i + 1}`, command: `check-file-${i + 1}`, output: '已检查。', startedAt: now + i, endedAt: now + i + 1, exitCode: 0 }));
    const nodes = [{ id, type: 'thought', dragHandle: '.drag-handle', position: { x: 0, y: 0 }, width: 620, height,
      ...(styleHeight !== undefined ? { style: { height: styleHeight } } : {}), data: {
      question, response: answer, responses: [answer], responseIndex: 0, questionHeightRatio: ratio,
      detailLevel: 'full', isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      tokenCount: 0, roleMode: 'inherit', isRoot: false, isBranch: false,
      agentActivities: activity ? [entries] : undefined,
    } }];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
  }, { id, question, answer, height, styleHeight, ratio, activity });
  await divider().waitFor();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 120, zoom: .75 }, { duration: 0 }));
  await settle();
};
const dragDivider = async distance => {
  const box = await divider().boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + distance, { steps: 8 });
  await page.mouse.up();
  await settle();
};
const completePanes = measured => {
  for (const key of ['question', 'answer']) assert.ok(measured[key].scroll <= measured[key].height + 1, `${key} is incomplete: ${JSON.stringify(measured)}`);
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await runtime();
  for (const ratio of [.8, .85]) {
    for (const height of [800, 1200, undefined]) {
      await seed({ ratio, height });
      const measured = await metrics();
      const name = `short-question-${ratio}-${height ?? 'natural'}`;
      measurements.push({ name, ratio, height, storedHeight: (await read()).height, ...measured });
      if (measured.question.height > measured.question.content + 1) failures.push(`${name}: question pane ${measured.question.height}px exceeds its ${measured.question.content}px content`);
      if (measured.answer.height < measured.split - measured.line - measured.question.content - 2) failures.push(`${name}: freed question space was not assigned to the answer`);
      if (measured.outer > measured.fullContentCap + 2) failures.push(`${name}: outer ${measured.outer}px exceeds sum-content cap ${measured.fullContentCap}px`);
      if (height === 1200 && ratio === .85) {
        await page.mouse.move(1000, 1100);
        await page.screenshot({ path: `${output}/${label}-short-question-tools22.png` });
      }
    }
  }
  await seed({ question: shortQuestion, answer: shortAnswer, height: 1200, ratio: .85, activity: false });
  const tiny = await metrics();
  measurements.push({ name: 'both-short-legacy-1200', storedHeight: (await read()).height, ...tiny });
  if (tiny.outer > tiny.fullContentCap + 2) failures.push(`both-short legacy 1200px: rendered ${tiny.outer}px exceeds sum-content cap ${tiny.fullContentCap}px`);
  if (tiny.question.height > tiny.question.content + 1 || tiny.answer.height > tiny.answer.content + 1) failures.push('both-short legacy card retains empty space inside its reading panes');
  await page.mouse.move(1000, 1100);
  await page.screenshot({ path: `${output}/${label}-both-short-legacy.png` });
  await writeFile(`${output}/${label}-measurements.json`, JSON.stringify({ measurements, failures }, null, 2));
  assert.deepEqual(failures, [], `Content-fit regressions:\n${failures.join('\n')}`);
  check('Short questions stop at their own content height and give the remaining space to long answers');
  check('Saved oversized short turns shrink to the sum of visible content and card chrome');
  if (!baselineOnly) {
    near((await read()).height, tiny.outer, 'The stored legacy height follows the visible tightened card');
    completePanes(tiny);
    const initialHistory = await page.evaluate(id => {
      const s = window.__store.getState();
      return { index: s.historyIndex, length: s.history.length, height: s.history[s.historyIndex].nodes.find(n => n.id === id)?.height };
    }, id);
    near(initialHistory.height, tiny.outer, 'Automatic normalization updates the active history snapshot');
    assert.equal(initialHistory.index, 0);
    assert.equal(initialHistory.length, 1);
    assert.equal((await undoAvailability()).canUndo, false, 'Normalization alone does not create a phantom undo step');
    check('Automatic height normalization keeps the active history snapshot coherent');
    await page.evaluate(async () => (await window.__importLive('/src/lib/persistence.ts')).flushPendingWrites());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
    await runtime();
    await divider().waitFor();
    await settle();
    const restored = await metrics();
    assert.ok(restored.outer <= restored.fullContentCap + 2);
    assert.ok((await read()).height <= restored.fullContentCap + 2);
    check('The tightened saved height persists across reload');

    await seed({ height: 800, ratio: .85, activity: false });
    await format({ height: 1000 });
    await page.evaluate(({ id, response }) => window.__store.getState().editResponse(id, response), { id, response: shortAnswer });
    await settle();
    const edited = await metrics();
    near((await read()).height, edited.fullContentCap, 'Editing down to a short answer tightens the saved height');
    await page.evaluate(() => window.__store.getState().undo());
    await settle();
    assert.equal((await read()).data.response, longAnswer, 'First undo restores the previous answer instead of repeating normalization');
    near((await read()).height, 1000, 'First undo restores the corresponding user-chosen height');
    await page.evaluate(() => window.__store.getState().undo());
    await settle();
    near((await read()).height, 800, 'Second undo restores the earlier resize');
    assert.equal((await undoAvailability()).canUndo, false, 'The undo cursor reaches the original baseline');
    await page.evaluate(() => window.__store.getState().redo());
    await settle();
    near((await read()).height, 1000, 'First redo restores the resize');
    await page.evaluate(() => window.__store.getState().redo());
    await settle();
    assert.equal((await read()).data.response, shortAnswer);
    near((await read()).height, edited.fullContentCap, 'Second redo restores the short answer and its normalized height');
    check('Answer edits and automatic height fitting each undo and redo once without getting stuck');

    await seed({ question: shortQuestion, answer: shortAnswer, styleHeight: '1200px', ratio: .85, activity: false });
    const styled = await metrics();
    const wrapperHeight = await node().evaluate(el => el.getBoundingClientRect().height / window.__rf.getZoom());
    const styledStored = await read();
    const wrapperStyle = await node().evaluate(el => ({ inline: el.style.height, computed: getComputedStyle(el).height }));
    measurements.push({ name: 'legacy-px-style', wrapperHeight, wrapperStyle,
      storedHeight: styledStored.height, storedStyleHeight: styledStored.style?.height, ...styled });
    await page.screenshot({ path: `${output}/${label}-legacy-px-wrapper.png` });
    assert.ok(styled.outer <= styled.fullContentCap + 2);
    assert.ok(wrapperHeight <= styled.fullContentCap + 2, `The React Flow wrapper and selection boundary also tighten: ${JSON.stringify({ wrapperHeight, wrapperStyle, styled, storedHeight: styledStored.height, storedStyleHeight: styledStored.style?.height })}`);
    near((await read()).height, styled.outer, 'A legacy px style becomes a coherent stored node height');
    assert.ok(parseFloat(String((await read()).style.height)) <= styled.fullContentCap + 2);
    check('Legacy px-style heights tighten the card, React Flow wrapper, and stored geometry together');

    await seed({ height: 800, ratio: .85 });
    const shortBefore = await metrics();
    const shortNodeBefore = await read();
    await dragDivider(140);
    const shortAfter = await metrics();
    assert.ok(shortAfter.question.height <= shortAfter.question.content + 1);
    near(shortAfter.question.height, shortBefore.question.height, 'Dragging cannot expand the short question beyond its text');
    near(shortAfter.outer, shortBefore.outer, 'Clamped divider dragging preserves node height');
    assert.deepEqual((await read()).position, shortNodeBefore.position);
    check('Dragging past a short question keeps it capped and leaves space with the long answer');

    await seed({ question: longQuestion, answer: longAnswer, height: 700, ratio: .5, activity: false });
    const longBefore = await metrics();
    await dragDivider(60);
    const longAfter = await metrics();
    assert.ok(longAfter.question.height > longBefore.question.height + 40);
    assert.ok(longAfter.answer.height < longBefore.answer.height - 40);
    near(longAfter.outer, longBefore.outer, 'Two long panes still share a stable outer height');
    await page.evaluate(() => window.__store.getState().undo());
    await settle();
    near((await metrics()).question.height, longBefore.question.height, 'Divider undo restores long/long allocation');
    await page.evaluate(() => window.__store.getState().redo());
    await settle();
    near((await metrics()).question.height, longAfter.question.height, 'Divider redo restores long/long allocation');
    check('Long questions and long answers retain adjustable proportions and undo/redo');

    await seed({ height: 600, ratio: .85 });
    await format({ height: 100000 });
    await settle();
    const full = await metrics();
    near(full.outer, full.fullContentCap, 'Full outer height is the sum of both content heights and card chrome');
    near((await read()).height, full.fullContentCap, 'Height formatting uses the sum-content cap');
    completePanes(full);
    await format({ width: 360, height: 100000 });
    await settle();
    const narrow = await metrics();
    near((await read()).width, 360, 'Candidate width applies');
    near((await read()).height, narrow.fullContentCap, 'Simultaneous width and height edit uses newly wrapped content');
    completePanes(narrow);
    assert.ok(narrow.fullContentCap > full.fullContentCap + 100);
    check('Height formatting and candidate-width measurement share the full sum-content limit');

    await page.evaluate(id => window.__store.getState().setSelectedNodeIds([id]), id);
    const heightHandle = node().locator('[data-node-resize="height"]');
    const cap = (await read()).height;
    await heightHandle.focus();
    await page.keyboard.press('ArrowDown');
    near((await read()).height, cap, 'Keyboard growth stops at the full-content limit');
    await page.keyboard.press('ArrowUp');
    near((await read()).height, cap - 1, 'Keyboard shrinking remains available');
    await page.evaluate(() => window.__store.getState().undo());
    near((await read()).height, cap, 'Keyboard shrink has one undo step');
    await page.evaluate(() => window.__store.getState().redo());
    near((await read()).height, cap - 1, 'Keyboard shrink can be redone');
    check('Keyboard resizing and undo/redo respect the sum-content ceiling');

    await seed({ height: 800, ratio: .85 });
    await page.evaluate(id => { window.__ui.getState().setPanelWidth(580); window.__ui.getState().setPanelOpen(true, id); }, id);
    const panel = page.locator('[data-focus-panel]');
    await panel.locator('[data-conversation-divider]').waitFor();
    await settle();
    const panelPanes = await panel.evaluate(el => {
      const split = el.querySelector('[data-conversation-split="panel"]');
      const read = attr => { const pane = split.querySelector(`[${attr}]`); return { height: pane.clientHeight, content: pane.querySelector('.conversation-split-content').offsetHeight }; };
      return { question: read('data-conversation-split-question'), answer: read('data-conversation-split-answer'), height: split.offsetHeight, divider: split.querySelector('[data-conversation-divider]').offsetHeight };
    });
    assert.ok(panelPanes.question.height <= panelPanes.question.content + 1);
    assert.ok(panelPanes.answer.height >= panelPanes.height - panelPanes.divider - panelPanes.question.content - 2);
    await panel.evaluate(el => {
      const outer = el.querySelector('[data-conversation-scroll-page]');
      outer.scrollTop = Math.min(100, outer.scrollHeight - outer.clientHeight);
      el.querySelector('[data-conversation-split-answer]').scrollTop = 2;
    });
    await settle();
    const answerBox = await panel.locator('[data-conversation-split-answer]').boundingBox();
    const camera = await page.evaluate(() => window.__rf.getViewport());
    await page.mouse.move(answerBox.x + 180, answerBox.y + 18);
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(100);
    const positions = await panel.evaluate(el => ({ page: el.querySelector('[data-conversation-scroll-page]').scrollTop, answer: el.querySelector('[data-conversation-split-answer]').scrollTop }));
    near(positions.page, 0, 'Whole-page upward scroll still receives answer residual distance');
    near(positions.answer, 0, 'Answer reaches the top');
    assert.deepEqual(await page.evaluate(() => window.__rf.getViewport()), camera);
    check('The right panel applies the same short-pane cap and preserves boundary wheel routing');

    await seed({ question: shortQuestion, answer: shortAnswer, height: 1200, ratio: .85, activity: false });
    await page.evaluate(id => window.__ui.getState().setPanelOpen(true, id), id);
    await panel.locator('[data-conversation-divider]').waitFor();
    await settle();
    const shortPanel = await panel.evaluate(el => {
      const rect = el.getBoundingClientRect(), split = el.querySelector('[data-conversation-split="panel"]');
      const pane = attribute => { const item = split.querySelector(`[${attribute}]`); return { height: item.clientHeight, content: item.querySelector('.conversation-split-content').offsetHeight }; };
      return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, reading: split.offsetHeight,
        question: pane('data-conversation-split-question'), answer: pane('data-conversation-split-answer'),
        line: split.querySelector('[data-conversation-divider]').offsetHeight };
    });
    near(shortPanel.top, 16, 'The panel frame keeps the top canvas inset');
    near(shortPanel.bottom, shortPanel.viewport - 16, 'The panel frame extends to the viewport bottom');
    assert.ok(shortPanel.question.height <= shortPanel.question.content + 1);
    assert.ok(shortPanel.answer.height <= shortPanel.answer.content + 1);
    assert.ok(shortPanel.reading <= shortPanel.question.content + shortPanel.answer.content + shortPanel.line + 2);
    await page.mouse.move(1000, 1100);
    await page.screenshot({ path: `${output}/${label}-short-panel-full-frame.png` });
    check('A short right-panel conversation stays compact inside a frame that reaches the bottom');
  }
  assert.deepEqual(writes, [], 'Reading geometry never issues mutating API requests');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await writeFile(`${output}/${label}-results.json`, JSON.stringify({ checks, measurements, errors, writes }, null, 2));
} catch (error) {
  await writeFile(`${output}/${label}-results.json`, JSON.stringify({ checks, measurements, errors, writes, failure: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
