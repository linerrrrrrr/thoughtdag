// Independent reading and selection targets, using isolated local fixtures only.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1760, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
});
const output = 'local-tests/node-details';
await mkdir(output, { recursive: true });
const check = name => { checks.push(name); console.log('PASS', name); };
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const format = page.locator('[data-node-format-panel]');
const reader = page.locator('[data-focus-panel]');
const select = id => node(id).locator('.thought-node-header').click({ position: { x: 150, y: 15 } });
const reading = () => page.evaluate(() => window.__ui.getState().panelNodeId);
const selected = () => page.evaluate(() => window.__store.getState().selectedNodeIds);
const open = id => node(id).locator('[data-node-details]').click();
const screenshot = name => page.screenshot({ path: `${output}/${name}.png` });
const summaryDraft = async () => {
  if (!await reader.locator('[data-node-summary-input]').count()) await reader.locator('[data-node-metadata-toggle]').click();
  return reader.locator('[data-node-summary-input]');
};
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const assertPanelsFit = async () => {
  await page.waitForTimeout(350);
  const f = await format.boundingBox(), r = await reader.boundingBox(), v = page.viewportSize();
  for (const box of [f, r]) assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= v.width + 1 && box.y + box.height <= v.height + 1, JSON.stringify({ box, v }));
  assert.ok(f.x + f.width <= r.x || f.y + f.height <= r.y, `Panels overlap: ${JSON.stringify({ f, r })}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
};
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5190');
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
    const nodes = ['a', 'b', 'c'].map((id, i) => ({ id, type: 'thought', width: 380, height: 300,
      position: { x: i === 1 ? 480 : 80, y: i === 2 ? 540 : 160 }, data: {
        displayName: `节点 ${id.toUpperCase()}`, question: `研究问题 ${id.toUpperCase()}`, response: `回答 ${id.toUpperCase()}`,
        responses: [`回答 ${id.toUpperCase()}`], responseIndex: 0, isRoot: true,
        isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges: [] }], historyIndex: 0 });
  });
  await page.waitForTimeout(650);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 0.9 }, { duration: 0 }));
  await select('a'); await format.waitFor();
  assert.equal(await reader.count(), 0);
  await node('a').locator('.thought-node-header').dblclick({ position: { x: 150, y: 15 } });
  await reader.waitFor(); await assertPanelsFit();
  assert.equal(await reading(), 'a'); assert.deepEqual(await selected(), ['a']);
  await (await summaryDraft()).fill('双击收起后保留的草稿');
  await node('a').locator('.thought-node-header').dblclick({ position: { x: 150, y: 15 } });
  await reader.waitFor({ state: 'detached' });
  assert.equal(await reading(), null); assert.deepEqual(await selected(), ['a']);
  await node('a').locator('.thought-node-header').dblclick({ position: { x: 150, y: 15 } });
  await reader.waitFor();
  assert.equal(await (await summaryDraft()).inputValue(), '双击收起后保留的草稿');
  await (await summaryDraft()).fill('');
  await reader.locator('[data-node-details-close]').click();
  await open('a'); await reader.waitFor();
  check('single click selects; repeated header double-clicks toggle details and retain drafts');

  const detailsButton = node('a').locator('[data-node-details]');
  await (await summaryDraft()).fill('点击图标收起后保留的草稿');
  assert.equal(await detailsButton.getAttribute('aria-pressed'), 'true');
  await detailsButton.click();
  await reader.waitFor({ state: 'detached' });
  assert.equal(await detailsButton.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await selected(), ['a']);
  await detailsButton.click();
  await reader.waitFor();
  assert.equal(await (await summaryDraft()).inputValue(), '点击图标收起后保留的草稿');
  await (await summaryDraft()).fill('');
  await detailsButton.focus();
  await page.keyboard.press('Space');
  await reader.waitFor({ state: 'detached' });
  await page.keyboard.press('Enter');
  await reader.waitFor();
  assert.equal(await reading(), 'a');
  await open('b'); assert.equal(await reading(), 'b');
  await open('a'); assert.equal(await reading(), 'a');
  assert.deepEqual(await selected(), ['a']);
  check('details icon toggles by click or keyboard, keeps drafts and selection, and switches to another node');

  const resize = reader.locator('[data-panel-resize]');
  await resize.hover(); await page.waitForTimeout(500);
  assert.equal(await page.getByRole('tooltip').count(), 0, 'resize hover has no tooltip');
  assert.equal(await resize.getAttribute('title'), null);
  await resize.click(); await page.waitForTimeout(500);
  assert.equal(await page.getByRole('tooltip').count(), 0, 'resize click has no tooltip');
  const resizeBox = await resize.boundingBox();
  const initialWidth = await reader.evaluate(element => element.getBoundingClientRect().width);
  await page.mouse.move(resizeBox.x + 4, resizeBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x - 116, resizeBox.y + 200, { steps: 10 });
  await page.mouse.up();
  assert.ok(await reader.evaluate(element => element.getBoundingClientRect().width) > initialWidth + 100);
  await resize.dblclick();
  assert.equal(await page.evaluate(() => window.__ui.getState().panelWidth), 520);
  check('resize has no hover/click tooltip; dragging and double-click reset still work');

  await select('b');
  assert.equal(await reading(), 'a'); assert.deepEqual(await selected(), ['b']);
  assert.match(await format.locator('[data-format-node-name]').textContent(), /节点 B/);
  assert.match(await reader.locator('[data-reading-node-name]').textContent(), /节点 A/);
  await format.locator('[data-node-format-reopen]').click();
  await format.locator('[data-node-format-field="width"]').fill('450');
  await page.keyboard.press('Escape');
  assert.equal(await reading(), 'a'); assert.equal(await reader.count(), 1);
  assert.equal(await format.locator('[data-node-format-field="width"]').inputValue(), '380');
  await screenshot('read-a-format-b');
  check('formatting B never switches A; Escape cancels only the active geometry edit');

  await reader.locator('[data-node-details-close]').click();
  assert.deepEqual(await selected(), ['b']); assert.equal(await format.count(), 1);
  await open('b');
  assert.equal(await reading(), 'b');
  await (await summaryDraft()).fill('保留在 B 的摘要草稿');
  await select('a'); assert.equal(await (await summaryDraft()).inputValue(), '保留在 B 的摘要草稿');
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['a', 'c']));
  assert.equal(await reading(), 'b'); assert.equal(await format.count(), 1);
  await page.mouse.click(600, 1000);
  assert.deepEqual(await selected(), []); assert.equal(await reading(), 'b');
  await node('a').locator('[data-conversation-answer]').dblclick();
  assert.equal(await reading(), 'b', 'answer double-click does not change the reading target');
  await node('a').locator('.thought-node-header button').first().dblclick();
  assert.equal(await reading(), 'b', 'header controls retain their own actions');
  await page.evaluate(async () => (await import('/src/lib/node-detail.ts')).setNodeDetail('a'));
  await node('a').locator('.thought-node-header').dblclick({ position: { x: 150, y: 15 } });
  assert.equal(await reading(), 'a');
  check('selection and body/control double-clicks keep the reader; header double-click switches its target');

  assert.equal(await reading(), 'a');
  await select('b');
  await reader.locator('[data-edit-response]').click();
  const responseEditor = reader.locator('[data-conversation-answer] textarea');
  await responseEditor.fill('只修改 A 的回答');
  await reader.getByRole('button', { name: '保存', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__store.getState().nodes.slice(0, 2).map(n => n.data.response)), ['只修改 A 的回答', '回答 B']);
  await open('b'); assert.equal(await (await summaryDraft()).inputValue(), '保留在 B 的摘要草稿');
  check('explicit navigation restores each node draft; editing the reader writes to its own target');

  await reader.locator('[data-node-metadata-toggle]').click();
  await reader.locator('[data-edit-question]').click();
  await reader.locator('[data-conversation-question] textarea').fill('');
  for (const [width, height] of [[1440, 1000], [1000, 900], [960, 900]]) {
    await page.setViewportSize({ width, height }); await settle(); await assertPanelsFit();
  }
  const selectedBeforeCollapse = await selected();
  for (const width of [959, 640, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await reader.waitFor({ state: 'detached' });
    await page.waitForFunction(() => !window.__ui.getState().panelOpen);
    assert.equal(await reading(), null);
    assert.deepEqual(await selected(), selectedBeforeCollapse);
    assert.equal(await format.count(), 1);
    const bounds = await format.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => window.__ui.getState().setPanelOpen(true, 'b'));
    await page.waitForFunction(() => !window.__ui.getState().panelOpen);
    assert.equal(await reader.count(), 0, 'details cannot occupy an undersized window');
    if (width === 390) await screenshot('narrow-collapsed');
  }
  await page.setViewportSize({ width: 1760, height: 1100 });
  await page.waitForTimeout(350);
  assert.equal(await reader.count(), 0, 'growing the window does not reopen the reader');
  await open('b');
  assert.equal(await (await summaryDraft()).inputValue(), '保留在 B 的摘要草稿');
  await reader.locator('[data-node-metadata-toggle]').click();
  if (!await reader.locator('[data-conversation-question] textarea').count()) await reader.locator('[data-edit-question]').click();
  const questionDraft = reader.locator('[data-conversation-question] textarea');
  assert.equal(await questionDraft.inputValue(), '', 'an emptied question draft survives automatic collapse');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'b').data.question), '研究问题 B');
  await questionDraft.press('Escape');
  assert.equal(await reader.count(), 1);
  check('below 960px the reader closes without changing selection, saved content or even empty drafts; widening requires explicit reopen');
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('[data-appearance-lighting]').getByRole('button', { name: 'Dark', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__ui.getState().setCanvasDetail('compact'));
  await format.waitFor();
  assert.equal(await format.getByRole('button', { name: 'View details', exact: true }).count(), 0);
  await assertPanelsFit();
  await node('a').locator('[data-node-details]').click(); assert.equal(await reading(), 'a');
  assert.deepEqual(await selected(), ['b']);
  await screenshot('overview-dark-english');
  await node('a').locator('[data-node-details]').click();
  await reader.waitFor({ state: 'detached' });
  assert.deepEqual(await selected(), ['b']);
  await node('a').locator('[data-node-details]').click();
  await reader.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await reader.count(), 0); assert.deepEqual(await selected(), ['b']);
  check('overview details icon also toggles; Escape closes the reader while keeping format selection');

  await node('a').locator('[data-node-name]').dblclick();
  assert.equal(await reading(), 'a');
  await node('a').locator('[data-node-name]').dblclick();
  await reader.waitFor({ state: 'detached' });
  assert.equal(await reading(), null);
  await page.evaluate(() => window.__store.getState().setSelectedNodeId('b'));
  check('double-clicking the compact node heading also toggles its reader');

  await open('a');
  await page.evaluate(() => window.__store.getState().setNodes(window.__store.getState().nodes.filter(n => n.id !== 'a')));
  await reader.waitFor({ state: 'detached' }); assert.deepEqual(await selected(), ['b']);
  await open('b');
  await page.locator('[data-project-switcher] .canvas-project-button').click();
  await page.getByRole('button', { name: 'New canvas', exact: true }).click();
  await reader.waitFor({ state: 'detached' });
  check('deleting the read node or switching projects closes only its stale reader');
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
} catch (error) {
  await screenshot('failure'); throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await browser.close();
}
