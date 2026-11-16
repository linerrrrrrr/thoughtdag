// Compact cards must not inherit the working height of resized nodes.
// Run against Vite; APP_URL and CHROME_PATH can override the local defaults.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/compact-overview';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1800, height: 1100 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
});
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const settle = () => page.waitForTimeout(300);
const zoom = async value => {
  await page.evaluate(value => window.__rf.setViewport({ x: 100, y: 120, zoom: value }, { duration: 0 }), value);
  await settle();
};
const geometry = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height, data }) => ({
  id, position, width, height, keepOverviewHeight: data.keepOverviewHeight, question: data.question, response: data.response,
})));
const near = (a, b, message, tolerance = 1) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} versus ${b}`);
const box = id => node(id).locator('[data-node-overview-surface]').boundingBox();

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5201', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await page.evaluate(() => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    window.__ui.setState({ panelOpen: false, tutorialOpen: false, releaseNotesOpen: false, canvasDetail: 'compact' });
    const response = Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 段：完整回答要保留，用于验证缩略图不会覆盖已经保存的节点高度。`).join('\n\n');
    const data = (name, extra = {}) => ({ question: name, displayName: name, response, responses: [response], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 10,
      highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], ...extra });
    const nodes = [
      { id: 'thought-natural', type: 'thought', position: { x: 0, y: 0 }, width: 520, data: data('相同名称') },
      { id: 'thought-380', type: 'thought', position: { x: 600, y: 0 }, width: 520, height: 380, data: data('相同名称', { keepOverviewHeight: true }) },
      { id: 'thought-500', type: 'thought', position: { x: 1200, y: 0 }, width: 520, height: 500, data: data('相同名称', { keepOverviewHeight: true }) },
      { id: 'thought-regular-size', type: 'thought', position: { x: 1800, y: 0 }, width: 520, height: 500, data: data('相同名称') },
      { id: 'note-natural', type: 'thought', position: { x: 0, y: 500 }, width: 520, data: data('材料名称', { stepKind: 'note' }) },
      { id: 'note-500', type: 'thought', position: { x: 600, y: 500 }, width: 520, height: 500, data: data('材料名称', { stepKind: 'note', keepOverviewHeight: true }) },
      { id: 'file-natural', type: 'thought', position: { x: 1200, y: 500 }, width: 520, data: data('文件名称', { stepKind: 'file', attachments: [{ id: 'a', name: 'data.csv', type: 'text/csv', size: 4, content: 'a,b' }] }) },
      { id: 'file-500', type: 'thought', position: { x: 1800, y: 500 }, width: 520, height: 500, data: data('文件名称', { stepKind: 'file', keepOverviewHeight: true, attachments: [{ id: 'b', name: 'data.csv', type: 'text/csv', size: 4, content: 'a,b' }] }) },
      { id: 'target', type: 'thought', position: { x: 600, y: 1100 }, width: 520, data: data('下游') },
      { id: 'long-name', type: 'thought', position: { x: 2400, y: 0 }, width: 520, height: 500, data: data('中英文混合长标题 Mixed technical name 继续换行，测试缩略卡片的上下间距和两行截断。', { keepOverviewHeight: true }) },
      { id: 'short-latin', type: 'thought', position: { x: 1200, y: 1100 }, width: 520, height: 380, data: data('kkk', { keepOverviewHeight: true }) },
      { id: 'short-zh', type: 'thought', position: { x: 1800, y: 1100 }, width: 520, height: 500, data: data('待提问', { keepOverviewHeight: true }) },
    ];
    const edges = [{ id: 'wire', source: 'thought-380', target: 'target', type: 'smoothstep', data: {} }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
  });
  await node('thought-380').waitFor();
  await settle();
  const before = await geometry();

  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme), theme);
    for (const level of [.04, .115, .25, .7]) {
      await zoom(level);
      for (const [natural, resized] of [
        ['thought-natural', 'thought-380'], ['thought-natural', 'thought-500'], ['thought-natural', 'thought-regular-size'],
        ['note-natural', 'note-500'], ['file-natural', 'file-500'],
      ]) {
        const a = await box(natural), b = await box(resized);
        assert.ok(a && b, `${natural} and ${resized} are visible`);
        near(a.height, b.height, `${theme} at ${level}: ${resized} fits its content`, .5);
      }
      for (const id of ['thought-380', 'note-500', 'file-500']) {
        const metrics = await node(id).evaluate(element => {
          const wrapper = element.getBoundingClientRect();
          const card = element.querySelector('[data-node-overview-surface]').getBoundingClientRect();
          const heading = element.querySelector('.node-overview-heading').getBoundingClientRect();
          const name = element.querySelector('[data-node-name]').getBoundingClientRect();
          const action = element.querySelector('.node-overview-action button')?.getBoundingClientRect();
          return { wrapper: { top: wrapper.top, bottom: wrapper.bottom }, card: { top: card.top, bottom: card.bottom },
            heading: { top: heading.top, bottom: heading.bottom }, name: { top: name.top, bottom: name.bottom },
            action: action && { top: action.top, bottom: action.bottom }, hasIdentity: !!element.querySelector('.node-overview-identity') };
        });
        near(metrics.wrapper.top, metrics.card.top, `${id} wrapper starts at the card`);
        near(metrics.wrapper.bottom, metrics.card.bottom, `${id} wrapper ends at the card`);
        if (!metrics.hasIdentity) near(metrics.heading.top - metrics.card.top, metrics.card.bottom - metrics.heading.bottom, `${id} has balanced vertical insets`);
        if (metrics.action) {
          near((metrics.name.top + metrics.name.bottom) / 2, (metrics.action.top + metrics.action.bottom) / 2, `${id} name and action are vertically centered`, .5);
          near(metrics.name.top - metrics.card.top, metrics.card.bottom - metrics.name.bottom, `${id} name has balanced vertical space`, .75);
        }
      }
    }
    await zoom(.25);
    await page.screenshot({ path: `${output}/${theme}.png` });
    if (theme === 'dark') await page.screenshot({ path: `${output}/title-alignment.png`, clip: { x: 390, y: 385, width: 300, height: 65 } });
  }
  console.log('PASS compact cards fit names and file identities at four zoom levels in both themes');
  assert.deepEqual(await geometry(), before, 'Compact rendering keeps positions, saved sizes and content');
  for (const id of ['thought-380', 'short-latin', 'short-zh']) {
    const textMetrics = await node(id).evaluate(element => {
      const name = element.querySelector('[data-node-name]');
      const text = document.createRange();
      text.selectNodeContents(name);
      const textBox = text.getBoundingClientRect();
      const button = element.querySelector('.node-overview-action button').getBoundingClientRect();
      return { textCenter: (textBox.top + textBox.bottom) / 2, buttonCenter: (button.top + button.bottom) / 2 };
    });
    near(textMetrics.textCenter, textMetrics.buttonCenter, `${id} rendered text and icon are visually centered`, 1.5);
  }
  const longName = await node('long-name').evaluate(element => {
    const name = element.querySelector('[data-node-name]');
    const nameBox = name.getBoundingClientRect();
    const button = element.querySelector('.node-overview-action button').getBoundingClientRect();
    return { height: name.offsetHeight, lineHeight: parseFloat(getComputedStyle(name).lineHeight),
      nameCenter: (nameBox.top + nameBox.bottom) / 2, buttonCenter: (button.top + button.bottom) / 2 };
  });
  assert.ok(longName.height > longName.lineHeight * 1.5 && longName.height <= longName.lineHeight * 2.1, 'Long names fit two lines without reserving the saved height');
  near(longName.nameCenter, longName.buttonCenter, 'Two-line names and the action share a vertical center', .5);

  await page.evaluate(() => window.__ui.getState().setCanvasDetail('auto'));
  await zoom(.25);
  assert.equal(await node('thought-380').locator('[data-node-detail-level]').getAttribute('data-node-detail-level'), 'compact');
  near((await box('thought-natural')).height, (await box('thought-380')).height, 'Automatic compact detail fits content', .5);
  await zoom(.7);
  assert.equal(await node('thought-380').locator('[data-node-detail-level]').getAttribute('data-node-detail-level'), 'summary');
  near((await box('thought-natural')).height, (await box('thought-380')).height, 'Automatic summary fits its content', .5);
  await zoom(.25);
  console.log('PASS automatic zoom transitions and long names retain compact spacing');

  // React Flow must remeasure ports when a tall card becomes a compact name.
  const alignment = await page.evaluate(() => {
    const edge = document.querySelector('.react-flow__edge[data-id="wire"] .react-flow__edge-path');
    const pathPoint = distance => edge.getPointAtLength(distance).matrixTransform(edge.getScreenCTM());
    const start = pathPoint(0), end = pathPoint(edge.getTotalLength());
    const source = document.querySelector('.react-flow__node[data-id="thought-380"] [data-node-overview]').getBoundingClientRect();
    const target = document.querySelector('.react-flow__node[data-id="target"] [data-node-overview]').getBoundingClientRect();
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
      source: { left: source.left, right: source.right, bottom: source.bottom }, target: { left: target.left, right: target.right, top: target.top } };
  });
  near(alignment.start.y, alignment.source.bottom, 'Source wire meets the compact card', 4);
  near(alignment.end.y, alignment.target.top, 'Target wire meets the compact card', 4);
  assert.ok(alignment.start.x >= alignment.source.left && alignment.start.x <= alignment.source.right);
  assert.ok(alignment.end.x >= alignment.target.left && alignment.end.x <= alignment.target.right);
  console.log('PASS wires meet the visible compact card boundaries');

  await page.evaluate(() => window.__ui.getState().setCanvasDetail('compact'));
  await zoom(.7);
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['thought-380', 'thought-500']));
  const grip = page.locator('[data-selection-resize="height"]');
  await grip.waitFor({ state: 'visible' });
  const gripBox = await grip.boundingBox();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 + 70, { steps: 10 });
  await page.mouse.up();
  await settle();
  let resized = await geometry();
  near(resized.find(item => item.id === 'thought-380').height, 480, 'Compact selection resize saves the first height', 2);
  near(resized.find(item => item.id === 'thought-500').height, 600, 'Compact selection resize saves the second height', 2);
  assert.deepEqual(resized.find(item => item.id === 'thought-380').position, before.find(item => item.id === 'thought-380').position);
  near((await box('thought-380')).height, (await box('thought-500')).height, 'Compact cards remain content-sized after selection resizing', .5);
  await page.evaluate(() => window.__store.getState().undo());
  await settle();
  resized = await geometry();
  assert.deepEqual(resized, before, 'One undo restores a compact selection resize');
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds([]));
  await zoom(.25);
  console.log('PASS compact selection resizing saves dimensions without moving nodes and is undoable');

  await page.evaluate(() => window.__ui.getState().setCanvasDetail('summary'));
  await settle();
  near((await box('thought-natural')).height, (await box('thought-380')).height, 'Summary fits content without a saved-height gap', .5);
  near((await box('note-natural')).height, (await box('note-500')).height, 'Material summary fits content without a saved-height gap', .5);
  assert.deepEqual(await geometry(), before, 'Switching to summary does not change stored geometry or content');

  await page.evaluate(() => window.__ui.getState().setCanvasDetail('full'));
  await settle();
  near((await node('thought-380').boundingBox()).height, 380 * .25, 'Full detail restores the saved thought height', 2);
  near((await node('note-500').boundingBox()).height, 500 * .25, 'Full detail restores the saved material height', 2);
  assert.deepEqual(await geometry(), before, 'Switching to full detail preserves the saved card data');

  await page.evaluate(() => window.__ui.getState().setCanvasDetail('compact'));
  await settle();
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await zoom(.25);
  assert.deepEqual(await geometry(), before, 'Reload retains the saved dimensions and content');
  near((await box('thought-natural')).height, (await box('thought-380')).height, 'Reload retains content-sized compact cards', .5);
  console.log('PASS summary, full detail and reload preserve saved geometry and content');
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(writes, [], 'No model API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
