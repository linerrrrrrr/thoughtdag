// Real canvas typography from Node settings, including nested overview zoom.
// Run against a local Vite dev server with APP_URL and optional CHROME_PATH.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { documentBrowser } from './fixtures/original-file-browser.mjs';
import { screenFont } from './fixtures/screen-font.mjs';
import { clickSettingsBackdrop, openSettingsSection } from './fixtures/canvas-model-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/canvas-type-scale';
await mkdir(output, { recursive: true });
const { context, close } = await documentBrowser(appUrl.href, {
  executablePath, viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], apiWrites = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== appUrl.origin) return route.abort();
  if (url.pathname === '/__thoughtdag_storage') return route.fulfill({ status: 404, body: '' });
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) apiWrites.push(url.pathname);
    return route.fulfill({ json: { models: [], sessions: [], providers: [], topics: [] } });
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
  localStorage.setItem('thoughtdag.lighting', 'dark');
});

const card = id => page.locator('.react-flow__node[data-id="' + id + '"]');
const answer = card('reading').locator('.conversation-answer');
const preview = card('overview').locator('[data-node-preview]');
const compact = card('compact').locator('.node-overview--compact .node-overview-name');
const readingCard = card('reading');
const reasoning = readingCard.locator('[data-reasoning-toggle]');
const copyButton = readingCard.getByRole('button', { name: '复制回答', exact: true });
const activity = card('activity').locator('[data-activity-history]');
const settingsPanel = page.locator('[data-settings-panel]');
const handle = name => page.locator('[data-canvas-type-handle="' + name + '"]');
const handleSize = async name => Number(await handle(name).getAttribute('aria-valuenow'));
const chart = page.locator('[data-canvas-type-chart]');
const curveHeights = role => chart.locator('polyline[data-series="' + role + '"]').evaluate(line => Array.from(line.points, point => point.y));
const scrubber = page.locator('[data-canvas-type-scrubber]');
const previewZoom = page.locator('[data-canvas-typography-preview-zoom]');
const play = page.locator('[data-canvas-type-play]');
const sample = role => page.locator('[data-canvas-typography-sample="' + role + '"]');
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const storedSettings = () => page.evaluate(() => localStorage.getItem('thoughtdag.canvasTypography'));
const apply = page.locator('[data-canvas-typography-apply]');
const reset = page.locator('[data-canvas-typography-reset]');
const ready = () => page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const geometry = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height }) => ({ id, position, width, height })));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .15, label + ': ' + actual + ' vs ' + expected);

async function setZoom(zoom) {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 75, y: 100, zoom }, { duration: 0 }), zoom);
  await page.waitForFunction(zoom => {
    const viewport = document.querySelector('.react-flow__viewport');
    const canvas = document.querySelector('.react-flow');
    return Math.abs(new DOMMatrix(getComputedStyle(viewport).transform).a - zoom) < .001
      && Math.abs(parseFloat(getComputedStyle(canvas).getPropertyValue('--tdag-zoom')) - zoom) < .001;
  }, zoom);
  await settle();
}

async function expectReading(zoom, body, summary) {
  await setZoom(zoom);
  near(await screenFont(answer), body, 'Full answer at ' + zoom);
  near(await screenFont(preview), summary, 'Summary at ' + zoom);
  near(await screenFont(compact), 10.5 * Math.min(1, zoom / .22), 'Compact name at ' + zoom);
  near((await card('reading').boundingBox()).width, 520 * zoom, 'Full node width at ' + zoom);
}

async function expectSample(role, expected, label) {
  const element = sample(role);
  // Chromium can paint the local viewport transform one frame before
  // inheriting the new em size through its scaled, clipped scene.
  const end = Date.now() + 2500;
  let actual;
  do {
    await settle();
    actual = await screenFont(element);
    if (Math.abs(actual - expected) < .15) return;
  } while (Date.now() < end);
  near(actual, expected, label);
}

