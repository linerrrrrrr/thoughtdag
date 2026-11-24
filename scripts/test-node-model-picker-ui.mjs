// Exercise the node model menu in fixed-height cards without network writes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { initNodePickerFixture, installNodeAgentCatalog } from './fixtures/node-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5174');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/node-model-picker';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [];
const catalog = { default: 'api-test', models: [
  { id: 'api-test', name: 'API test model', provider: 'Test API', vision: false },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `codex/codex/test-model-${i + 1}`, name: `Codex · test-model-${i + 1}`, provider: '__agent__', vision: false })),
] };
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api/models') return route.fulfill({ json: catalog });
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(url.pathname);
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await context.addInitScript(initNodePickerFixture);
const id = 'node-model-picker-fixture';
const card = () => page.locator(`.react-flow__node[data-id="${id}"]`);
const picker = () => card().locator('[data-node-execution-picker]');
const trigger = () => picker().locator('[data-model-picker-trigger]');
const panel = () => page.locator('[data-model-picker-panel]');
const nodeData = () => page.evaluate(id => window.__store.getState().nodes.find(node => node.id === id).data, id);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const check = label => console.log(`PASS ${label}`);
const moveAnchorTo = async (anchor, heightFraction) => {
  await settle();
  await anchor.evaluate((button, fraction) => {
    const rect = button.getBoundingClientRect(), view = window.__rf.getViewport();
    const targetY = window.innerHeight * fraction;
    return window.__rf.setViewport({ ...view, y: view.y + targetY - rect.top - rect.height / 2 }, { duration: 0 });
  }, heightFraction);
  await settle();
};
const assertSide = async (anchor, side) => {
  await settle();
  const a = await anchor.boundingBox(), p = await panel().boundingBox();
  assert.ok(a && p);
  const height = page.viewportSize().height;
  assert.equal(height - a.y - a.height >= a.y ? 'below' : 'above', side, 'Fixture anchor must be on the intended half of the screen.');
  const gap = side === 'below' ? p.y - a.y - a.height : a.y - p.y - p.height;
  const scale = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')));
  assert.ok(Math.abs(gap - 6 * scale) < 2, `Expected menu ${side} the opener: ${JSON.stringify({ a, p, gap })}`);
};
const assertAnchored = async anchor => {
  await page.waitForFunction(el => {
    const menu = document.querySelector('[data-model-picker-panel]');
    if (!menu) return false;
    const a = el.getBoundingClientRect(), p = menu.getBoundingClientRect();
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    const gap = 6 * scale, inset = 8 * scale;
    const anchorRight = menu.querySelector('[data-agent-model-options]') ? (a.left + a.right + p.width) / 2 : a.right;
    const expectedRight = Math.max(p.width + inset, Math.min(anchorRight, window.innerWidth - inset));
    return Math.abs(p.right - expectedRight) < 2
      && (Math.abs(p.top - a.bottom - gap) < 2 || Math.abs(a.top - p.bottom - gap) < 2);
  }, await anchor.elementHandle(), { timeout: 3000 });
  const a = await anchor.boundingBox(), p = await panel().boundingBox(), viewport = page.viewportSize();
  assert.ok(a && p);
  assert.ok(p.x >= -1 && p.y >= -1 && p.x + p.width <= viewport.width + 1 && p.y + p.height <= viewport.height + 1,
    `Menu must stay in the viewport: ${JSON.stringify({ a, p, viewport })}`);
  const anchorRight = await panel().locator('[data-agent-model-options]').count() ? a.x + (a.width + p.width) / 2 : a.x + a.width;
  const expectedRight = Math.max(p.width + 6, Math.min(anchorRight, viewport.width - 6));
  assert.ok(Math.abs(p.x + p.width - expectedRight) < 2, `Menu must follow its trigger horizontally: ${JSON.stringify({ a, p })}`);
  const belowGap = p.y - (a.y + a.height), aboveGap = a.y - (p.y + p.height);
  assert.ok(Math.abs(belowGap - 4.5) < 2 || Math.abs(aboveGap - 4.5) < 2,
    `Menu must remain beside its trigger: ${JSON.stringify({ a, p, belowGap, aboveGap })}`);
  return { a, p };
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await page.evaluate(installNodeAgentCatalog, catalog.models);
  await page.evaluate(async ({ id, catalog }) => {
    const { setModelsCache, recheckAgents } = await window.__importLive('/src/lib/use-models.ts');
    setModelsCache(catalog);
    await recheckAgents();
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
    const ui = window.__ui.getState();
    ui.setSelectedModel('api-test'); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false);
    window.__store.getState().setNodes([{ id, type: 'thought', width: 560, height: 300, position: { x: 0, y: 0 }, data: {
      executionKind: 'codex', question: '', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: true, questionEditor: 'canvas', isEditingResponse: false, isLoading: false,
      detailLevel: 'full', tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
    } }]);
    window.__store.getState().setEdges([]);
    window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 });
  }, { id, catalog });
  await trigger().waitFor();
  const defaultPicker = page.locator('[data-project-switcher] [data-model-picker-trigger]');
  const iconShape = locator => locator.locator('svg').first().innerHTML();
  assert.equal(await iconShape(trigger()), await iconShape(defaultPicker), 'Local and default model selectors share the model icon.');
  await defaultPicker.click();
  for (const [kind, source] of [['api', 'Test API'], ['codex', 'Codex']]) {
    const option = picker().locator(`[data-node-execution-option="${kind}"]`);
    const sourceRow = panel().locator(`[data-model-source="${source}"]`);
    assert.equal(await iconShape(option), await iconShape(sourceRow), `The compact ${kind} selector matches its catalog source.`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }));
  await card().locator('[data-canvas-question-editor]').fill('Unsent draft');
  await trigger().click();
  const last = panel().getByRole('button', { name: 'test-model-8', exact: true });
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector('[data-model-picker-panel]');
    const item = [...menu.querySelectorAll('button')].find(button => button.textContent.trim() === 'test-model-8');
    const node = document.querySelector('[data-thought-resized]');
    const itemRect = item.getBoundingClientRect(), nodeRect = node.getBoundingClientRect(), menuRect = menu.getBoundingClientRect();
    return { x: itemRect.left + itemRect.width / 2, y: itemRect.top + itemRect.height / 2,
      itemBottom: itemRect.bottom, nodeBottom: nodeRect.bottom, menuBottom: menuRect.bottom };
  });
  assert.ok(geometry.itemBottom > geometry.nodeBottom, `Fixture must exercise the clipped area: ${JSON.stringify(geometry)}`);
  await page.screenshot({ path: `${output}/node-light-zh.png`, animations: 'disabled' });
  await page.mouse.click(geometry.x, geometry.y);
  assert.equal((await nodeData()).model, 'codex/codex/test-model-8');
  assert.equal((await nodeData()).isEditing, true, 'Clicking a menu item must stay inside the active question editor.');
  assert.equal(await card().locator('[data-canvas-question-editor]').inputValue(), 'Unsent draft');
  check('A fixed-height node exposes and selects the last model beyond its boundary.');

  await trigger().click();
  await page.keyboard.press('Escape');
  assert.equal(await panel().count(), 0);
  assert.equal((await nodeData()).isEditing, true);
  assert.equal(await card().locator('[data-canvas-question-editor]').inputValue(), 'Unsent draft');
  assert.equal(await trigger().evaluate(el => el === document.activeElement), true);
  check('Escape closes only the menu, restores its trigger and preserves the draft.');

  await page.mouse.click(1000, 800);
  assert.equal((await nodeData()).isEditing, false);
  await trigger().click();
  await panel().waitFor({ state: 'visible' });
  await settle();
  assert.equal(await trigger().getAttribute('aria-expanded'), 'true');
  assert.equal(await card().locator('[data-canvas-question-editor]').inputValue(), 'Unsent draft');
  await page.keyboard.press('Escape');
  check('A menu opened from an idle composer stays open without losing the draft.');

  await trigger().click();
  await assertAnchored(trigger());
  await page.evaluate(() => window.__rf.setViewport({ x: 200, y: 210, zoom: 0.8 }, { duration: 0 }));
  await page.waitForFunction(() => {
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
    return Math.abs(matrix.a - 0.8) < 0.001 && Math.abs(matrix.e - 200) < 0.1 && Math.abs(matrix.f - 210) < 0.1;
  });
  await assertAnchored(trigger());
  await page.setViewportSize({ width: 900, height: 700 });
  await page.evaluate(async () => {
    (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('en');
    const anchor = document.querySelector('[data-node-execution-picker] [data-model-picker-trigger]').getBoundingClientRect();
    const view = window.__rf.getViewport();
    window.__rf.setViewport({ ...view, x: view.x + 894 - anchor.right, y: view.y + 680 - anchor.bottom }, { duration: 0 });
  });
  await page.waitForFunction(() => {
    const anchor = document.querySelector('[data-node-execution-picker] [data-model-picker-trigger]').getBoundingClientRect();
    return Math.abs(anchor.right - 894) < 2 && Math.abs(anchor.bottom - 680) < 2;
  });
  const edge = await assertAnchored(trigger());
  assert.ok(edge.p.y + edge.p.height < edge.a.y, 'A menu near the bottom should open upwards.');
  await page.screenshot({ path: `${output}/node-edge-dark-en.png`, animations: 'disabled' });
  check('The menu follows a zoomed and moved node and flips at the viewport edge.');

  const longCatalog = { ...catalog, models: [catalog.models[0], ...Array.from({ length: 24 }, (_, i) => ({
    id: `codex/codex/test-model-${i + 1}`, name: `Codex · test-model-${i + 1}`, provider: '__agent__', vision: false,
    ...(i === 23 ? { efforts: ['low', 'high'], defaultEffort: 'low', supportsFast: true } : {}),
  }))] };
  await page.evaluate(installNodeAgentCatalog, longCatalog.models);
  await page.evaluate(async () => (await window.__importLive('/src/lib/use-models.ts')).recheckAgents());
  const list = panel().locator('[data-agent-model-list]');
  const lastLong = panel().getByRole('button', { name: 'test-model-24', exact: true });
  await lastLong.waitFor({ state: 'attached' });
  await assertSide(trigger(), 'above');
  assert.equal(await list.evaluate(el => el.scrollHeight > el.clientHeight), true);
  const menuBox = await list.boundingBox();
  const zoomBefore = await page.evaluate(() => window.__rf.getViewport().zoom);
  await page.mouse.move(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  assert.ok(await list.evaluate(el => el.scrollTop) > 0, 'Wheel should scroll the catalog.');
  assert.equal(await page.evaluate(() => window.__rf.getViewport().zoom), zoomBefore);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }));
  for (const [fraction, side] of [[0.35, 'below'], [0.65, 'above']]) {
    for (const lane of ['api', 'codex']) {
      const opener = picker().locator(`[data-node-execution-option="${lane}"]`);
      await moveAnchorTo(opener, fraction);
      await opener.click();
      const source = panel().locator(`[data-draft-source-list="${lane}"] [data-draft-model-source]`);
      await source.waitFor();
      await assertSide(opener, side);
      await source.click();
      await panel().locator('[data-draft-model-list]').waitFor();
      assert.equal(await panel().locator('[data-agent-model-options]').count(), lane === 'codex' ? 1 : 0);
      await assertSide(opener, side);
      await panel().locator('[data-draft-source-back]').click();
      await source.waitFor();
      await assertSide(opener, side);
      await page.keyboard.press('Escape');
    }
  }
  await moveAnchorTo(trigger(), 0.5);
  await trigger().click();
  const centered = await trigger().boundingBox();
  assert.equal(centered.y + centered.height / 2, page.viewportSize().height / 2, 'The direct opener is exactly centered.');
  await assertSide(trigger(), 'below');
  await page.keyboard.press('Escape');
  check('API and Agent source lists, model lists and parameters stay on the side with more room through forward and back navigation.');
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }));
  await trigger().click();
  const { p: nodeOptions } = await assertAnchored(trigger());
  await lastLong.scrollIntoViewIfNeeded();
  const previousEffort = await page.evaluate(() => window.__ui.getState().agentEffort);
  await lastLong.click();
  assert.equal((await nodeData()).model, 'codex/codex/test-model-24');
  assert.equal((await nodeData()).isEditing, true);
  await panel().getByRole('slider').press('End');
  await panel().locator('[data-agent-fast]').click();
  assert.deepEqual((await nodeData()).agentOptions, { effort: 'high', fast: true });
  assert.equal(await iconShape(trigger()), await iconShape(defaultPicker), 'Fast mode preserves the model icon.');
  assert.equal(await trigger().locator('.lucide-zap').isVisible(), true, 'Fast mode has its own indicator.');
  await settle();
  assert.equal((await panel().boundingBox()).x, nodeOptions.x, 'Editing model options keeps the panel fixed within the node.');
  await page.keyboard.press('Escape');
  assert.equal(await panel().count(), 0);
  assert.equal(await page.evaluate(() => window.__ui.getState().agentEffort), previousEffort);
  assert.equal(await card().locator('[data-canvas-question-editor]').inputValue(), 'Unsent draft');
  check('Long lists scroll independently and a node model selection preserves the default thinking effort.');

  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.evaluate(id => {
    window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === id
      ? { ...node, data: { ...node.data, isEditing: true, questionEditor: 'panel' } } : node), selectedNodeId: id, selectedNodeIds: [id] }));
    window.__ui.getState().setPanelOpen(true, id);
    window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 });
  }, id);
  const reader = page.locator('[data-focus-panel]');
  const readerTrigger = reader.locator('[data-node-execution-picker] [data-model-picker-trigger]');
  await readerTrigger.click();
  const { p: readerOptions } = await assertAnchored(readerTrigger);
  assert.equal(await panel().getByRole('slider').getAttribute('aria-valuetext'), 'High');
  assert.equal(await panel().getByRole('switch').getAttribute('aria-checked'), 'true');
  await panel().getByRole('button', { name: 'test-model-1', exact: true }).click();
  await settle();
  assert.equal((await panel().boundingBox()).x, readerOptions.x, 'Changing the model keeps the reader panel in place.');
  assert.equal((await nodeData()).agentOptions, undefined);
  assert.equal(await panel().locator('[data-agent-fast]').count(), 0);
  assert.equal((await nodeData()).model, 'codex/codex/test-model-1');
  assert.equal(await reader.locator('[data-conversation-question] textarea').inputValue(), 'Unsent draft');
  await page.mouse.click(750, 850);
  assert.equal(await panel().count(), 0);
  assert.equal(await reader.locator('[data-conversation-question] textarea').inputValue(), 'Unsent draft');
  await readerTrigger.click();
  await panel().waitFor({ state: 'visible' });
  await settle();
  assert.equal(await readerTrigger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  check('The reader menu selects a model and outside dismissal preserves the shared draft.');

  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
