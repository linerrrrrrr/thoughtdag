// Real wheel routing and content-bounded focus-panel layout; no LLM calls.
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
const output = 'local-tests/focus-panel-scroll';
const fixedPointerOnly = process.argv.includes('--fixed-pointer-only');
const traceLabel = (process.env.SCROLL_TRACE_LABEL ?? 'current').replace(/[^a-z0-9_-]/gi, '-');
const resultsPath = fixedPointerOnly ? `${output}/fixed-pointer-results-${traceLabel}.json` : `${output}/results.json`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1550, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = [], errors = [], writes = [], measurements = [];
const id = 'panel-scroll-fixture';
const shortQuestion = '这是一条简短问题。';
const shortAnswer = '这是一段简短回答。';
const longQuestion = Array.from({ length: 28 }, (_, i) => `问题 ${i + 1}：说明指标的定义、计算方式与适用条件，保留全部正文用于检查独立阅读和滚轮衔接。`).join('\n\n');
const longAnswer = Array.from({ length: 42 }, (_, i) => `回答 ${i + 1}：问题与回答各自在区域内部滚动。滚到顶部或底部后，同一方向的滚轮继续滚动右侧完整详情页。`).join('\n\n');
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
  if (!localStorage.getItem('thoughtdag.lang')) localStorage.setItem('thoughtdag.lang', 'zh');
});