async function expectFrame(zoom, body) {
  // A 100% card has 16px prose, 14px controls and 12px metadata.
  // Check what reaches the screen through every nested transform.
  const ratio = body / 16;
  const labels = [
    [reasoning.locator('span'), 14, 'Reasoning label'],
    [copyButton, 14, 'Copy label'],
    [readingCard.locator('[data-generated-at]'), 12, 'Timestamp'],
    [readingCard.locator('[data-node-metadata-toggle] span').first(), 14, 'Name and summary disclosure'],
    [readingCard.locator('[data-highlight-disclosure] span').first(), 14, 'Highlights disclosure'],
    [activity.locator('span').first(), 14, 'Activity heading'],
    [activity.locator('span').nth(1), 12, 'Activity duration'],
  ];
  for (const [element, base, label] of labels) {
    near(await screenFont(element), base * ratio, label + ' at ' + zoom);
  }
  for (const [element, base, label] of [
    [reasoning.locator('svg'), 12, 'Reasoning chevron'],
    [copyButton.locator('svg'), 14, 'Copy icon'],
    [readingCard.locator('.node-header-identity button svg'), 18, 'Header chevron'],
    [activity.locator('svg').first(), 14, 'Activity icon'],
    [copyButton, 32, 'Copy hit area'],
  ]) {
    near((await element.boundingBox()).height, base * ratio, label + ' at ' + zoom);
  }
}

async function openSettings() {
  await openSettingsSection(page, 'nodes');
  await chart.waitFor();
}

async function adjustHandle(name, key, count) {
  const slider = handle(name);
  await slider.focus();
  for (let i = 0; i < count; i++) await page.keyboard.press(key);
}

async function dragHandle(name, dy) {
  const slider = handle(name);
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 6 });
  await page.mouse.up();
  await settle();
}

async function editBothCurves() {
  await adjustHandle('bodySize', 'ArrowUp', 4);
  await adjustHandle('bodyExponent', 'ArrowUp', 10);
  await adjustHandle('summaryExponent', 'ArrowUp', 10);
  near(await handleSize('bodySize'), 20, 'Keyboard adjusts the full-size anchor');
  near(await handleSize('bodyExponent'), 20 * Math.sqrt(.5), 'Up moves the half-zoom anchor to a larger screen size');
  near(await handleSize('summaryExponent'), 10.5 * Math.sqrt(2), 'Up moves the summary anchor to a larger screen size');
}

async function reload() {
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
}

