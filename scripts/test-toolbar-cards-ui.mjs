// Toolbar card ownership, draft suspension, and responsive placement; no model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1760, height: 1100 }, locale: 'zh-CN' });
page.setDefaultTimeout(10000);
const errors = [], writes = [];
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
});
const output = 'local-tests/toolbar-cards';
await mkdir(output, { recursive: true });
const card = name => page.locator(`[data-${name}]`);
const one = async name => {
  await card(name).waitFor();
  assert.equal(await page.locator('.canvas-tool-panel:visible').count(), 1, name);
  assert.equal(Math.round((await card(name).boundingBox()).width), 320, name);
};
const check = name => console.log('PASS', name);
const openConnection = async () => {
  await card('model-picker-trigger').click();
  await page.locator('[data-model-connection-panel], [data-model-picker-panel]').waitFor();
  if (await card('model-picker-panel').isVisible()) {
    await one('model-picker-panel');
    await card('model-picker-panel').getByRole('button', { name: '配置模型 API', exact: true }).click();
  }
  await one('model-connection-panel');
};
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5193');
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  assert.equal(await card('top-toolbar').locator('[data-apikey-entry]').count(), 0);
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const nodes = ['a', 'b'].map((id, i) => ({ id, type: 'thought', width: 380, height: 280,
      position: { x: 80 + i * 440, y: 180 }, data: {
        displayName: `节点 ${id.toUpperCase()}`, question: `研究问题 ${id}`, response: `回答 ${id}`,
        responses: [`回答 ${id}`], responseIndex: 0, isRoot: i === 0,
        isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    nodes.push({ id: 'frame', type: 'frame', position: { x: 80, y: 600 }, width: 600, height: 200,
      data: { stepKind: 'frame', frameTitle: '研究区域', question: '', response: '' } });
    const edges = [{ id: 'ab', source: 'a', target: 'b', type: 'thought', data: {} }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    window.__maxVisibleCards = 0;
    const observe = () => {
      const count = [...document.querySelectorAll('.canvas-tool-panel')].filter(el => el.getClientRects().length).length;
      window.__maxVisibleCards = Math.max(window.__maxVisibleCards, count);
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    window.__rf.setViewport({ x: 0, y: 0, zoom: 0.85 }, { duration: 0 });
    window.__store.getState().setSelectedNodeId('a');
  });
  await one('node-format-panel');
  assert.equal(await card('project-switcher').locator('[data-model-picker-trigger]').count(), 1);
  assert.equal(await card('top-toolbar').locator('[data-model-picker-trigger]').count(), 0);
  check('model connection entry is in the left project toolbar');

  await page.locator('[data-node-format-field="width"]').fill('420');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'a').width), 420);
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  await page.keyboard.press('Escape'); await one('node-format-panel');
  await card('frame-nav-trigger').click(); await one('frame-nav-panel');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await one('node-format-panel');
  await card('toolbar-more').click();
  await card('menu-diagnose').click(); await one('diagnostics-panel');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await one('node-format-panel');
  check('detail, overflow, and frame cards replace each other at 320px');

  await openConnection();
  await card('provider-add').click();
  await page.locator('[data-preset="custom"]').click();
  await card('provider-url').fill('https://draft.invalid/v1');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await openConnection();
  assert.equal(await card('provider-url').inputValue(), 'https://draft.invalid/v1');
  await card('provider-url').fill('');
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  await openConnection();
  assert.equal(await card('provider-url').inputValue(), '');
  await page.keyboard.press('Escape'); await one('node-format-panel');
  check('switching cards preserves connection drafts, including empty values');

  await card('canvas-layout-entry').click(); await one('canvas-layout-panel');
  await card('layout-direction').selectOption('horizontal');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await one('canvas-layout-panel');
  assert.equal(await card('layout-direction').inputValue(), 'horizontal');
  await card('canvas-layout-panel').getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => window.__canvasEditing.getState().setEdgeId('ab'));
  await one('edge-inspector');
  await card('edge-label-add').click();
  await card('edge-label').fill('保留连线草稿');
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  await page.keyboard.press('Escape'); await one('edge-inspector');
  assert.equal(await card('edge-label').inputValue(), '保留连线草稿');
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].data.label), undefined);
  await page.evaluate(() => window.__canvasEditing.getState().setEdgeId(null));
  await one('node-format-panel');
  await page.evaluate(() => {
    window.__canvasEditing.getState().setSelectionTarget('edges');
    window.__store.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: true })) }));
  });
  await one('batch-edge-inspector');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await one('batch-edge-inspector');
  await page.evaluate(() => {
    window.__canvasEditing.getState().setSelectionTarget('nodes');
    window.__store.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: false })) }));
  });
  await one('node-format-panel');
  check('layout and edge inspectors suspend while a toolbar card is open');

  await card('node-format-panel').locator('[data-node-details="a"]').click();
  await card('focus-panel').waitFor();
  for (const width of [1760, 760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await card('canvas-detail-trigger').click();
    await one('canvas-detail-panel');
    await page.waitForTimeout(400);
    const panel = await card('canvas-detail-panel').boundingBox();
    const reader = await card('focus-panel').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1);
    assert.ok(panel.x + panel.width <= reader.x + 1 || panel.y + panel.height <= reader.y + 1, JSON.stringify({ panel, reader }));
    assert.equal(await page.evaluate(() => window.__ui.getState().panelNodeId), 'a');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/detail-reader-${width}.png` });
    if (width === 1760) {
      await page.evaluate(async () => { (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'); });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${output}/detail-reader-dark.png` });
      await page.evaluate(async () => { (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light'); });
    }
    await page.keyboard.press('Escape'); await one('node-format-panel');
  }
  check('desktop and narrow layouts retain the independent reader without overlap');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  assert.equal(await page.evaluate(() => window.__maxVisibleCards), 1);
  check('no painted card stacks, runtime errors, or implicit API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