const check = label => { checks.push(label); console.log('PASS', label); };
const near = (a, b, label, tolerance = 1) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} versus ${b}`);
const panel = () => page.locator(`[data-focus-panel][data-focus-node-id="${id}"]`);
const outer = () => panel().locator('[data-conversation-scroll-page]');
const split = () => panel().locator('[data-conversation-split="panel"]');
const question = () => split().locator('[data-conversation-split-question]');
const answer = () => split().locator('[data-conversation-split-answer]');
const divider = () => split().locator('[data-conversation-divider]');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const state = () => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data, id);
const patch = data => page.evaluate(({ id, data }) => window.__store.setState(state => ({ nodes: state.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n) })), { id, data });
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const scrolls = () => panel().evaluate(el => {
  const page = el.querySelector('[data-conversation-scroll-page]');
  const q = el.querySelector('[data-conversation-split-question]');
  const a = el.querySelector('[data-conversation-split-answer]');
  const read = item => ({ top: item.scrollTop, client: item.clientHeight, height: item.scrollHeight, max: item.scrollHeight - item.clientHeight });
  return { page: read(page), question: read(q), answer: read(a) };
});
const setScrolls = async ({ page: pageTop, question: questionTop, answer: answerTop }) => {
  await panel().evaluate((el, tops) => {
    for (const [selector, top] of [['[data-conversation-scroll-page]', tops.pageTop], ['[data-conversation-split-question]', tops.questionTop], ['[data-conversation-split-answer]', tops.answerTop]]) {
      if (top === undefined) continue;
      const target = el.querySelector(selector);
      target.scrollTop = top === 'end' ? target.scrollHeight - target.clientHeight : top;
    }
  }, { pageTop, questionTop, answerTop });
  await settle();
};
const wheel = async (target, deltaY) => {
  const hit = await target.evaluate(el => {
    const box = el.getBoundingClientRect();
    let top = Math.max(box.top + 2, 2), bottom = Math.min(box.bottom - 2, innerHeight - 2);
    let left = Math.max(box.left + 2, 2), right = Math.min(box.right - 2, innerWidth - 2);
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
      if (css.overflowY !== 'visible') { top = Math.max(top, clip.top + 2); bottom = Math.min(bottom, clip.bottom - 2); }
      if (css.overflowX !== 'visible') { left = Math.max(left, clip.left + 2); right = Math.min(right, clip.right - 2); }
    }
    if (bottom <= top || right <= left) throw new Error(`No visible wheel target: ${JSON.stringify({ box: box.toJSON(), top, bottom, left, right })}`);
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  });
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.wheel(0, deltaY);
  // Native scrolling runs on the compositor and can finish after RAF handlers.
  await page.waitForTimeout(180);
  await settle();
};
const layout = () => panel().evaluate(el => {
  const area = el.querySelector('[data-conversation-split="panel"]');
  const q = area.querySelector('[data-conversation-split-question]');
  const a = area.querySelector('[data-conversation-split-answer]');
  const line = area.querySelector('[data-conversation-divider]');
  return { panelHeight: el.getBoundingClientRect().height, panelWidth: el.getBoundingClientRect().width,
    panelTop: el.getBoundingClientRect().top, panelBottom: el.getBoundingClientRect().bottom, viewportHeight: innerHeight,
    splitHeight: area.offsetHeight, ratio: Number(q.style.flexGrow) / (Number(q.style.flexGrow) + Number(a.style.flexGrow)), dividerHeight: line.offsetHeight,
    q: { content: q.querySelector('.conversation-split-content').offsetHeight, client: q.clientHeight, scroll: q.scrollHeight },
    a: { content: a.querySelector('.conversation-split-content').offsetHeight, client: a.clientHeight, scroll: a.scrollHeight } };
});
const waitLayout = async () => { await settle(); await page.waitForTimeout(120); await settle(); };
const seed = async (questionText, responseText, ratio = .35) => {
  await page.evaluate(({ id, questionText, responseText, ratio }) => {
    const nodes = [{ id, type: 'thought', dragHandle: '.drag-handle', position: { x: 0, y: 0 }, width: 600, height: 600, data: {
      question: questionText, response: responseText, responses: [responseText], responseIndex: 0, questionHeightRatio: ratio,
      detailLevel: 'full', isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      tokenCount: 0, roleMode: 'inherit', isRoot: false, isBranch: false,
    } }];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__ui.getState().setPanelWidth(580);
    window.__ui.getState().setPanelOpen(true, id);
    window.__ui.getState().setCanvasDetail('full');
  }, { id, questionText, responseText, ratio });
  await divider().waitFor();
  await waitLayout();
  await setScrolls({ page: 0, question: 0, answer: 0 });
};

// Keep the pointer at exactly one screen coordinate while the page moves.
// Re-targeting the mouse before every wheel masks native scroll-latching bugs.
const fixedPointerRegression = async () => {
  const traces = [], failures = [];
  const moderateAnswer = Array.from({ length: 7 }, (_, i) => `回答 ${i + 1}：确认固定鼠标位置下，回答区滚到顶部后剩余滚轮距离继续用于整个详情页。`).join('\n\n');
  const sample = point => panel().evaluate((el, point) => {
    const paneName = item => item?.closest('[data-conversation-split-answer]') ? 'answer'
      : item?.closest('[data-conversation-split-question]') ? 'question'
      : item?.closest('[data-conversation-scroll-page]') ? 'outer' : 'outside';
    const hit = document.elementFromPoint(point.x, point.y);
    const read = selector => {
      const item = el.querySelector(selector), rect = item.getBoundingClientRect();
      return { top: item.scrollTop, max: item.scrollHeight - item.clientHeight, screenTop: rect.top, screenBottom: rect.bottom };
    };
    return { time: performance.now(), pointer: point, hit: paneName(hit), hitTag: hit?.tagName,
      page: read('[data-conversation-scroll-page]'), question: read('[data-conversation-split-question]'), answer: read('[data-conversation-split-answer]'),
      viewport: window.__rf.getViewport(), events: window.__fixedWheelEvents.splice(0) };
  }, point);
  const prepare = async (ratio, answerTop) => {
    await seed(longQuestion, moderateAnswer, ratio);
    await page.waitForTimeout(400);
    const maximum = (await scrolls()).page.max;
    assert.ok(maximum > 40, 'The fixed-pointer fixture must have a scrollable outer page');
    await setScrolls({ page: Math.min(100, maximum), question: 0, answer: answerTop });
    const box = await answer().boundingBox();
    const point = { x: box.x + Math.min(220, box.width / 2), y: box.y + 18 };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => { window.__fixedWheelEvents.length = 0; });
    return point;
  };
  await page.evaluate(() => {
    window.__fixedWheelEvents = [];
    if (window.__fixedWheelListener) return;
    window.__fixedWheelListener = true;
    document.addEventListener('wheel', event => {
      const paneName = item => item?.closest?.('[data-conversation-split-answer]') ? 'answer'
        : item?.closest?.('[data-conversation-split-question]') ? 'question'
        : item?.closest?.('[data-conversation-scroll-page]') ? 'outer' : 'outside';
      window.__fixedWheelEvents.push({ time: performance.now(), deltaY: event.deltaY, defaultPrevented: event.defaultPrevented,
        target: paneName(event.target), hit: paneName(document.elementFromPoint(event.clientX, event.clientY)) });
    });
  });
  const sequence = async (name, ratio, start, deltas, delay) => {
    const point = await prepare(ratio, start);
    const steps = [{ delta: 0, ...(await sample(point)) }];
    for (const delta of deltas) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(delay);
      steps.push({ delta, ...(await sample(point)) });
    }
    await page.waitForTimeout(160);
    steps.push({ delta: 0, settled: true, ...(await sample(point)) });
    traces.push({ name, ratio, pointerMoves: 1, steps });
    return steps;
  };

  for (const ratio of [.82, .85]) {
    const steps = await sequence(`top-residual-${ratio}`, ratio, 2, [-140], 40);
    const before = steps[0], after = steps.at(-1);
    if (Math.abs(after.answer.top) > 1 || !(after.page.top < before.page.top - 30)) {
      failures.push(`ratio ${ratio}: -140px at answer.scrollTop=2 consumed the pane edge but did not forward the remaining distance; outer ${before.page.top} -> ${after.page.top}, answer ${before.answer.top} -> ${after.answer.top}`);
    }
    assert.deepEqual(after.viewport, before.viewport, 'Fixed-pointer wheel cannot move the canvas');
  }
  const continuous = await sequence('continuous-small-up', .85, 45, Array(14).fill(-18), 28);
  if (continuous.at(-1).page.top > 1 || continuous.at(-1).answer.top > 1) failures.push(`continuous small upward wheels did not reach both upper boundaries: ${JSON.stringify(continuous.at(-1))}`);
  const reversal = await sequence('down-then-up-without-retargeting', .85, 20, [22, 22, 22, ...Array(18).fill(-18)], 24);
  if (reversal.at(-1).page.top > 1 || reversal.at(-1).answer.top > 1) failures.push(`a downward/upward direction reversal remained latched: ${JSON.stringify(reversal.at(-1))}`);

  await seed(longQuestion, moderateAnswer, .85);
  await patch({ isLoading: true, response: moderateAnswer });
  await waitLayout();
  await setScrolls({ page: Math.min(100, (await scrolls()).page.max), question: 0 });
  const liveBox = await answer().boundingBox();
  const livePoint = { x: liveBox.x + Math.min(220, liveBox.width / 2), y: liveBox.y + 18 };
  await page.mouse.move(livePoint.x, livePoint.y);
  await page.evaluate(() => { window.__fixedWheelEvents.length = 0; });
  const liveBefore = await sample(livePoint);
  await page.mouse.wheel(0, -18);
  await page.waitForTimeout(40);
  const liveScrolled = await sample(livePoint);
  await patch({ response: `${moderateAnswer}\n\n新收到的一小段内容。` });
  await waitLayout();
  const liveChunk = await sample(livePoint);
  traces.push({ name: 'live-small-up-before-next-chunk', ratio: .85, pointerMoves: 1,
    steps: [{ delta: 0, ...liveBefore }, { delta: -18, ...liveScrolled }, { delta: 0, chunk: true, ...liveChunk }] });
  if (!(liveScrolled.answer.top < liveBefore.answer.top - 5) || liveChunk.answer.top > liveScrolled.answer.top + 1) {
    failures.push(`an 18px manual upward scroll during generation was pulled back by the next chunk: answer ${liveBefore.answer.top} -> ${liveScrolled.answer.top} -> ${liveChunk.answer.top}`);
  }

  await writeFile(`${output}/fixed-pointer-trace-${traceLabel}.json`, JSON.stringify({ traces, failures }, null, 2));
  await page.screenshot({ path: `${output}/fixed-pointer-${traceLabel}.png` });
  measurements.push({ label: `fixed-pointer-${traceLabel}`, traceFile: `fixed-pointer-trace-${traceLabel}.json`, failures });
  assert.deepEqual(failures, [], `Fixed-pointer wheel routing regressions:\n${failures.join('\n')}`);
  check('A fixed pointer forwards the last two pixels and remaining upward wheel distance into the page');
  check('Continuous small upward wheels and a downward/upward reversal reach the outer top without retargeting');
  check('A small manual upward wheel during generation suspends following before the next chunk');
};

const wheelModesAndNestedRegression = async () => {
  await seed(longQuestion, longAnswer, .85);
  const text = answer().locator('.focus-assistant-message p').first();
  const dispatch = (target, options) => target.evaluate((el, options) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  }, options);
  await setScrolls({ page: 0, question: 0, answer: 100 });
  const lineHeight = await text.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
  assert.equal(await dispatch(text, { deltaY: 2, deltaMode: 1 }), true);
  near((await scrolls()).answer.top, 100 + lineHeight * 2, 'Line-mode wheel converts by the target line height');
  await setScrolls({ page: 0, question: 0, answer: 100 });
  const pageHeight = (await scrolls()).answer.client;
  assert.equal(await dispatch(text, { deltaY: 1, deltaMode: 2 }), true);
  near((await scrolls()).answer.top, 100 + pageHeight, 'Page-mode wheel converts by the pane height');
  check('Line and page wheel modes preserve their intended scroll distance');

  await setScrolls({ page: 0, question: 0, answer: 100 });
  for (let i = 0; i < 20; i++) assert.equal(await dispatch(text, { deltaY: .2, deltaMode: 0 }), true);
  const fractions = await scrolls();
  near(fractions.answer.top, 104, 'Fractional pixel wheels accumulate rather than disappear', 1);
  near(fractions.page.top, 0, 'Fractional movement stays inside a pane with room');
  check('Fractional pixel wheel steps accumulate without leaking into the page');

  for (const options of [
    { deltaY: 100, ctrlKey: true }, { deltaY: 100, metaKey: true }, { deltaY: 100, shiftKey: true },
    { deltaX: 100, deltaY: 0 }, { deltaX: 100, deltaY: 50 },
  ]) {
    const before = await scrolls();
    assert.equal(await dispatch(text, options), false, `Native wheel shortcut/axis remains uncancelled: ${JSON.stringify(options)}`);
    assert.deepEqual(await scrolls(), before, 'The routing algorithm does not modify bypassed wheel input');
  }
  const codeAnswer = `\`\`\`text\n${'native-diagonal-code-scroll-'.repeat(80)}\n\`\`\`\n\n${longAnswer}`;
  await patch({ response: codeAnswer, responses: [codeAnswer] });
  await waitLayout();
  const pre = panel().locator('.focus-response-section pre').first();
  const code = await pre.evaluate(el => el.scrollWidth > el.clientWidth + 100) ? pre : pre.locator('code');
  assert.ok(await code.evaluate(el => el.scrollWidth > el.clientWidth));
  assert.equal(await dispatch(code, { deltaX: 20, deltaY: 60 }), false, 'Diagonal wheel over horizontally scrollable code stays native');
  check('Modifier shortcuts, horizontal wheels, and diagonal code scrolling retain native handling');

  await seed(longQuestion, longAnswer, .35);
  await question().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await panel().locator('[data-edit-question]').click();
  const editor = panel().locator('.focus-question-section textarea');
  const draft = '这是一段需要在文本框内部滚动的未提交问题草稿。\n'.repeat(100);
  await editor.fill(draft);
  await waitLayout();
  assert.ok(await editor.evaluate(el => el.scrollHeight > el.clientHeight + 100), 'The nested textarea must have its own scroll range');
  await setScrolls({ page: 0, question: 0, answer: 0 });
  await editor.evaluate(el => { el.scrollTop = 100; });
  await wheel(editor, 80);
  assert.ok((await editor.evaluate(el => el.scrollTop)) > 150, 'The textarea consumes wheel input before its pane');
  near((await scrolls()).question.top, 0, 'The question pane stays still while the textarea has room');
  near((await scrolls()).page.top, 0, 'The outer page stays still while the textarea has room');
  await editor.evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight - 2; });
  await question().evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight - 2; });
  await wheel(editor, 140);
  const nested = await scrolls();
  const textarea = await editor.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  near(textarea.top, textarea.max, 'The last textarea pixels are consumed');
  near(nested.question.top, nested.question.max, 'The last pane pixels are consumed');
  assert.ok(nested.page.top > 80, JSON.stringify({ nested, textarea }));
  near(nested.answer.top, 0, 'Textarea overscroll does not enter the sibling answer');
  assert.equal(await editor.inputValue(), draft);
  await panel().locator('[data-edit-cancel]').click();
  check('Nested textarea, question pane, and page consume one wheel in order without losing the draft');
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async () => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    window.__ui = (await window.__importLive('/src/lib/ui-store.ts')).useUiStore;
  });
  if (fixedPointerOnly) {
    await fixedPointerRegression();
    await wheelModesAndNestedRegression();
    assert.deepEqual(writes, [], 'Fixed-pointer reading never sends mutating API requests');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    await writeFile(resultsPath, JSON.stringify({ checks, measurements, errors, writes }, null, 2));
    console.log(`${checks.length} fixed-pointer scroll checks passed.`);
  } else {
  await seed(shortQuestion, shortAnswer);
  const compact = await layout();
  near(compact.panelTop, 16, 'The short-details frame keeps its canvas top inset');
  near(compact.panelBottom, compact.viewportHeight - 16, 'The short-details frame extends to the canvas bottom inset');
  assert.ok(compact.q.scroll <= compact.q.client + 1 && compact.a.scroll <= compact.a.client + 1, JSON.stringify(compact));
  const needed = compact.q.content + compact.a.content + compact.dividerHeight;
  assert.ok(compact.splitHeight <= needed + 4, JSON.stringify({ compact, needed }));
  assert.equal(await panel().locator('.focus-panel-inspect').evaluate(el => !!el.closest('[data-conversation-split-answer]')), false);
  measurements.push({ label: 'short', ...compact });
  check('The details frame extends to the viewport bottom while short panes fit their content and inspection follows');

  await page.evaluate(id => window.__store.getState().setQuestionHeightRatio(id, .85), id);
  await waitLayout();
  const changedRatio = await layout();
  near(changedRatio.splitHeight, compact.splitHeight, 'Changing the ratio cannot create whitespace in short panes', 2);
  assert.ok(changedRatio.q.client <= changedRatio.q.content + 1 && changedRatio.a.client <= changedRatio.a.content + 1, JSON.stringify(changedRatio));
  assert.ok(changedRatio.panelHeight <= changedRatio.viewportHeight - 30);
  await patch({ question: longQuestion, response: longAnswer, responses: [longAnswer] });
  await waitLayout();
  const bounded = await layout();
  assert.ok(bounded.panelHeight <= bounded.viewportHeight - 30);
  assert.ok(bounded.splitHeight < bounded.viewportHeight);
  assert.ok((await scrolls()).page.max > 20, JSON.stringify(await scrolls()));
  check('Ratio and content changes resize the panel within the viewport while preserving page scrolling');

  await seed(longQuestion, longAnswer);
  await page.waitForTimeout(450);
  const camera = await viewport();
  await setScrolls({ page: 0, question: 160, answer: 0 });
  const middleBefore = await scrolls();
  await wheel(question(), 110);
  const middleAfter = await scrolls();
  assert.ok(middleAfter.question.top > middleBefore.question.top + 30, JSON.stringify({ middleBefore, middleAfter }));
  near(middleAfter.page.top, middleBefore.page.top, 'The page stays still while the question can scroll');
  near(middleAfter.answer.top, middleBefore.answer.top, 'Question scrolling does not scroll the answer');
  assert.deepEqual(await viewport(), camera);
  check('A wheel in the question interior scrolls only that pane');

  await setScrolls({ page: 0, question: 'end', answer: 0 });
  const downBefore = await scrolls();
  await wheel(question(), 140);
  const downAfter = await scrolls();
  assert.ok(downAfter.page.top > downBefore.page.top + 20, JSON.stringify({ downBefore, downAfter }));
  near(downAfter.question.top, downBefore.question.top, 'The question remains at its lower edge');
  near(downAfter.answer.top, 0, 'Boundary scrolling does not jump into the other pane');
  check('Continuing downward at a question boundary scrolls the whole details page');

  await setScrolls({ page: 0, answer: 0 });
  await question().evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight - 2; });
  await wheel(question(), 300);
  const almostEnd = await scrolls();
  near(almostEnd.question.top, almostEnd.question.max, 'A large wheel finishes the last two pixels of the pane');
  await wheel(question(), 130);
  const continued = await scrolls();
  assert.ok(continued.page.top > 20, JSON.stringify({ almostEnd, continued }));
  near(continued.answer.top, 0, 'Near-boundary overscroll does not enter the other pane');
  assert.deepEqual(await viewport(), camera);
  check('A large near-boundary wheel reaches the pane end and subsequent input continues the page');

  const outerMaximum = (await scrolls()).page.max;
  await setScrolls({ page: Math.min(outerMaximum, 120), question: 0, answer: 0 });
  const upBefore = await scrolls();
  await wheel(question(), -100);
  const upAfter = await scrolls();
  assert.ok(upAfter.page.top < upBefore.page.top - 20, JSON.stringify({ upBefore, upAfter }));
  near(upAfter.question.top, 0, 'The question remains at its upper edge');
  near(upAfter.answer.top, 0, 'Upward boundary scrolling leaves the answer alone');
  check('Continuing upward at a question boundary scrolls the whole details page');

  await setScrolls({ page: 0, question: 0, answer: 180 });
  const answerBefore = await scrolls();
  await wheel(answer(), 100);
  const answerAfter = await scrolls();
  assert.ok(answerAfter.answer.top > answerBefore.answer.top + 25);
  near(answerAfter.page.top, 0, 'The page stays still while the answer can scroll');
  near(answerAfter.question.top, 0, 'Answer scrolling leaves the question alone');
  await setScrolls({ page: 0, question: 0, answer: 'end' });
  await wheel(answer(), 140);
  assert.ok((await scrolls()).page.top > 20);
  check('The answer uses the same interior and boundary wheel behavior');

  await setScrolls({ page: 0, question: 0, answer: 0 });
  await wheel(question(), -240);
  near((await scrolls()).page.top, 0, 'The outer page stops at its upper boundary');
  await setScrolls({ page: 'end', question: 0, answer: 'end' });
  const endBefore = await scrolls();
  await wheel(answer(), 240);
  near((await scrolls()).page.top, endBefore.page.max, 'The outer page stops at its lower boundary');
  assert.deepEqual(await viewport(), camera, 'Outer boundary wheels cannot pan or zoom the canvas');
  check('At the outer page ends, wheel input stops without moving or zooming the canvas');

  await patch({ question: shortQuestion });
  await waitLayout();
  await setScrolls({ page: 0, question: 0, answer: 120 });
  const shortPaneBefore = await scrolls();
  assert.ok(shortPaneBefore.question.max <= 1, JSON.stringify(shortPaneBefore));
  await wheel(question(), 120);
  const shortPaneAfter = await scrolls();
  assert.ok(shortPaneAfter.page.top > 20, JSON.stringify({ shortPaneBefore, shortPaneAfter }));
  near(shortPaneAfter.answer.top, shortPaneBefore.answer.top, 'A non-scrollable question does not scroll the answer');
  check('A pane with no internal overflow passes the wheel to the details page');

  await seed(shortQuestion, shortAnswer);
  const metadataBefore = await panel().locator('.focus-panel-prelude').evaluate(el => el.offsetHeight);
  await panel().locator('[data-node-metadata-toggle]').click();
  const title = panel().locator('[data-node-title-input]');
  const summary = panel().locator('[data-node-summary-input]');
  await title.fill('保留右侧名称草稿');
  await summary.fill('这是一段未提交摘要草稿，用于确认展开内容跟随整个详情页自然滚动。\n'.repeat(8));
  await waitLayout();
  const metadataAfter = await panel().locator('.focus-panel-prelude').evaluate(el => ({ height: el.offsetHeight, scroll: el.scrollHeight, client: el.clientHeight }));
  assert.ok(metadataAfter.height > metadataBefore + 100, JSON.stringify({ metadataBefore, metadataAfter }));
  assert.ok(metadataAfter.scroll <= metadataAfter.client + 1, JSON.stringify(metadataAfter));
  await panel().locator('[data-node-metadata-toggle]').click();
  await panel().locator('[data-node-metadata-toggle]').click();
  assert.equal(await title.inputValue(), '保留右侧名称草稿');
  assert.match(await summary.inputValue(), /未提交摘要草稿/);
  await panel().locator('[data-node-metadata-cancel]').click();
  assert.equal((await state()).displayName, undefined);
  check('Expanded metadata stays in the natural page flow and retains unsaved drafts');

  await seed(longQuestion, longAnswer);
  await question().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await panel().locator('[data-edit-question]').click();
  const editor = panel().locator('.focus-question-section textarea');
  await editor.fill('保留问题草稿。\nScrolling must not submit or discard it.');
  await wheel(question(), 120);
  assert.equal(await editor.inputValue(), '保留问题草稿。\nScrolling must not submit or discard it.');
  assert.equal((await state()).question, longQuestion);
  await panel().locator('[data-edit-cancel]').click();
  await setScrolls({ page: 0, question: 0, answer: 0 });
  await divider().click();
  const quiet = await divider().evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow, line: getComputedStyle(el, '::before').height }));
  assert.deepEqual(quiet, { outline: 'none', shadow: 'none', line: '1px' });
  assert.equal(await divider().locator('*').count(), 0);
  check('Wheel input preserves the question draft and the separator remains a quiet line');

  const codeAnswer = `\`\`\`text\n${'horizontal-code-content-'.repeat(90)}\n\`\`\`\n\n${longAnswer}`;
  await patch({ question: longQuestion, response: codeAnswer, responses: [codeAnswer] });
  await waitLayout();
  await setScrolls({ page: 0, question: 0, answer: 0 });
  const pre = panel().locator('.focus-response-section pre').first();
  // Syntax highlighting may make <code>, rather than <pre>, the local scrollport.
  const code = await pre.evaluate(el => el.scrollWidth > el.clientWidth + 100) ? pre : pre.locator('code');
  assert.ok(await code.evaluate(el => el.scrollWidth > el.clientWidth + 100));
  const codeBox = await code.boundingBox();
  const answerBox = await answer().boundingBox();
  const codeY = Math.max(codeBox.y + 4, answerBox.y + 4);
  await page.mouse.move(codeBox.x + Math.min(codeBox.width / 2, 180), codeY);
  const codeBefore = await scrolls();
  const codeCamera = await viewport();
  await page.mouse.wheel(220, 0);
  await page.waitForTimeout(180);
  assert.ok(await code.evaluate(el => el.scrollLeft > 0), 'Horizontal wheel scrolls the code block');
  const codeAfter = await scrolls();
  near(codeAfter.page.top, codeBefore.page.top, 'Code horizontal scrolling does not scroll the page vertically');
  near(codeAfter.answer.top, codeBefore.answer.top, 'Code horizontal scrolling does not scroll the answer vertically');
  near(codeAfter.question.top, codeBefore.question.top, 'Code horizontal scrolling leaves the question alone');
  assert.deepEqual(await viewport(), codeCamera, 'Code horizontal scrolling cannot pan the canvas');
  check('Nested code keeps horizontal wheel scrolling local without moving the page or canvas');

  await patch({ isLoading: true, response: longAnswer });
  await waitLayout();
  const streamBefore = (await scrolls()).answer.top;
  assert.ok(streamBefore > 0);
  await patch({ response: `${longAnswer}\n\n${longAnswer}` });
  await waitLayout();
  assert.ok((await scrolls()).answer.top > streamBefore + 100);
  await setScrolls({ answer: 0 });
  await patch({ response: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}` });
  await waitLayout();
  near((await scrolls()).answer.top, 0, 'Manual scrollback suspends live following');
  await setScrolls({ answer: 'end' });
  const resumedBefore = (await scrolls()).answer.top;
  await patch({ response: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}\n\n${longAnswer}` });
  await waitLayout();
  assert.ok((await scrolls()).answer.top > resumedBefore + 100);
  check('Streaming follows the live tail, respects scrollback, and resumes at the bottom');

  await patch({ isLoading: false, question: '请说明这组指标的数据来源、计算方法和适用条件。'.repeat(3), response: shortAnswer, responses: [shortAnswer] });
  await page.evaluate(() => window.__ui.getState().setPanelWidth(650));
  await waitLayout();
  const wide = await layout();
  await page.evaluate(() => window.__ui.getState().setPanelWidth(380));
  await waitLayout();
  const narrow = await layout();
  assert.ok(narrow.q.content > wide.q.content, JSON.stringify({ wide, narrow }));
  assert.ok(narrow.panelHeight <= narrow.viewportHeight - 30);
  await page.evaluate(async () => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await setScrolls({ page: 0, question: 0, answer: 0 });
  await page.mouse.move(800, 1050);
  await page.screenshot({ path: `${output}/narrow-dark-panel.png` });
  check('Changing panel width refreshes wrapped-content height without exceeding the viewport');

  await seed(shortQuestion, shortAnswer);
  await page.mouse.move(800, 1050);
  await page.screenshot({ path: `${output}/short-panel.png` });
  await seed(longQuestion, longAnswer);
  await setScrolls({ page: 'end', answer: 'end' });
  await page.mouse.move(800, 1050);
  await page.screenshot({ path: `${output}/outer-bottom-inspection.png` });
  await fixedPointerRegression();
  await wheelModesAndNestedRegression();
  assert.deepEqual(writes, [], 'Reading and scrolling never send mutating API requests');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  check('All layout and wheel interactions finish without API side effects or runtime errors');
  await writeFile(resultsPath, JSON.stringify({ checks, measurements, errors, writes }, null, 2));
  console.log(`${checks.length} focus-panel scroll checks passed.`);
  }
} catch (error) {
  await page.screenshot({ path: `${output}/failure${fixedPointerOnly ? `-${traceLabel}` : ''}.png` }).catch(() => {});
  await writeFile(resultsPath, JSON.stringify({ checks, measurements, errors, writes, failure: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