try {
  await page.goto(appUrl.href, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.evaluate(() => {
    window.__ui.setState({ tutorialOpen: false, releaseNotesOpen: false, panelOpen: false });
    const response = [
      '放大画布时，节点可以容纳更多文字。正文达到设定字号后，继续放大能让同一行显示更多内容。',
      '思考过程放在回答前面，需要时可以展开。标题和旁边的箭头比正文轻一些。',
      '读到回答末尾，可以复制文字、编辑回答，再从时间戳辨认生成时间。',
    ].join('\n\n');
    const data = { question: '放大画布后，节点里的文字会怎样变化？', response, responses: [response], responseIndex: 0,
      tokenCount: 100, displayName: 'Next question', displaySummary: 'Keep the next answer in view.', highlights: [],
      attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], isCollapsed: false, isEditing: false, isLoading: false };
    const levels = { reading: 'full', overview: 'summary', activity: 'full', compact: 'compact' };
    const nodes = Object.entries(levels).map(([id, detailLevel], i) => ({ id, type: 'thought', dragHandle: '.drag-handle',
      width: 520, height: 335, position: { x: i < 2 ? 0 : 535, y: i % 2 * 355 },
      data: { ...data, nodeNumber: i + 1, detailLevel,
        generatedAts: ['2026-05-01T00:00:00Z'], reasonings: ['Reviewing the question.'],
        agentActivities: id === 'activity' ? [[{ id: 'step', kind: 'reasoning', status: 'completed',
          text: 'Reviewing the question.', startedAt: 1000, endedAt: 3000 }]] : undefined } }));
    window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  });
  await answer.waitFor();
  // Seeding cards schedules the camera's new-node animation.
  await page.waitForTimeout(650);
  const saved = await geometry();
  for (const zoom of [1, 2, .5, .99, 1.01, 1.25]) {
    const body = 16 * Math.min(zoom, 1);
    await expectReading(zoom, body, 10.5);
    await expectFrame(zoom, body);
    if (zoom === 2) await readingCard.screenshot({ path: output + '/conversation-200.png' });
  }

  await openSettingsSection(page, 'edges');
  await settingsPanel.getByRole('heading', { name: '连线走向', exact: true }).waitFor();
  assert.equal(await settingsPanel.getByText('这些设置用于各画布。选中一条连线，可单独指定它的走线。', { exact: true }).count(), 0);
  await openSettings();
  await settingsPanel.getByRole('heading', { name: '画布字号', level: 4 }).waitFor();
  assert.equal(await settingsPanel.getByRole('button', { name: '画布字号', exact: true }).count(), 0);
  assert.equal(await settingsPanel.getByText('设定各画布的默认显示方式。单个节点可以锁定自己的详细程度。', { exact: true }).count(), 0);
  assert.equal(await settingsPanel.getByText('上游对话和文件接入同一个端口，延伸使用独立出口。', { exact: true }).count(), 0);
  await settingsPanel.locator('[data-canvas-detail]:checked').click();
  await settle();
  assert.ok(await chart.isVisible(), 'The typography editor stays open when another node setting receives focus');
  const savedViewport = await viewport();
  const initialSettings = await storedSettings();
  assert.deepEqual(await Promise.all(['bodySize', 'bodyExponent', 'summaryExponent'].map(handleSize)), [16, 8, 10.5]);
  const compactCurve = await curveHeights('compact');
  await previewZoom.fill('16');
  const compactLabel = page.locator('.canvas-type-curve-legend [data-series="compact"] b');
  near(parseFloat(await compactLabel.textContent()), 10.5 * .16 / .22, 'Compact reference curve follows the real low-zoom compensation');
  await previewZoom.fill('100');
  const oldBodyCurve = await curveHeights('body'), oldSummaryCurve = await curveHeights('summary');
  await dragHandle('bodySize', -12);
  const draggedSize = await handleSize('bodySize');
  assert.ok(draggedSize > 16, 'Dragging the full-size point up increases the reading size');
  assert.notDeepEqual(await curveHeights('body'), oldBodyCurve, 'Editing changes the plotted body curve');
  assert.deepEqual(await curveHeights('summary'), oldSummaryCurve);
  await expectSample('body', draggedSize, 'The rendered preview follows the dragged point');
  await dragHandle('summaryExponent', -18);
  assert.ok(await handleSize('summaryExponent') > 10.5, 'Dragging the summary point updates its own curve');
  assert.notDeepEqual(await curveHeights('summary'), oldSummaryCurve, 'Editing changes the plotted summary curve');
  near(await handleSize('bodySize'), draggedSize, 'Dragging the summary curve preserves the body curve');
  await page.keyboard.press('Escape');
  await openSettings();
  await editBothCurves();
  assert.deepEqual(await curveHeights('compact'), compactCurve, 'The compact reference curve stays fixed while editing');
  await chart.scrollIntoViewIfNeeded();
  const chartBox = await chart.boundingBox();
  // Scrub across the plot away from the curve edit handles.
  const plotY = chartBox.y + chartBox.height * .2;
  await page.mouse.move(chartBox.x + chartBox.width * .22, plotY);
  await page.mouse.down();
  const firstZoom = Number(await previewZoom.inputValue());
  await page.mouse.move(chartBox.x + chartBox.width * .65, plotY, { steps: 8 });
  await page.mouse.up();
  const draggedZoom = Number(await previewZoom.inputValue());
  assert.ok(draggedZoom > firstZoom + 25, 'Dragging across the graph changes the preview zoom continuously');
  await settle();
  const ratio = draggedZoom / 100;
  await expectSample('body', 20 * Math.sqrt(Math.min(1, ratio)), 'Graph drag updates the body sample');
  await expectSample('summary', 10.5 * Math.sqrt(Math.max(.32, ratio)) * Math.min(1, ratio / .32), 'Graph drag updates the summary sample');
  await scrubber.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(Number(await previewZoom.inputValue()), draggedZoom - 1, 'The graph can also be scrubbed by keyboard');
  await play.click();
  assert.equal(await play.getAttribute('aria-pressed'), 'true');
  const playingZoom = await previewZoom.inputValue();
  await page.waitForFunction(initial => document.querySelector('[data-canvas-typography-preview-zoom]').value !== initial, playingZoom);
  await play.click();
  assert.equal(await play.getAttribute('aria-pressed'), 'false');
  const pausedZoom = await previewZoom.inputValue();
  await page.waitForTimeout(120);
  assert.equal(await previewZoom.inputValue(), pausedZoom, 'Pausing freezes the preview');
  const stage = page.locator('[data-canvas-typography-stage]');
  await stage.scrollIntoViewIfNeeded();
  const stageBox = await stage.boundingBox();
  const tinyCard = stage.locator('[data-canvas-typography-node="full"]');
  const beforePan = await tinyCard.boundingBox();
  const stageX = stageBox.x + stageBox.width / 2, stageY = stageBox.y + stageBox.height / 2;
  await page.mouse.move(stageX, stageY);
  await page.mouse.down();
  await page.mouse.move(stageX + 18, stageY + 10, { steps: 4 });
  await page.mouse.up();
  await settle();
  const afterPan = await tinyCard.boundingBox();
  near(afterPan.x - beforePan.x, 18, 'Dragging the preview moves its cards horizontally');
  near(afterPan.y - beforePan.y, 10, 'Dragging the preview moves its cards vertically');
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(initial => Number(document.querySelector('[data-canvas-typography-preview-zoom]').value) < Number(initial), pausedZoom);
  await settle();
  const wheelZoom = Number(await previewZoom.inputValue());
  const afterWheel = await tinyCard.boundingBox();
  near(afterWheel.width / afterPan.width, wheelZoom / Number(pausedZoom), 'Wheel zoom scales the miniature card geometry');
  await previewZoom.fill('50');
  await settle();
  assert.equal(await scrubber.getAttribute('aria-valuenow'), '50', 'The slider updates the graph cursor');
  await expectSample('body', 20 * Math.sqrt(.5), 'Body sample reflects the unsaved curve');
  await expectSample('summary', 10.5 * Math.sqrt(.5), 'Summary sample reflects the unsaved curve');
  near(await screenFont(answer), 16, 'Editing and preview zoom keep the live canvas unchanged');
  near(await screenFont(preview), 10.5, 'Summary preview is local');
  assert.deepEqual(await viewport(), savedViewport, 'Editing, scrubbing and playback preserve the actual canvas camera');
  assert.equal(await storedSettings(), initialSettings, 'Draft edits are not saved as applied preferences');
  await settingsPanel.screenshot({ path: output + '/settings.png' });
  await clickSettingsBackdrop(page);
  await expectReading(.5, 8, 10.5);
  await openSettings();
  assert.equal(await handleSize('bodySize'), 20, 'Outside dismissal preserves the session draft');
  await page.keyboard.press('Escape');
  await settingsPanel.waitFor({ state: 'detached' });
  await expectReading(.5, 8, 10.5);
  await openSettings();
  assert.equal(await handleSize('bodySize'), 16, 'Escape discards the draft');
  await editBothCurves();
  await apply.click();
  await clickSettingsBackdrop(page);
  for (const z of [.16, .5, 1, 1.25, 2]) {
    const body = 20 * Math.sqrt(Math.min(1, z));
    await expectReading(z, body, 10.5 * Math.sqrt(Math.max(.32, z)) * Math.min(1, z / .32));
    await expectFrame(z, body);
  }
  assert.deepEqual(await geometry(), saved, 'Zoom and appearance changes preserve graph geometry');
  await reload();
  await expectReading(2, 20, 10.5 * Math.sqrt(2));
  assert.deepEqual(await geometry(), saved, 'Persisted graph geometry remains intact after reloading');

  await page.setViewportSize({ width: 320, height: 780 });
  await openSettings();
  assert.equal(await handleSize('bodySize'), 20);
  assert.ok(await settingsPanel.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 1), 'Settings fit the narrow viewport');
  await chart.scrollIntoViewIfNeeded();
  const narrowChart = await chart.boundingBox();
  assert.ok(narrowChart.width > 140 && narrowChart.x >= 0 && narrowChart.x + narrowChart.width <= 321, 'The graph fits the narrow panel');
  await settingsPanel.screenshot({ path: output + '/settings-narrow.png' });
  await reset.click();
  await page.setViewportSize({ width: 1600, height: 1100 });
  await expectReading(2, 16, 10.5);
  await reload();
  await expectReading(.5, 8, 10.5);
  assert.deepEqual(await geometry(), saved);

  // At the minimum zoom a locked full card is smaller than a screen-sized
  // control. Clipped controls must not intercept clicks on the blank canvas.
  await openSettings();
  await adjustHandle('bodyExponent', 'End', 1);
  await apply.click();
  await clickSettingsBackdrop(page);
  await setZoom(.04);
  const minimumZoom = await readingCard.evaluate(wrapper => {
    const root = wrapper.querySelector('[data-node-detail-level="full"]');
    const box = root.getBoundingClientRect();
    const controlsOutside = [];
    for (const control of root.querySelectorAll('button')) {
      const rect = control.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) continue;
      if (control.contains(document.elementFromPoint(x, y))) controlsOutside.push(control.getAttribute('aria-label') ?? control.textContent.trim());
    }
    return { width: box.width, height: box.height, controlsOutside };
  });
  near(minimumZoom.width, 520 * .04, 'Locked node width at minimum zoom');
  near(minimumZoom.height, saved.find(node => node.id === 'reading').height * .04, 'Locked node height at minimum zoom');
  assert.deepEqual(minimumZoom.controlsOutside, [], 'Interactive controls stay inside the locked card');
  await openSettings();
  await reset.click();

  // A node restored at high zoom must compute the same saved height ceiling
  // as its identical content first mounted at the standard reading scale.
  // Finish the post-hydration camera animation before fixing a test viewport.
  await page.waitForTimeout(650);
  const mountHeights = [];
  const oversizedHeight = 5000;
  for (const zoom of [1, 2]) {
    await setZoom(zoom);
    const id = 'mount-at-' + zoom;
    await page.evaluate(({ id, oversizedHeight }) => {
      const state = window.__store.getState();
      const source = state.nodes.find(node => node.data.detailLevel === 'full');
      const fresh = { id, type: 'thought', position: { x: 0, y: 0 }, width: 520, height: oversizedHeight, data: source.data };
      // Replace the previous full card to mount a fresh instance without
      // triggering the intentional camera animation when node count grows.
      window.__store.setState({ nodes: state.nodes.map(node => node.id === source.id ? fresh : node) });
    }, { id, oversizedHeight });
    await page.waitForFunction(({ id, oversizedHeight }) => window.__store.getState().nodes.find(node => node.id === id)?.height < oversizedHeight, { id, oversizedHeight });
    await settle();
    assert.equal(await page.evaluate(() => window.__rf.getZoom()), zoom, 'Mount was measured at the requested zoom');
    const heights = await card(id).locator('[data-node-detail-level="full"]').evaluate(async el => {
      const { measureConversationContentHeight } = await import('/src/lib/node-content-height.ts');
      const saved = window.__store.getState().nodes.find(node => node.id === el.parentElement.dataset.id).height;
      return { limit: measureConversationContentHeight(el), saved };
    });
    assert.ok(heights.limit > 240 && heights.saved < oversizedHeight, 'The fixture exercised real content height normalization');
    mountHeights.push(heights);
  }
  assert.deepEqual(mountHeights[1], mountHeights[0], 'First mount at 200% and 100% yields the same canonical height limit and saved height');
  assert.deepEqual(errors, []);
  assert.deepEqual(apiWrites, []);
  console.log('PASS curve editing, keyboard controls, preview playback and camera, screen sizes, saved preferences, geometry and reset');
} finally {
  await close();
}
